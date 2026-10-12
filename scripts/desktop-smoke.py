#!/usr/bin/env python3
"""Exercise the packaged WKWebView using the feature-gated embedded WebDriver."""
import base64
import json
import os
from pathlib import Path
import plistlib
import signal
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BINARY = Path(os.environ.get('SIDELIT_TEST_BINARY', ROOT / 'src-tauri/target/release/bundle/macos/Sidelit.app/Contents/MacOS/sidelit'))
BASE = 'http://127.0.0.1:4445'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)


def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=35) as response:
        value = json.load(response)['value']
    if isinstance(value, dict) and value.get('error'):
        raise AssertionError(value)
    return value


def wait(check, description, timeout=12):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        try:
            value = check()
            if value:
                return value
        except (ConnectionError, urllib.error.URLError):
            pass
        time.sleep(.1)
    raise AssertionError('Timed out: ' + description)


def launch(*args, cwd=ROOT):
    start = time.monotonic()
    result = subprocess.run([str(BINARY), *map(str, args)], cwd=cwd, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    return round(time.monotonic() - start, 3)


with tempfile.TemporaryDirectory(prefix='sidelit-desktop-') as tmp:
    folder = Path(tmp)
    shutil.copytree(ROOT / 'samples', folder / 'notes')
    folder = (folder / 'notes').resolve()
    file = folder / '研究 notes.md'
    file.write_bytes(b'# Original\r\n\r\nA paragraph to edit.\r\n')
    before = file.read_bytes()
    modified = file.stat().st_mtime_ns
    started = time.monotonic()
    timing = launch(file)
    wait(lambda: request('/status')['ready'], 'WebDriver')
    time.sleep(.5)
    session = request('/session', {'capabilities': {}})['sessionId']

    def js(script, *args):
        return request(f'/session/{session}/execute/sync', {'script': script, 'args': list(args)})

    def click(text):
        assert js('const scope=document.querySelector("dialog[open]")||document;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]); if(b){b.click();return true} return false', text), text

    def body():
        return js('return document.body.innerText').replace('\u00a0', ' ')

    def screenshot(name):
        if os.environ.get('SIDELIT_SCREENSHOTS') == '0':
            return
        data = request(f'/session/{session}/screenshot')
        (OUT / name).write_bytes(base64.b64decode(data))

    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Original', 'rendered editor')
    ready_seconds = round(time.monotonic() - started, 3)
    def instrument():
        js('window.__errors=[];window.__workers=[]; addEventListener("error",e=>__errors.push(e.message)); addEventListener("unhandledrejection",e=>__errors.push(String(e.reason)));addEventListener("securitypolicyviolation",e=>__errors.push("CSP: "+e.violatedDirective+" "+e.blockedURI)); const W=window.Worker;window.Worker=class extends W{constructor(...a){super(...a);__workers.push(String(a[0]));this.addEventListener("error",e=>__errors.push("worker: "+e.message));}}')
    instrument()
    assert not js('return !!document.querySelector(".dirty-dot")')
    def set_theme(value):
        js('const select=document.querySelector("select[aria-label=Theme]");select.value=arguments[0];select.dispatchEvent(new Event("change",{bubbles:true}))', value)
        expected = js('return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"') if value == 'system' else value
        wait(lambda: js('return document.documentElement.dataset.theme') == expected, 'theme ' + value)

    def set_size(size):
        js('document.querySelector(".font-size-value").click()')
        wait(lambda: js('return document.querySelector(".font-size-value").textContent') == '16px', 'reset font size')
        control = 'Increase font size' if size > 16 else 'Decrease font size'
        js('for(let i=0;i<arguments[1];i++)document.querySelector(`button[aria-label="${arguments[0]}"]`).click()', control, abs(size - 16))
        wait(lambda: js('return document.querySelector(".font-size-value").textContent') == f'{size}px', 'font size ' + str(size))

    set_theme('system')
    assert js('return localStorage.getItem("themePreference")') == 'system'
    wait(lambda: js('return [...document.fonts].some(f=>f.family.includes("IBM Plex Sans")&&f.status==="loaded")'), 'bundled IBM Plex Sans')
    assert 'IBM Plex Sans' in js('return getComputedStyle(document.querySelector(".ProseMirror p")).fontFamily')
    js('window.__richEditor=document.querySelector(".ProseMirror")')
    set_theme('light')
    assert js('return !!document.querySelector(".theme-control svg circle")'), 'sun uses a real circle'
    set_size(20)
    assert js('return getComputedStyle(document.querySelector(".ProseMirror p")).fontSize') == '20px'
    set_theme('dark')
    assert js('return getComputedStyle(document.querySelector(".main")).color') == 'rgb(171, 178, 191)'
    assert js('return document.querySelector(".ProseMirror")===__richEditor'), 'appearance changes must not remount Crepe'
    assert not js('return !!document.querySelector(".dirty-dot")')
    js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"-",metaKey:true,bubbles:true,cancelable:true}))')
    wait(lambda: js('return document.querySelector(".font-size-value").textContent') == '19px', 'decrease shortcut')
    js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"0",metaKey:true,bubbles:true,cancelable:true}))')
    wait(lambda: js('return document.querySelector(".font-size-value").textContent') == '16px', 'reset shortcut')
    click('Source')
    wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'Monaco source')
    wait(lambda: js('return [...document.fonts].some(f=>f.family.includes("Inconsolata")&&f.status==="loaded")'), 'bundled Inconsolata')
    assert 'Inconsolata' in js('return getComputedStyle(document.querySelector(".view-lines")).fontFamily')
    js('window.__sourceEditor=document.querySelector(".monaco-editor")')
    set_size(20)
    wait(lambda: js('return getComputedStyle(document.querySelector(".view-lines")).fontSize') == '20px', 'Monaco font update')
    set_theme('light')
    wait(lambda: js('return getComputedStyle(document.querySelector(".monaco-editor-background")).backgroundColor') == 'rgb(250, 250, 250)', 'Monaco One Light')
    set_theme('dark')
    wait(lambda: js('return getComputedStyle(document.querySelector(".monaco-editor-background")).backgroundColor') == 'rgb(40, 44, 52)', 'Monaco One Dark')
    assert js('return document.querySelector(".monaco-editor")===__sourceEditor'), 'appearance changes must not remount Monaco'
    assert not js('return !!document.querySelector(".dirty-dot")')
    set_size(16)
    click('Save')
    time.sleep(.4)
    assert file.read_bytes() == before and file.stat().st_mtime_ns == modified
    click('Rendered')
    wait(lambda: js('return !!document.querySelector(".ProseMirror")'), 'rendered mode again')
    assert not js('return !!document.querySelector(".dirty-dot")')
    # A real contenteditable input transaction must update the shared buffer synchronously.
    js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("insertText",false,"Edited in WKWebView.")')
    wait(lambda: js('return !!document.querySelector(".dirty-dot")'), 'rich edit')
    launch('Welcome.md', cwd=folder)
    wait(lambda: 'A quieter place to think' in body(), 'second tab')
    launch(file)
    wait(lambda: 'Edited in WKWebView.' in body(), 'draft retained across tabs')
    assert js('return !!document.querySelector(".tab.active .dirty-dot")')
    click('Source')
    wait(lambda: 'Edited in WKWebView.' in body(), 'rich draft in source')
    click('Save')
    wait(lambda: b'Edited in WKWebView.' in file.read_bytes(), 'rich save')
    assert b'\r\n' in file.read_bytes()
    # Source typing goes through Monaco's own input handler.
    element = request(f'/session/{session}/element', {'using': 'css selector', 'value': '.monaco-editor textarea'})
    element_id = element['element-6066-11e4-a52e-4f735466cecf']
    request(f'/session/{session}/element/{element_id}/click', {})
    request(f'/session/{session}/element/{element_id}/value', {'text': 'SOURCE ', 'value': list('SOURCE ')})
    wait(lambda: js('return !!document.querySelector(".dirty-dot")'), 'source input')
    click('Rendered')
    wait(lambda: 'SOURCE' in body(), 'source edit in rich editor')
    click('Save')
    wait(lambda: b'SOURCE' in file.read_bytes(), 'source save')
    file.write_text('# External refresh\n\nAgent text.\n')
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'External refresh', 'clean watcher refresh')
    js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,"Unsaved draft")')
    wait(lambda: js('return !!document.querySelector(".dirty-dot")'), 'dirty buffer')
    file.write_text('# Conflict from disk\n\nExternal version.\n')
    wait(lambda: 'The file changed on disk' in body(), 'watcher conflict')
    assert 'Unsaved draft' in body()
    click('Compare')
    wait(lambda: js('return !!document.querySelector(".monaco-diff-editor")'), 'Monaco comparison')
    time.sleep(1)
    assert js('return __workers.some(url=>url.includes("editor.worker"))'), js('return __workers')
    screenshot('compare.png')
    click('Reload from Disk')
    wait(lambda: js('return !!document.querySelector("dialog[open]")'), 'discard warning')
    click('Cancel')
    assert 'Your draft' in body()
    click('Reload from Disk')
    click('Discard and Reload')
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Conflict from disk', 'explicit reload')
    # Atomic saves and deletion/recreation must remain visible to the directory watcher.
    temp = folder / 'swap.tmp'
    temp.write_text('# Atomic replacement\n')
    temp.replace(file)
    wait(lambda: 'Atomic replacement' in body(), 'rename event')
    file.unlink()
    wait(lambda: 'File unavailable' in body(), 'deletion')
    file.write_text('# Recreated\n')
    wait(lambda: 'Recreated' in body() and 'File unavailable' not in body(), 'recreation')
    js('const el=document.querySelector(".ProseMirror h1");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,"Close test")')
    wait(lambda: js('return !!document.querySelector(".dirty-dot")'), 'close test draft')
    js('document.querySelector(".tab.active .tab-close").click()')
    wait(lambda: 'Save changes to' in body(), 'dirty close prompt')
    click('Cancel')
    assert 'Close test' in body()
    js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"q",metaKey:true,bubbles:true}))')
    wait(lambda: 'Save changes to' in body(), 'dirty quit prompt')
    click('Cancel')
    js('document.querySelector(".tab.active .tab-close").click()')
    click('Save')
    wait(lambda: b'Close test' in file.read_bytes(), 'save on close')
    wait(lambda: not js('return !!document.querySelector("dialog[open]")'), 'close completed')
    warm = launch('--source', '研究 notes.md', cwd=folder)
    wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'CLI source mode')
    assert js('return [...document.querySelectorAll(".tab")].filter(e=>e.textContent.includes("研究 notes.md")).length') == 1
    launch('Welcome.md', cwd=folder)
    wait(lambda: js('return [...document.images].some(i=>i.naturalWidth===256)'), 'local image')
    welcome = folder / 'Welcome.md'
    original = welcome.read_text()
    image_line = next(line for line in original.splitlines() if line.startswith('!['))
    js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,"GFM edit test")')
    click('Save')
    wait(lambda: 'GFM edit test' in welcome.read_text(), 'GFM rich save')
    assert image_line in welcome.read_text(), 'Rich edit must preserve image alt text and path'
    welcome.write_text(original)
    wait(lambda: 'This is a sample document' in body(), 'restored sample')
    wait(lambda: js('return !!document.querySelector(".cm-content")'), 'fenced code editor')
    assert 'Inconsolata' in js('return getComputedStyle(document.querySelector(".cm-scroller")).fontFamily')
    screenshot('rendered.png')
    launch('Lists.md', cwd=folder)
    wait(lambda: 'Lists that stay in line' in body(), 'list fixture')
    for size in [12, 16, 24, 28]:
        set_size(size)
        offsets = js('''return [...document.querySelectorAll('.milkdown-list-item-block')].map(item=>{const p=item.querySelector(':scope > .list-item > .children > .content-dom > p');const label=item.querySelector('.label');const marker=label.querySelector('svg')||label;const box=marker.getBoundingClientRect();const style=getComputedStyle(p);const firstLine=p.getBoundingClientRect().top+parseFloat(style.paddingTop)+parseFloat(style.lineHeight)/2;return Math.abs(box.top+box.height/2-firstLine)})''')
        assert len(offsets) >= 11 and max(offsets) < .75, (size, offsets)
    assert js('return document.querySelector("button[aria-label=\\"Increase font size\\"]").disabled')
    set_size(16)
    screenshot('lists.png')
    launch('Welcome.md', cwd=folder)
    wait(lambda: 'A quieter place to think' in body(), 'return to sample')
    click('Source')
    wait(lambda: 'A quieter place to think' in body(), 'source screenshot')
    time.sleep(.3)
    screenshot('source.png')
    js('const select=document.querySelector("select[aria-label=Theme]");select.value="light";select.dispatchEvent(new Event("change",{bubbles:true}))')
    request(f'/session/{session}/window/rect', {'width': 900, 'height': 680})
    click('Rendered')
    wait(lambda: js('return !!document.querySelector(".ProseMirror h1")'), 'narrow rendered editor')
    time.sleep(.3)
    screenshot('light-narrow.png')
    launch('Research.markdown', cwd=folder)
    wait(lambda: js('return document.querySelector(".fidelity-note")?.textContent.includes("Source mode")'), 'fidelity fallback')
    fixture = folder / 'Research.markdown'
    initial = fixture.read_bytes()
    click('Save')
    time.sleep(.4)
    assert fixture.read_bytes() == initial
    # Use the real Monaco transaction API without exporting test hooks in the app.
    def source_editor():
        return '''const el=document.querySelector('.source-editor');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];let editor;for(;f&&!editor;f=f.return)for(let h=f.memoizedState;h;h=h.next)if(h.memoizedState?.current?.getModel){editor=h.memoizedState.current;break}if(!editor)throw new Error('Source editor not found');'''

    def source_edit(text):
        js(source_editor() + '''const code=editor.getModifiedEditor?.()||editor;code.executeEdits('desktop-test',[{range:code.getModel().getFullModelRange(),text:arguments[0]}])''', text)

    def source_text():
        return js(source_editor() + 'return (editor.getModifiedEditor?.()||editor).getValue()')

    def rich_edit(text):
        wait(lambda: js('return !!document.querySelector(".ProseMirror p")'), 'editable paragraph')
        js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,arguments[0])', text)
        wait(lambda: js('return !!document.querySelector(".tab.active .dirty-dot")'), 'new draft')

    metadata = folder / 'metadata.md'
    prefix = b'---\r\ntitle: "Keep $ and <tags>"\r\n# Keep this comment\r\n---\r\n\r\n'
    metadata.write_bytes(prefix + b'# Metadata\r\n\r\nOriginal body.\r\n')
    launch(metadata)
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Metadata', 'frontmatter rendered body')
    untouched = metadata.read_bytes()
    stamp = metadata.stat().st_mtime_ns
    click('Save')
    time.sleep(.2)
    assert metadata.read_bytes() == untouched and metadata.stat().st_mtime_ns == stamp
    rich_edit('Edited body, unchanged metadata.')
    click('Save')
    wait(lambda: b'Edited body' in metadata.read_bytes(), 'frontmatter body saved')
    assert metadata.read_bytes().startswith(prefix)
    assert b'\n' not in metadata.read_bytes().replace(b'\r\n', b'')
    screenshot('frontmatter.png')

    money = folder / 'money.md'
    money.write_text('Price $5\n')
    launch(money)
    wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'automatic Source')
    source_edit('Price 5\n')
    time.sleep(.2)
    assert js('return !!document.querySelector(".monaco-editor") && !document.querySelector(".ProseMirror")'), 'Source must remain selected'
    click('Save')
    wait(lambda: money.read_text() == 'Price 5\n', 'source retained save')

    launch(folder)
    js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"p",metaKey:true,bubbles:true,cancelable:true}))')
    wait(lambda: js('return !!document.querySelector(".quick-open input")'), 'Quick Open')
    js('const el=document.querySelector(".quick-open input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"metadata");el.dispatchEvent(new Event("input",{bubbles:true}))')
    wait(lambda: js('return document.querySelector(".search-status")?.textContent.startsWith("1 match")'), 'scoped filename search')
    screenshot('quick-open.png')
    js('document.querySelector(".quick-open input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))')
    wait(lambda: js('return document.querySelector(".tab.active button[title]")?.title') == str(metadata), 'Quick Open keyboard selection')

    background = folder / 'background.md'
    background.write_text('Original background.\n')
    launch(background)
    rich_edit('Background draft.')
    launch(metadata)
    wait(lambda: js('return document.querySelector(".tab.active button[title]")?.title') == str(metadata), 'foreground tab')
    js('document.querySelector(`.tab button[title="${arguments[0]}"]`).closest(".tab").querySelector(".tab-close").click()', str(background))
    wait(lambda: js('return !!document.querySelector("dialog[open]")'), 'background close prompt')
    click('Discard')
    wait(lambda: not js('return !!document.querySelector(`.tab button[title="${arguments[0]}"]`)', str(background)), 'background closed')
    assert js('return !!document.querySelector(".tab.active") && !document.querySelector(".empty")'), 'closing a background tab must select a real tab'

    merge = folder / 'merge.md'
    merge.write_text('# Merge\n\nFirst base.\n\nUnchanged middle.\n\nLast base.\n')
    launch(merge)
    rich_edit('First draft.')
    merge.write_text('# Merge\n\nFirst disk.\n\nUnchanged middle.\n\nLast disk.\n')
    wait(lambda: 'The file changed on disk' in body(), 'merge conflict')
    click('Compare')
    wait(lambda: js('return document.querySelectorAll(".gutter .action-label.codicon-arrow-right").length') >= 2, 'per-change disk arrows')
    assert js('return [...document.querySelectorAll(".gutter .action-label")].every(e=>e.tabIndex===0&&e.getAttribute("role")==="button"&&!e.closest("[aria-hidden=true]"))')
    def take_last_disk_change(key, code):
        js('const arrows=document.querySelectorAll(".gutter .action-label.codicon-arrow-right");const button=arrows[arrows.length-1];button.focus();for(const type of ["keydown","keyup"])button.dispatchEvent(new KeyboardEvent(type,{key:arguments[0],keyCode:arguments[1],which:arguments[1],bubbles:true,cancelable:true}))', key, code)
    take_last_disk_change('Enter', 13)
    wait(lambda: 'Last disk.' in source_text(), 'selected disk change applied')
    assert 'First draft.' in source_text(), 'taking one disk change must keep the other draft edit'
    wait(lambda: js('return document.querySelectorAll(".gutter .action-label.codicon-arrow-right").length') == 1, 'remaining difference painted')
    set_theme('dark')
    screenshot('editable-compare.png')
    reviewed_text = merge.read_text()
    merge.write_text(reviewed_text + '\nNew external change.\n')
    wait(lambda: 'Refresh disk pane' in body(), 'newer disk version while comparing')
    click('Save Merged')
    time.sleep(.2)
    assert merge.read_text().endswith('New external change.\n'), 'never overwrite an unreviewed change'
    assert 'First draft.' in source_text()
    click('Refresh disk pane')
    wait(lambda: js(source_editor() + 'return editor.getLineChanges()?.some(c=>c.modifiedEndLineNumber===0)'), 'disk-only insertion')
    wait(lambda: js('return document.querySelectorAll(".gutter .action-label.codicon-arrow-right").length') >= 2, 'insertion arrow')
    take_last_disk_change(' ', 32)
    wait(lambda: 'New external change.' in source_text(), 'disk-only insertion accepted with Space')
    source_edit(source_text() + '\nManual merge edit.\n')
    click('Save Merged')
    wait(lambda: 'First draft.' in merge.read_text() and 'Last disk.' in merge.read_text(), 'merged save')
    wait(lambda: not js('return !!document.querySelector(".conflict")'), 'conflict resolved')
    merge.write_text('# Clean external update\n\nAgent revision.\n')
    wait(lambda: 'Review changes' in body(), 'clean change review')
    click('Review changes')
    wait(lambda: js('return !!document.querySelector(".monaco-diff-editor")'), 'clean comparison')
    assert js(source_editor() + 'return editor.getModifiedEditor().getRawOptions().readOnly')
    wait(lambda: js(source_editor() + 'return (editor.getLineChanges()?.length ?? 0) > 0'), 'review differences computed')
    time.sleep(.15)
    screenshot('external-review.png')
    click('Back to draft')

    # Native selection is tested in Rust; these replies check the frontend cancel/error paths.
    js('window.__apiReady=false;import(document.querySelector("script[type=module]").src).then(m=>{window.__featureApi=Object.values(m).find(v=>v&&typeof v.copy==="function"&&typeof v.ready==="function");window.__originalCopy=__featureApi.copy;__apiReady=true})')
    wait(lambda: js('return __apiReady'), 'test transport access')
    rich_edit('Save As draft.')
    tab_count = js('return document.querySelectorAll(".tab").length')
    js('__featureApi.copy=async()=>null;window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",shiftKey:true,metaKey:true,bubbles:true,cancelable:true}))')
    time.sleep(.15)
    assert js('return document.querySelectorAll(".tab").length') == tab_count
    assert js('return !!document.querySelector(".tab.active .dirty-dot")')
    js('__featureApi.copy=async()=>{throw new Error("Test save location unavailable")};window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",shiftKey:true,metaKey:true,bubbles:true,cancelable:true}))')
    wait(lambda: 'Test save location unavailable' in body(), 'Save As failure shown')
    assert js('return !!document.querySelector(".tab.active .dirty-dot")')
    js('document.querySelector("button[aria-label=\\"Dismiss error\\"]").click()')
    click('Source')
    wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'Save As source')
    copied_text = source_text()
    copied = folder / 'saved-as.md'
    copied.write_text(copied_text)
    js('const target=arguments[0],expected=arguments[1];__featureApi.copy=async(path,text)=>{if(text!==expected)throw new Error("Incorrect copy revision");return __featureApi.open(target)};window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",shiftKey:true,metaKey:true,bubbles:true,cancelable:true}))', str(copied), copied_text)
    wait(lambda: js('return document.querySelector(".tab.active button[title]")?.title') == str(copied), 'Save As new tab')
    assert not js('return !!document.querySelector(".tab.active .dirty-dot")')
    assert js('return !!document.querySelector(`.tab button[title="${arguments[0]}"]`).closest(".tab").querySelector(".dirty-dot")', str(merge)), 'Save As must keep the original draft'
    js('document.querySelector(`.tab button[title="${arguments[0]}"]`).closest(".tab").querySelector(".tab-close").click()', str(merge))
    wait(lambda: js('return !!document.querySelector("dialog[open]")'), 'original draft discard')
    click('Discard')
    created = folder / 'new-document.md'
    created.write_text('')
    js('const target=arguments[0];__featureApi.copy=async(path,text)=>{if(path!==null||text!=="")throw new Error("Incorrect new document");return __featureApi.open(target)};window.dispatchEvent(new KeyboardEvent("keydown",{key:"n",metaKey:true,bubbles:true,cancelable:true}))', str(created))
    wait(lambda: js('return document.querySelector(".tab.active button[title]")?.title') == str(created), 'New File tab')
    assert not js('return !!document.querySelector(".tab.active .dirty-dot")')
    js('__featureApi.copy=__originalCopy')
    launch(merge)
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Clean external update', 'return to clean document')

    js('document.querySelector(".app-menu summary").click()')
    click('Session & Recovery…')
    wait(lambda: js('return !!document.querySelector(".session-dialog")'), 'recovery settings')
    click('Turn on recovery')
    wait(lambda: 'Turn off and delete saved session' in body(), 'recovery enabled')
    screenshot('recovery-settings.png')
    click('Close')
    rich_edit('Checkpointed draft.')
    js('window.__recoveryStatus=null;__featureApi.recoveryStatus().then(s=>__recoveryStatus=s)')
    time.sleep(.8)
    js('__featureApi.recoveryStatus().then(s=>__recoveryStatus=s)')
    wait(lambda: js('return __recoveryStatus?.dirty') == 1, 'dirty draft checkpoint')
    errors_before_crash = js('return __errors')
    workers_before_crash = js('return __workers')
    with (BINARY.parents[1] / 'Info.plist').open('rb') as info:
        identifier = plistlib.load(info)['CFBundleIdentifier']
    checkpoint = Path.home() / 'Library/Application Support' / identifier / 'recovery/session.json'
    saved = json.loads(checkpoint.read_text())['session']
    assert any('Checkpointed draft.' in d['text'] for d in saved['documents'])
    output = subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True)
    pids = [int(line.strip().split(None, 1)[0]) for line in output.splitlines() if line.strip().split(None, 1)[-1] == str(BINARY)]
    assert len(pids) == 1, pids
    os.kill(pids[0], signal.SIGKILL)
    time.sleep(.4)
    merge.write_text('# Agent changed while closed\n\nDo not overwrite this.\n')
    launch()
    wait(lambda: request('/status')['ready'], 'restarted WebDriver')
    session = request('/session', {'capabilities': {}})['sessionId']
    wait(lambda: 'Restore your last session?' in body(), 'restart recovery offer')
    instrument()
    screenshot('restore-session.png')
    # Native approval is simulated here; CLI grants still authorize every real file read.
    for saved_doc in saved['documents']:
        launch(saved_doc['path'])
    js('window.__restoreReady=false;const saved=arguments[0];import(document.querySelector("script[type=module]").src).then(m=>{window.__featureApi=Object.values(m).find(v=>v&&typeof v.restoreSession==="function");__featureApi.restoreSession=async()=>{for(const doc of saved.documents)await __featureApi.open(doc.path);return saved};__restoreReady=true})', saved)
    wait(lambda: js('return __restoreReady'), 'restore selection reply')
    click('Restore session')
    wait(lambda: 'Checkpointed draft.' in body() and 'The file changed on disk' in body(), 'recovered draft and current disk conflict')
    assert merge.read_text() == '# Agent changed while closed\n\nDo not overwrite this.\n'
    assert js('return !!document.querySelector(".tab.active .dirty-dot")')
    js('document.querySelector(".app-menu summary").click()')
    click('Session & Recovery…')
    click('Turn off and delete saved session')
    wait(lambda: 'Turn on recovery' in body(), 'recovery deleted')
    click('Close')
    assert not checkpoint.exists(), 'turning recovery off must delete its file'
    click('Reload from Disk')
    wait(lambda: js('return !!document.querySelector("dialog[open]")'), 'restored draft discard consent')
    click('Discard and Reload')
    wait(lambda: not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'checkpoint test discarded')
    errors = errors_before_crash + js('return __errors')
    assert errors == [], errors
    report = {'handoffSeconds': timing, 'editorReadySeconds': ready_seconds, 'warmHandoffSeconds': warm, 'workers': workers_before_crash + js('return __workers'), 'errors': errors, 'checks': 'Crepe input; Monaco input; CRLF; no-op save; mode/tab switches; clean refresh; conflict/diff; discard/cancel; rename; delete/recreate; repeated CLI; Unicode/caller cwd; local image and alt fidelity; frontmatter; dirty close/quit cancel; save on close; task/numbered/nested/wrapped list alignment at 12–28px; local fonts; One themes; system preference; live sizing without editor remounts; opaque frontmatter rich editing; sticky Source; scoped Quick Open; background close selection; editable diff and keyboard change acceptance; stale merged-save rejection; clean change review; New/Save As UI (native selection simulated); Save As cancel/failure; recovery checkpoint, process crash, restart, conflict-safe restore (native approval simulated), and deletion'}
    (OUT / 'desktop.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    # Close only the temporary documents; the app remains available for manual checks.
    for _ in range(12):
        js('const b=[...document.querySelectorAll(".tab-close")].find(b=>b.closest(".tab").querySelector("button[title]").title.startsWith(arguments[0]));if(b)b.click()', str(folder))
        time.sleep(.2)
    set_theme('system')
    set_size(16)
    launch(ROOT / 'samples')
