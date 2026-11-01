#!/usr/bin/env python3
"""Exercise the packaged WKWebView using the feature-gated embedded WebDriver."""
import base64
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import shutil
import subprocess
import tempfile
import time
import urllib.request

from focus_guard import FocusGuard

ROOT = Path(__file__).resolve().parent.parent
BINARY = Path(os.environ.get('SIDELIT_TEST_BINARY', ROOT / 'src-tauri/target/release/bundle/macos/Sidelit.app/Contents/MacOS/sidelit'))
with (BINARY.parents[1] / 'Info.plist').open('rb') as info:
    identifier = plistlib.load(info)['CFBundleIdentifier']
assert identifier != 'app.sidelit.desktop', 'Set SIDELIT_TEST_BINARY to an isolated desktop-test bundle; this test kills its app.'
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
    diagrams = folder / 'Diagrams.md'
    diagrams.write_bytes(diagrams.read_bytes().replace(b'\n', b'\r\n'))
    before = file.read_bytes()
    modified = file.stat().st_mtime_ns
    guard = FocusGuard(BINARY)
    started = time.monotonic()
    timing = launch()
    wait(lambda: request('/status')['ready'], 'WebDriver')
    time.sleep(.5)
    session = request('/session', {'capabilities': {}})['sessionId']
    # A script sent during navigation is lost; fail fast and retry instead of waiting 30 seconds.
    request(f'/session/{session}/timeouts', {'script': 5000})

    def js(script, *args):
        return request(f'/session/{session}/execute/sync', {'script': script, 'args': list(args)})

    # Use the real Monaco transaction API without exporting test hooks in the app.
    def source_editor():
        return '''const el=document.querySelector('.source-editor');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];let editor;for(;f&&!editor;f=f.return)for(let h=f.memoizedState;h;h=h.next)if(h.memoizedState?.current?.getModel){editor=h.memoizedState.current;break}if(!editor)throw new Error('Source editor not found');'''

    def source_edit(text):
        js(source_editor() + '''const code=editor.getModifiedEditor?.()||editor;code.pushUndoStop();code.executeEdits('desktop-test',[{range:code.getModel().getFullModelRange(),text:arguments[0]}]);code.pushUndoStop()''', text)

    def source_text():
        return js(source_editor() + 'return (editor.getModifiedEditor?.()||editor).getValue()')

    def click(text):
        assert js('const scope=document.querySelector("dialog[open]")||document;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]); if(b){b.click();return true} return false', text), text

    def body():
        return js('return document.body.innerText').replace('\u00a0', ' ')

    def edit_rendered():
        js('const b=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Edit rendered Markdown");if(b?.getAttribute("aria-pressed")==="false")b.click()')
        wait(lambda: js('return document.querySelector(".ProseMirror")?.isContentEditable'), 'explicit rich editing')

    def screenshot(name):
        if os.environ.get('SIDELIT_SCREENSHOTS') == '0':
            return
        data = request(f'/session/{session}/screenshot')
        (OUT / name).write_bytes(base64.b64decode(data))

    def set_theme(value):
        js('const select=document.querySelector("select[aria-label=Theme]");select.value=arguments[0];select.dispatchEvent(new Event("change",{bubbles:true}))', value)
        expected = js('return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"') if value == 'system' else value
        wait(lambda: js('return document.documentElement.dataset.theme') == expected, 'theme ' + value)

    wait(lambda: js('const img=document.querySelector(".empty-mark img");return img?.complete && img.naturalWidth > 0'), 'welcome icon')
    assert js('const source=document.querySelector(".empty-mark source"),img=document.querySelector(".empty-mark img");return img.currentSrc===new URL(matchMedia(source.media).matches?source.srcset:img.src,location.href).href'), 'welcome icon follows system appearance'
    for media, theme in [('not all', 'light'), ('all', 'dark')]:
        set_theme(theme)
        js('document.querySelector(".empty-mark source").media=arguments[0]', media)
        wait(lambda: js('const source=document.querySelector(".empty-mark source"),img=document.querySelector(".empty-mark img");return img.complete && img.naturalWidth > 0 && img.currentSrc===new URL(arguments[0]==="dark"?source.srcset:img.src,location.href).href', theme), 'welcome ' + theme + ' icon')
        screenshot('welcome-icon-' + theme + '.png')
    js('document.querySelector(".empty-mark source").media="(prefers-color-scheme: dark)"')
    launch(file)
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Original', 'rendered editor')
    ready_seconds = round(time.monotonic() - started, 3)
    def instrument():
        js('window.__errors=[];window.__workers=[]; addEventListener("error",e=>__errors.push(e.message)); addEventListener("unhandledrejection",e=>__errors.push(String(e.reason?.stack||e.reason)));addEventListener("securitypolicyviolation",e=>__errors.push("CSP: "+e.violatedDirective+" "+e.blockedURI)); const W=window.Worker;window.Worker=class extends W{constructor(...a){super(...a);__workers.push(String(a[0]));this.addEventListener("error",e=>__errors.push("worker: "+e.message));}}')
    instrument()

    def history_action(action, menu=False):
        if menu:
            js('void window.__TAURI_INTERNALS__.invoke("plugin:event|emit",{event:"menu-action",payload:arguments[0]})', action)
        else:
            js('(document.activeElement||document.body).dispatchEvent(new KeyboardEvent("keydown",{key:"z",metaKey:true,shiftKey:arguments[0]==="redo",bubbles:true,cancelable:true}))', action)

    def check_column():
        metrics = js('const el=document.querySelector(".ProseMirror"),s=getComputedStyle(el);return {width:el.clientWidth,left:parseFloat(s.paddingLeft),right:parseFloat(s.paddingRight),cap:s.maxWidth}')
        expected = max(32, metrics['width'] * .1)
        assert metrics['cap'] == 'none' and abs(metrics['left'] - expected) < 1 and abs(metrics['right'] - expected) < 1, metrics

    check_column()
    assert js('return getComputedStyle(document.querySelector(".ProseMirror h1")).marginTop') == '0px', 'first heading has no extra top margin'
    js('document.querySelector(".rich-editor").style.width="300px"')
    check_column()
    js('document.querySelector(".rich-editor").style.removeProperty("width")')
    assert not js('return !!document.querySelector(".dirty-dot")')
    def set_size(size):
        js('document.querySelector(".font-size-value").click()')
        wait(lambda: js('return document.querySelector(".font-size-value").textContent') == '16px', 'reset font size')
        control = 'Increase font size' if size > 16 else 'Decrease font size'
        js('for(let i=0;i<arguments[1];i++)document.querySelector(`button[aria-label="${arguments[0]}"]`).click()', control, abs(size - 16))
        wait(lambda: js('return document.querySelector(".font-size-value").textContent') == f'{size}px', 'font size ' + str(size))

    js('document.querySelector(".app-menu summary").click()')
    assert js('return document.querySelector(".app-menu").open')
    set_size(17)
    assert js('return document.querySelector(".app-menu").open'), 'appearance controls stay open'
    set_size(16)
    js('document.querySelector(".font-size-value").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
    assert not js('return document.querySelector(".app-menu").open')
    assert js('return document.activeElement.matches(".app-menu summary")'), 'Escape returns focus'
    js('document.querySelector(".app-menu summary").click();document.querySelector(".toolbar-space").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))')
    assert not js('return document.querySelector(".app-menu").open'), 'outside pointer dismisses Actions'
    js('document.querySelector(".app-menu summary").click();document.querySelector(".font-size-value").focus();document.querySelector(".save-button").focus()')
    assert not js('return document.querySelector(".app-menu").open'), 'focus leaving Actions dismisses it'
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
    assert js('return getComputedStyle(document.querySelector(".main")).color') == 'rgb(213, 214, 223)'
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
    wait(lambda: js('return getComputedStyle(document.querySelector(".monaco-editor-background")).backgroundColor') == 'rgb(250, 250, 253)', 'Monaco Light')
    set_theme('dark')
    wait(lambda: js('return getComputedStyle(document.querySelector(".monaco-editor-background")).backgroundColor') == 'rgb(51, 54, 67)', 'Monaco Dark')
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
    assert not js('return document.querySelector(".ProseMirror").isContentEditable'), 'rendered documents default to reading'
    edit_rendered()
    js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("insertText",false,"Edited in WKWebView.")')
    wait(lambda: js('return !!document.querySelector(".dirty-dot")'), 'rich edit')
    assert js('return getComputedStyle(document.querySelector(".ProseMirror h1")).marginTop') == '0px', 'cursor widgets must not move the heading'
    history_action('undo')
    wait(lambda: 'A paragraph to edit.' in body() and not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'rich keyboard undo')
    history_action('redo')
    wait(lambda: 'Edited in WKWebView.' in body(), 'rich keyboard redo')
    history_action('undo', menu=True)
    wait(lambda: 'A paragraph to edit.' in body(), 'rich menu undo')
    history_action('redo', menu=True)
    wait(lambda: 'Edited in WKWebView.' in body(), 'rich menu redo')
    assert file.read_bytes() == before, 'history must not save to disk'
    js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"p",metaKey:true,bubbles:true,cancelable:true}))')
    wait(lambda: js('return !!document.querySelector(".quick-open input")'), 'history in search field')
    history_action('undo', menu=True)
    time.sleep(.1)
    assert 'Edited in WKWebView.' in body(), 'an empty search undo must not edit the document'
    js('document.querySelector(".quick-open input").focus();document.execCommand("insertText",false,"search undo")')
    wait(lambda: js('return document.querySelector(".quick-open input").value') == 'search undo', 'search input')
    history_action('undo', menu=True)
    wait(lambda: js('return document.querySelector(".quick-open input").value') == '', 'search field undo')
    history_action('redo')
    wait(lambda: js('return document.querySelector(".quick-open input").value') == 'search undo', 'search field redo')
    assert 'Edited in WKWebView.' in body(), 'search history must not edit the document'
    click('Close')
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
    typed = source_text()
    history_action('undo')
    wait(lambda: source_text() != typed, 'source keyboard undo')
    undone = source_text()
    history_action('redo')
    wait(lambda: source_text() == typed, 'source keyboard redo')
    history_action('undo', menu=True)
    wait(lambda: source_text() == undone, 'source menu undo')
    history_action('redo', menu=True)
    wait(lambda: source_text() == typed, 'source menu redo')
    assert b'SOURCE' not in file.read_bytes(), 'source history must not save to disk'
    # Isolate field routing from Monaco Find's clipboard permission requests on synthetic clicks.
    js('const field=document.createElement("textarea");field.id="history-field";field.setAttribute("aria-label","History field fixture");document.querySelector(".monaco-editor").append(field);field.focus();document.execCommand("insertText",false,"undo query")')
    wait(lambda: js('return document.activeElement.value') == 'undo query', 'Source field input')
    history_action('undo', menu=True)
    wait(lambda: js('return document.activeElement.value') == '', 'Source field undo')
    history_action('redo')
    wait(lambda: js('return document.activeElement.value') == 'undo query', 'Source field redo')
    assert source_text() == typed, 'field history must not edit the document'
    js('document.querySelector("#history-field").remove()')
    click('Rendered')
    wait(lambda: 'SOURCE' in body(), 'source edit in rich editor')
    click('Save')
    wait(lambda: b'SOURCE' in file.read_bytes(), 'source save')
    file.write_text('# External refresh\n\nAgent text.\n')
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'External refresh', 'clean watcher refresh')
    history_action('undo', menu=True)
    time.sleep(.15)
    assert not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'disk reload must reset rich history'
    assert 'Agent text.' in body()
    edit_rendered()
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
    edit_rendered()
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
    asset = folder / 'assets/sidelit.png'
    asset_bytes = asset.read_bytes()
    asset.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='))
    wait(lambda: js('return [...document.querySelectorAll(".ProseMirror img")].some(i=>i.naturalWidth===1)'), 'nested Markdown image refresh')
    assert not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'image refresh must not edit Markdown'
    asset.write_bytes(asset_bytes)
    wait(lambda: js('return [...document.images].some(i=>i.naturalWidth===256)'), 'restored image refresh')
    welcome = folder / 'Welcome.md'
    original = welcome.read_text()
    image_line = next(line for line in original.splitlines() if line.startswith('!['))
    edit_rendered()
    js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,"GFM edit test")')
    click('Save')
    wait(lambda: 'GFM edit test' in welcome.read_text(), 'GFM rich save')
    assert image_line in welcome.read_text(), 'Rich edit must preserve image alt text and path'
    welcome.write_text(original)
    wait(lambda: 'This is a sample document' in body(), 'restored sample')
    js('document.querySelector(".milkdown-code-block")?.scrollIntoView({block:"center"})')
    wait(lambda: js('return !!document.querySelector(".cm-content")'), 'fenced code editor')
    assert 'Inconsolata' in js('return getComputedStyle(document.querySelector(".cm-scroller")).fontFamily')
    edit_rendered()
    js('const el=document.querySelector(".cm-content");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,"fn history_check() {}")')
    wait(lambda: js('return !!document.querySelector(".tab.active .dirty-dot")'), 'code block edit')
    history_action('undo', menu=True)
    wait(lambda: 'println!' in js('return document.querySelector(".cm-content").textContent'), 'code block undo')
    history_action('redo')
    wait(lambda: 'history_check' in js('return document.querySelector(".cm-content").textContent'), 'code block redo')
    history_action('undo')
    wait(lambda: not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'code undo restores clean buffer')
    assert welcome.read_text() == original
    js('document.querySelector(".rich-editor").scrollTop=0')
    check_column()
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
    wait(lambda: js('return !!document.querySelector(".ProseMirror")') and 'mixes math, Mermaid' in body(), 'mixed syntax opens in the rich editor')
    fixture = folder / 'Research.markdown'
    initial = fixture.read_bytes()
    click('Save')
    time.sleep(.4)
    assert fixture.read_bytes() == initial
    # Inject the probe into test publications, not into shipping MDX preview code.
    probe = '''addEventListener('message',e=>{if(e.data?.source!=='mermaid-test')return;
      if(e.data.select){const svg=document.querySelector('.sidelit-diagram svg'),r=document.createRange();r.selectNodeContents(svg);getSelection().removeAllRanges();getSelection().addRange(r);svg.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))}
      if(e.data.link)document.querySelector('a[href]').click();
      if(e.data.escape)document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(Number.isInteger(e.data.scroll)){document.dispatchEvent(new WheelEvent('wheel'));document.querySelectorAll('.sidelit-diagram')[e.data.scroll]?.scrollIntoView()}
      let parentBlocked=false;try{void parent.document.body}catch{parentBlocked=true}
      const svg=document.querySelector('.sidelit-diagram svg'),label=svg?.querySelector('text');
      parent.postMessage({source:'mermaid-test-result',diagrams:document.querySelectorAll('.sidelit-diagram svg').length,
        highlights:document.querySelectorAll('[data-sidelit-overlay] > div').length,selectedText:getSelection()?.toString(),
        text:document.body.innerText,theme:document.documentElement.dataset.theme,font:getComputedStyle(document.body).fontSize,
        labelSize:label&&getComputedStyle(label).fontSize,color:label&&getComputedStyle(label).fill,
        width:document.documentElement.scrollWidth,viewport:innerWidth,ipc:typeof window.__TAURI_INTERNALS__,parentBlocked,
        url:location.href,diagramTop:svg?.getBoundingClientRect().top,errorTop:document.querySelector('.sidelit-diagram [role=status]')?.getBoundingClientRect().top,errors:document.querySelectorAll('.sidelit-diagram [role=status]').length},'*');});'''
    js('''window.__mermaidMetrics=null;window.__mermaidReady=false;
      window.__mermaidListener=e=>{if(e.source===document.querySelector('.preview-frame')?.contentWindow&&e.data?.source==='mermaid-test-result')window.__mermaidMetrics=e.data};
      addEventListener('message',window.__mermaidListener);
      const probe=arguments[0];import(document.querySelector('script[type=module]').src).then(m=>{
        window.__mermaidApi=Object.values(m).find(v=>v&&typeof v.publishPreview==='function');
        window.__mermaidPublish=__mermaidApi.publishPreview;
        __mermaidApi.publishPreview=(id,html)=>{const nonce=/nonce="([^"]+)"/.exec(html)?.[1];if(!nonce)throw Error('Missing preview nonce');
          return __mermaidPublish(id,html.replace('</body>','<script nonce="'+nonce+'">'+probe+'</script></body>'))};
        window.__mermaidReady=true})''', probe)
    wait(lambda: js('return window.__mermaidReady'), 'diagram test transport')
    try:
        def frame_metrics():
            js('document.querySelector(".preview-frame")?.contentWindow.postMessage({source:"mermaid-test"},"*")')
            return js('return window.__mermaidMetrics')
        def type_rich(text):
            edit_rendered()
            js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,arguments[0])', text)
            wait(lambda: js('return !!document.querySelector(".tab.active .dirty-dot")'), 'rich draft')
            js('const b=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Edit rendered Markdown");if(b?.getAttribute("aria-pressed")==="true")b.click()')
        # Mermaid draws in the rich editor, and a failed block keeps the document readable.
        diagram_bytes, diagram_stamp = diagrams.read_bytes(), diagrams.stat().st_mtime_ns
        launch(diagrams)
        wait(lambda: js('return document.querySelectorAll(".ProseMirror svg").length >= 2'), 'diagrams in the rich editor')
        # Crepe mounts code blocks only near the viewport.
        js('[...document.querySelectorAll(".milkdown-code-block")].at(-1).scrollIntoView({block:"center"})')
        wait(lambda: js('return document.querySelector(".ProseMirror").textContent.includes("Diagram unavailable")'), 'invalid diagram message')
        # A failed diagram's own toggle reveals its code without changing the draft.
        js('[...document.querySelectorAll(".milkdown-code-block")].at(-1).querySelector(".preview-toggle-button").click()')
        wait(lambda: js('const c=[...document.querySelectorAll(".milkdown-code-block")].at(-1).querySelector(".cm-content");return c&&c.getBoundingClientRect().height>0&&c.textContent.includes("not a diagram")'), 'invalid diagram code from its toggle')
        assert not js('return !!document.querySelector(".tab.active .dirty-dot")')
        screenshot('mermaid-toggle.png')
        assert 'Pi' in js('return document.querySelector(".ProseMirror svg").parentElement.textContent + [...document.querySelectorAll(".ProseMirror svg")].map(s=>s.textContent).join(" ")')
        assert not js('return !!document.querySelector(".ProseMirror script,.ProseMirror svg a,.ProseMirror svg image,.ProseMirror svg foreignObject")')
        assert not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'drawing diagrams must not change the draft'
        set_theme('dark')
        request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
        time.sleep(.3)
        screenshot('mermaid-dark.png')
        dark_fill = js('const t=document.querySelector(".ProseMirror svg text");return t&&getComputedStyle(t).fill')
        set_theme('light')
        wait(lambda: js('const t=document.querySelector(".ProseMirror svg text");return t&&getComputedStyle(t).fill') != dark_fill, 'diagram colors follow the theme')
        request(f'/session/{session}/window/rect', {'width': 720, 'height': 630})
        time.sleep(.3)
        screenshot('mermaid-light-narrow.png')
        assert js('return document.querySelector(".rich-editor").scrollWidth <= document.querySelector(".rich-editor").clientWidth + 1'), 'narrow diagrams must not overflow the page'
        request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
        click('Source')
        wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'diagram source editor')
        assert source_text().replace('\r\n', '\n') == diagram_bytes.decode().replace('\r\n', '\n')
        click('Rendered')
        wait(lambda: js('return document.querySelectorAll(".ProseMirror svg").length >= 2'), 'return to drawn diagrams')
        click('Save')
        time.sleep(.2)
        assert diagrams.read_bytes() == diagram_bytes and diagrams.stat().st_mtime_ns == diagram_stamp
        type_rich('Edited beside the diagrams.')
        click('Save')
        wait(lambda: b'Edited beside the diagrams.' in diagrams.read_bytes(), 'rich edit saved beside diagrams')
        saved = diagrams.read_bytes()
        for block in re.findall(rb'```mermaid.*?```', diagram_bytes, re.S):
            assert block in saved, block
        assert b'\r\n' in saved and b'\n' not in saved.replace(b'\r\n', b''), 'CRLF must survive a rich edit'

        # Comments stay hidden and raw HTML stays inert, while real edits keep both byte for byte.
        product = folder / 'PRODUCT.md'
        product.write_bytes(b'# Product\r\n\r\nFirst paragraph.\r\n\r\n<!-- impeccable:product-schema 1 -->\r\n\r\nRead <!-- hidden $metadata -->this product record.\r\n')
        product_bytes, product_stamp = product.read_bytes(), product.stat().st_mtime_ns
        launch(product)
        wait(lambda: 'this product record.' in body(), 'comment document in the rich editor')
        assert 'impeccable' not in body() and 'metadata' not in body()
        click('Save')
        time.sleep(.2)
        assert product.read_bytes() == product_bytes and product.stat().st_mtime_ns == product_stamp
        type_rich('Edited first paragraph.')
        click('Save')
        wait(lambda: b'Edited first paragraph.' in product.read_bytes(), 'rich edit saved beside comments')
        assert b'<!-- impeccable:product-schema 1 -->' in product.read_bytes() and b'<!-- hidden $metadata -->' in product.read_bytes()
        reading = folder / 'Reading.md'
        reading.write_bytes(b'Budget is $500.\n\n<details open><summary>More</summary>Inner text</details>\n\n<img src=x onerror="document.body.dataset.bad=1">\n\n<script>document.body.dataset.bad=1</script>\n\nClaim[^1]\n\n[^1]: Source note\n')
        launch(reading)
        wait(lambda: js('return document.querySelector(".ProseMirror")?.textContent.includes("Budget is $500.")'), 'dollar signs and raw HTML in the rich editor')
        time.sleep(.3)
        assert js('return !document.body.dataset.bad && !document.querySelector(".ProseMirror img:not(.ProseMirror-separator),.ProseMirror script,.ProseMirror details")'), 'raw HTML must stay inert in the main window'
        screenshot('raw-html-rich.png')
        type_rich('Budget is $600.')
        click('Save')
        wait(lambda: b'Budget is $600.' in reading.read_bytes(), 'rich edit saved beside raw HTML')
        assert reading.read_bytes().split(b'\n', 1)[1] == b'\n<details open><summary>More</summary>Inner text</details>\n\n<img src=x onerror="document.body.dataset.bad=1">\n\n<script>document.body.dataset.bad=1</script>\n\nClaim[^1]\n\n[^1]: Source note\n', reading.read_bytes()
        assert not js('return !!document.body.dataset.bad')

        # MDX edits as source beside a live render, surviving syntax errors while typing.
        live = folder / 'Live.mdx'
        live.write_text('# First render\n\nSome *live* text.\n')
        live_stamp = live.stat().st_mtime_ns
        js('window.__mermaidMetrics=null')
        launch(live)
        wait(lambda: js('return !!document.querySelector(".mdx-split .monaco-editor") && !!document.querySelector(".mdx-split .preview-frame")'), 'MDX split view')
        wait(lambda: (m := frame_metrics()) and 'First render' in m['text'], 'first MDX render')
        assert frame_metrics()['parentBlocked'] and frame_metrics()['ipc'] == 'undefined'
        assert js('return document.querySelector(".mdx-split .preview-frame").getAttribute("sandbox")') == 'allow-scripts'
        assert not js('return !!document.querySelector(".tab.active .dirty-dot")') and live.stat().st_mtime_ns == live_stamp
        screenshot('mdx-split.png')
        source_edit('# Second render\n\nSome *live* text.\n')
        wait(lambda: (m := frame_metrics()) and 'Second render' in m['text'], 'MDX updates while typing')
        assert live.read_text().startswith('# First render'), 'typing must not write the file'
        source_edit('# Second render\n\n<Broken\n')
        wait(lambda: 'Showing the last good render' in body(), 'syntax error keeps the last render')
        assert 'Second render' in frame_metrics()['text']
        screenshot('mdx-split-error.png')
        source_edit('# Third render\n')
        wait(lambda: (m := frame_metrics()) and 'Third render' in m['text'] and 'Showing the last good render' not in body(), 'MDX recovers from the error')
        click('Save')
        wait(lambda: live.read_text() == '# Third render\n', 'MDX saved from the split view')
        request(f'/session/{session}/window/rect', {'width': 720, 'height': 630})
        time.sleep(.3)
        screenshot('mdx-split-narrow.png')
        request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})

        # Source selections reach Pi like rendered ones, with their exact line.
        def select_source(line, start, end):
            js(source_editor() + 'editor.setSelection({startLineNumber:arguments[0],startColumn:arguments[1],endLineNumber:arguments[0],endColumn:arguments[2]});document.querySelector(".source-editor").dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))', line, start, end)
        select_source(1, 3, 8)
        wait(lambda: js('return !!document.querySelector(".selection-actions")'), 'selection actions in MDX source')
        js(source_editor() + 'editor.setPosition({lineNumber:1,column:1});document.querySelector(".source-editor").dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))')
        wait(lambda: not js('return !!document.querySelector(".selection-actions")'), 'collapsing a source selection clears its actions')
        select_source(1, 3, 8)
        wait(lambda: js('return !!document.querySelector(".selection-actions")'), 'selection actions again')
        click('Explain')
        wait(lambda: js('return !document.querySelector(".feedback-panel").hidden') and 'Third' in js('return document.querySelector(".feedback-excerpt").textContent'), 'Explain captures the source selection')
        js('document.querySelector(".feedback-panel textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
        wait(lambda: js('return document.querySelector(".feedback-panel").hidden'), 'Escape hides the request')
        click('Discard request')

        def rich_text():
            return js('return document.querySelector(".ProseMirror")?.textContent ?? ""')
        def visible(selector):
            return js('const el=[...document.querySelectorAll(arguments[0])].at(-1);if(!el)return false;const r=el.getBoundingClientRect(),v=document.querySelector(".rich-editor").getBoundingClientRect();return r.top>=v.top-1&&r.top<v.bottom', selector)
        def dirty_tab():
            return js('return !!document.querySelector(".tab.active .dirty-dot")')

        # Changes accumulate until reviewed, and can be stepped through and reverted one at a time.
        reviewed = folder / 'Review.md'
        code_block = b'```js\nconst kept = 1\n```\n'
        reviewed.write_bytes(b'Stays.\n\nWill change.\n\nKept one.\n\nGoes away.\n\nKept two.\n\n' + code_block)
        launch(reviewed)
        wait(lambda: 'Will change.' in rich_text(), 'document to review')
        assert not js('return !!document.querySelector(".changes-bar")')
        after_agent = b'Stays.\n\nDid change.\n\nKept one.\n\nKept two.\n\nBrand new.\n\n' + code_block
        reviewed.write_bytes(after_agent)
        wait(lambda: '3 changes' in body(), 'changed passages counted')
        wait(lambda: js('return document.querySelectorAll(".sidelit-change").length') == 2, 'changed passages marked, in a document ending in code')
        assert js('return document.querySelector(".sidelit-change-text").textContent') == 'Did'
        assert js('return document.querySelector(".sidelit-removed").dataset.removed') == 'Goes away.'
        assert 'Goes away.' not in rich_text() and not dirty_tab() and reviewed.read_bytes() == after_agent
        screenshot('changes-rich.png')
        click('Next')
        wait(lambda: js('return !!document.querySelector(".sidelit-removed.active")'), 'next change is active')
        click('Revert this')
        wait(lambda: 'Goes away.' in rich_text() and '2 changes' in body(), 'revert returns one passage to the draft')
        assert dirty_tab() and reviewed.read_bytes() == after_agent, 'revert must not write the file'
        click('Undo revert')
        wait(lambda: '3 changes' in body() and 'Goes away.' not in rich_text(), 'undo a revert')
        assert not dirty_tab() and reviewed.read_bytes() == after_agent
        after_agent += b'\nAnother.\n'
        reviewed.write_bytes(after_agent)
        wait(lambda: '4 changes' in body(), 'a later edit adds to what needs review')
        click('Compare')
        wait(lambda: 'Last reviewed version' in body(), 'compare with the last reviewed version')
        click('Back to draft')
        click('Source')
        wait(lambda: js('return document.querySelectorAll(".source-change").length') >= 2, 'changes marked in Source')
        js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"F8",bubbles:true}))')
        wait(lambda: js('return !!document.querySelector(".source-change.active")'), 'F8 steps through changes')
        screenshot('changes-source.png')
        click('Rendered')
        wait(lambda: js('return document.querySelectorAll(".sidelit-change").length') >= 2, 'marks return with the rich editor')
        request(f'/session/{session}/window/rect', {'width': 720, 'height': 630})
        time.sleep(.3)
        screenshot('changes-narrow.png')
        assert js('return document.documentElement.scrollWidth <= innerWidth'), 'the changes bar must not overflow a narrow window'
        request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
        click('Mark reviewed')
        wait(lambda: not js('return !!document.querySelector(".changes-bar,.sidelit-change,.sidelit-removed")'), 'marking reviewed clears the marks')
        assert not dirty_tab() and reviewed.read_bytes() == after_agent

        # Marks outlast a closed tab. The restart at the end of this test checks they outlast a crash too.
        pending = folder / 'Pending.md'
        pending.write_bytes(b'Kept.\n\nOld line.\n')
        launch(pending)
        wait(lambda: 'Old line.' in rich_text(), 'document to leave unreviewed')
        pending.write_bytes(b'Kept.\n\nNew line.\n')
        wait(lambda: '1 change' in body() and js('return document.querySelectorAll(".sidelit-change").length') == 1, 'unreviewed change marked')
        time.sleep(.3)
        js('document.querySelector(".tab.active .tab-close").click()')
        wait(lambda: not js('return [...document.querySelectorAll(".tab")].some(t=>t.textContent.startsWith("Pending.md"))'), 'tab closed with its changes unreviewed')
        launch(pending)
        wait(lambda: 'New line.' in rich_text() and '1 change' in body() and js('return document.querySelectorAll(".sidelit-change").length') == 1, 'marks return when the document reopens')
        assert not dirty_tab() and pending.read_bytes() == b'Kept.\n\nNew line.\n', 'restoring marks must not touch the document'
        js('document.querySelector(".tab.active .tab-close").click()')
        wait(lambda: not js('return [...document.querySelectorAll(".tab")].some(t=>t.textContent.startsWith("Pending.md"))'), 'tab closed again')

        # A rewrite that reads the same is not a change to review.
        spelling = folder / 'Spelling.md'
        spelling.write_bytes(b'- one\n- two\n\nSome _word_.\n')
        launch(spelling)
        wait(lambda: 'Some word.' in rich_text(), 'document to respell')
        spelling.write_bytes(b'* one\n* two\n\nSome *word*.\n')
        wait(lambda: 'Updated from disk' in body(), 'respelled document reloaded')
        time.sleep(.3)
        assert not js('return !!document.querySelector(".changes-bar,.sidelit-change")'), 'rewritten syntax must not be marked'
        spelling.write_bytes(b'* one\n* two\n\nSome *other*.\n')
        wait(lambda: '1 change' in body(), 'a real change after a rewrite is still marked')
        click('Mark reviewed')

        # Math is drawn while reading, without touching the bytes, and money stays money.
        math_doc = folder / 'Math.md'
        math_bytes = b'Energy $E=mc^2$ here.\n\nPrice $5 only, and $HOME too.\n\n$$\n\\frac{a}{b}\n$$\n\n`$code$` stays.\n\nSet $\\{a\\}$ here.\n\nEscaped \\$y\\$ stays.\n'
        math_doc.write_bytes(math_bytes)
        math_stamp = math_doc.stat().st_mtime_ns
        launch(math_doc)
        wait(lambda: js('return document.querySelectorAll(".ProseMirror .katex").length') == 3, 'inline and display math drawn')
        assert '{a}' in js('return [...document.querySelectorAll(".ProseMirror .katex")].map(a=>a.textContent).join("|")'), 'math must draw from its Markdown source: without its backslashes, KaTeX reads {a} as a group and draws no braces'
        assert 'Escaped $y$ stays.' in body(), 'escaped dollars stay text'
        assert js('return document.querySelectorAll(".math-display").length') == 1
        assert js('return getComputedStyle(document.querySelector(".math-source")).display') == 'none'
        assert 'Price $5 only, and $HOME too.' in body() and '$code$' in body() and 'E=mc^2$' not in body()
        assert not dirty_tab()
        screenshot('math.png')
        click('Save')
        time.sleep(.2)
        assert math_doc.read_bytes() == math_bytes and math_doc.stat().st_mtime_ns == math_stamp, 'drawing math must not change the file'
        edit_rendered()
        wait(lambda: js('return !document.querySelector(".ProseMirror .katex")') and '$E=mc^2$' in body(), 'math shows as source while editing')
        click('Done editing')
        wait(lambda: js('return document.querySelectorAll(".ProseMirror .katex").length') == 3, 'math drawn again after editing')
        assert not dirty_tab() and math_doc.read_bytes() == math_bytes

        # Outline, same-file anchors, links with anchors between documents, and pointers from the CLI.
        filler = b''.join(b'Filler paragraph %d.\n\n' % i for i in range(80))
        linked = folder / 'Linked.md'
        linked.write_bytes(b'# Top\n\n[Down](#far-section) and [Over](Other.md#second-part)\n\n' + filler + b'## Far Section\n\nThe far passage.\n')
        other = folder / 'Other.md'
        other.write_bytes(b'# First\n\n' + filler + b'## Second Part\n\nThe other passage.\n')
        launch(linked)
        wait(lambda: 'Filler paragraph 1.' in rich_text(), 'long linked document')
        click('Outline')
        wait(lambda: js('return [...document.querySelectorAll(".outline-list button")].map(b=>b.textContent).join("|")') == 'Top|Far Section', 'outline lists headings')
        assert not visible('.ProseMirror h2')
        screenshot('outline.png')
        click('Far Section')
        wait(lambda: visible('.ProseMirror h2'), 'outline scrolls to its heading')
        click('Top')
        wait(lambda: not visible('.ProseMirror h2'), 'outline scrolls back up')
        js('document.querySelector(".ProseMirror a[href=\'#far-section\']").click()')
        wait(lambda: visible('.ProseMirror h2'), 'same-file anchor scrolls to its heading')
        click('Top')
        wait(lambda: not visible('.ProseMirror h2'), 'back to the top')
        js('document.querySelector(".ProseMirror a[href^=\'Other.md\']").click()')
        wait(lambda: js('return document.querySelector(".tab.active")?.textContent').startswith('Other.md'), 'a link opens the other document')
        wait(lambda: visible('.ProseMirror h2'), 'a link anchor scrolls in the other document')
        launch('--find', 'the far passage', linked)
        wait(lambda: js('return document.querySelector(".tab.active")?.textContent').startswith('Linked.md') and js('return document.querySelectorAll(".selection-highlight i").length') > 0, 'find marks a passage')
        assert visible('.ProseMirror h2')
        screenshot('find.png')
        launch('--find', 'no such passage', linked)
        wait(lambda: 'Could not find “no such passage”' in body(), 'a missed find is reported')
        js('document.querySelector(".error-banner button").click()')
        launch('--source', '--find', 'The other passage', other)
        wait(lambda: js('return !!document.querySelector(".monaco-editor")') and js(source_editor() + 'return editor.getModel().getValueInRange(editor.getSelection())') == 'The other passage', 'find selects in Source')
        click('Rendered')
        page = folder / 'Page.html'
        page.write_text('<!doctype html><h1>Heading</h1><p style="margin-top:3000px">Deep passage</p>')
        launch('--find', 'not on this page', page)
        wait(lambda: 'Could not find “not on this page”' in body(), 'a missed find in a page is reported')
        js('document.querySelector(".error-banner button").click()')
        launch('--find', 'Deep passage', page)
        time.sleep(2.5)
        assert 'Could not find' not in body()
        screenshot('find-html.png')
        click('Files')

        # An agent can walk through several passages, with a note at each, across documents.
        launch('--find', 'Filler paragraph 40', '--note', 'Start here, because this is where it goes wrong.', '--find', 'The far passage', '--note', 'Then this.', linked)
        walk_text = lambda: js('return document.querySelector(".walk-bar")?.innerText||""')
        active_tab = lambda: js('return document.querySelector(".tab.active")?.textContent')
        wait(lambda: 'Stop 1 of 2' in walk_text() and 'Start here' in walk_text() and active_tab().startswith('Linked.md') and js('return document.querySelectorAll(".selection-highlight i").length') > 0, 'walkthrough opens at its first stop')
        screenshot('walk.png')
        click('Next')
        wait(lambda: 'Stop 2 of 2' in walk_text() and 'Then this.' in walk_text() and visible('.ProseMirror h2'), 'walkthrough moves to its next stop')
        launch('--then', '--find', 'The other passage', '--note', 'Last, the other document.', other)
        wait(lambda: 'Stop 2 of 3' in walk_text(), 'adding a stop leaves the person where they are')
        assert active_tab().startswith('Linked.md')
        js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"F9",bubbles:true}))')
        wait(lambda: 'Stop 3 of 3' in walk_text() and active_tab().startswith('Other.md'), 'F9 moves to a stop in another document')
        js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"F9",shiftKey:true,bubbles:true}))')
        wait(lambda: 'Stop 2 of 3' in walk_text() and active_tab().startswith('Linked.md'), 'Shift+F9 steps back')
        request(f'/session/{session}/window/rect', {'width': 720, 'height': 630})
        time.sleep(.3)
        assert js('return document.documentElement.scrollWidth <= innerWidth'), 'the walkthrough bar must not overflow a narrow window'
        screenshot('walk-narrow.png')
        request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
        click('Done')
        wait(lambda: not walk_text(), 'walkthrough dismissed')
        assert not dirty_tab()

        # Find in the rich editor marks text and code blocks, and never touches the draft.
        searchable = folder / 'Searchable.md'
        search_bytes = b'First needle here.\n\n' + filler + b'Second **nee**dle, split.\n\n```js\nconst needle = "needle"\n```\n\nA $needle$ in math.\n\nNo match here.\n'
        searchable.write_bytes(search_bytes)
        launch(searchable)
        wait(lambda: 'First needle' in rich_text(), 'document to search')
        press = lambda key, **more: js('window.dispatchEvent(new KeyboardEvent("keydown",Object.assign({key:arguments[0],metaKey:true,bubbles:true},arguments[1])))', key, more)
        def search_for(text):
            js('const el=document.querySelector(".find-bar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,arguments[0]);el.dispatchEvent(new Event("input",{bubbles:true}))', text)
        count = lambda: js('return document.querySelector(".find-count")?.textContent')
        press('f')
        wait(lambda: js('return document.activeElement===document.querySelector(".find-bar input")'), 'Find opens with its field focused')
        search_for('NEEDLE')
        wait(lambda: count() == '1 of 4', 'matches counted, case-insensitively, across marks and in code, not in drawn math')
        assert js('return document.querySelectorAll(".sidelit-find").length') >= 2 and js('return document.querySelector(".sidelit-find.active").textContent').lower() == 'needle'
        screenshot('find-bar.png')
        js('document.querySelector(".find-bar input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))')
        wait(lambda: count() == '2 of 4' and visible('.sidelit-find.active'), 'Enter moves to the next match and scrolls to it')
        press('g')
        wait(lambda: count() == '3 of 4' and js('return !!document.querySelector(".sidelit-find-block.active")'), 'a match in a code block marks the block')
        wait(lambda: js('return document.querySelectorAll(".selection-highlight i").length') > 0, 'the words in a code block are marked')
        screenshot('find-code.png')
        press('g', shiftKey=True)
        wait(lambda: count() == '2 of 4' and not js('return !!document.querySelector(".sidelit-find-block.active")'), 'Shift+Cmd+G moves back')
        search_for('nothing like this')
        wait(lambda: count() == 'No matches' and not js('return !!document.querySelector(".sidelit-find")'), 'no matches')
        search_for('needle')
        wait(lambda: count() == '1 of 4', 'searching again')
        edit_rendered()
        time.sleep(.3)
        assert not dirty_tab(), 'find must not touch the draft while editing'
        click('Done editing')
        js('document.querySelector(".find-bar input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
        wait(lambda: not js('return !!document.querySelector(".find-bar,.sidelit-find,.sidelit-find-block")'), 'Escape closes Find and clears its marks')
        click('Save')
        time.sleep(.2)
        assert not dirty_tab() and searchable.read_bytes() == search_bytes, 'find must not change the file'
        click('Source')
        wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'source for its own Find')
        press('f')
        time.sleep(.2)
        assert not js('return !!document.querySelector(".find-bar")'), 'Source keeps its own Find'
        click('Rendered')

        # Git status marks changed documents, and opening one compares it with the last commit.
        git = ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false']
        subprocess.run(git[:1] + ['init', '-q'], cwd=folder, check=True)
        untouched = folder / 'Untouched.md'
        untouched.write_text('# Committed\n\nCommitted text.\n')
        subprocess.run(git[:1] + ['add', '-A'], cwd=folder, check=True)
        subprocess.run(git + ['commit', '-q', '-m', 'fixture'], cwd=folder, check=True)
        untouched.write_text('# Committed\n\nChanged after the commit.\n')
        (folder / 'Fresh.md').write_text('# Fresh\n')
        wait(lambda: js('return [...document.querySelectorAll(".sidebar-views button")].at(-1).textContent') == 'Changed 2', 'changed documents counted', 30)
        wait(lambda: js('return [...document.querySelectorAll(".tree-row")].find(r=>r.textContent.startsWith("Untouched.md"))?.querySelector(".git-mark")?.textContent') == 'M', 'tree marks a changed document')
        assert js('return [...document.querySelectorAll(".tree-row")].find(r=>r.textContent.startsWith("Fresh.md"))?.querySelector(".git-mark")?.textContent') == 'A'
        js('[...document.querySelectorAll(".sidebar-views button")].at(-1).click()')
        wait(lambda: js('return [...document.querySelectorAll(".sidebar .tree-row")].length') == 2, 'changed list')
        screenshot('git-changed.png')
        js('[...document.querySelectorAll(".sidebar .tree-row")].find(r=>r.textContent.startsWith("Untouched.md")).click()')
        wait(lambda: 'since the last commit' in body() and '1 change' in body(), 'opening a changed document compares with the commit')
        wait(lambda: js('return document.querySelector(".sidelit-change-text")?.textContent.length > 0'), 'the committed difference is marked')
        assert not dirty_tab()
        click('Mark reviewed')

        # A dirty draft offers to go along with a request.
        click('Source')
        wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'source for a draft')
        source_edit('# Committed\n\nAn unsaved thought.\n')
        wait(dirty_tab, 'unsaved draft')
        js('document.querySelector(".feedback-button").click()')
        wait(lambda: 'Include my unsaved changes' in body(), 'offer to attach unsaved changes')
        screenshot('draft-request.png')
        click('Discard request')
        click('Save')
        wait(lambda: 'An unsaved thought.' in untouched.read_text(), 'draft saved')
        click('Rendered')
        click('Files')
    finally:
        js('window.__mermaidApi.publishPreview=window.__mermaidPublish;removeEventListener("message",window.__mermaidListener)')
    def rich_edit(text):
        wait(lambda: js('return !!document.querySelector(".ProseMirror p")'), 'editable paragraph')
        edit_rendered()
        js('const el=document.querySelector(".ProseMirror p");el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand("insertText",false,arguments[0])', text)
        wait(lambda: js('return !!document.querySelector(".tab.active .dirty-dot")'), 'new draft')

    readme = folder / 'README.md'
    readme.write_bytes((ROOT / 'README.md').read_bytes())
    shutil.copytree(ROOT / 'docs/images', folder / 'docs/images', dirs_exist_ok=True)
    readme_before = readme.read_bytes()
    readme_stamp = readme.stat().st_mtime_ns
    launch(readme)
    wait(lambda: js('return document.querySelectorAll(".ProseMirror svg").length >= 1'), 'project README diagram in the rich editor')
    assert not js('return !!document.querySelector(".tab.active .dirty-dot")')
    click('Source')
    wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'README source')
    assert source_text() == readme_before.decode()
    click('Rendered')
    wait(lambda: js('return document.querySelectorAll(".ProseMirror svg").length >= 1'), 'README diagram again')
    click('Save')
    time.sleep(.2)
    assert readme.read_bytes() == readme_before and readme.stat().st_mtime_ns == readme_stamp
    screenshot('readme-rendered.png')

    guide = folder / 'User guide.md'
    guide.write_bytes((ROOT / 'docs/user-guide.md').read_bytes())
    guide_before = guide.read_bytes()
    launch(guide)
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Using Sidelit', 'user guide rich view')
    rich_edit('User guide rendering regression check.')
    click('Save')
    wait(lambda: b'User guide rendering regression check.' in guide.read_bytes(), 'user guide rich save')
    blocks = r'^```[^\n]*\n(.*?)^```[ \t]*(?:\n|$)'
    assert re.findall(blocks, guide.read_text(), re.M | re.S) == re.findall(blocks, guide_before.decode(), re.M | re.S), 'rich edits must preserve literal shell code'
    assert b'$HOME' in guide.read_bytes() and b'$PWD' in guide.read_bytes()

    literal = folder / 'literal-code.md'
    literal.write_text('# Literal code\n\nUse `$HOME` and `\\\\(x\\\\)` literally.\n\n```html\n<script>window.__literalExecuted=true</script>\n```\n')
    launch(literal)
    wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Literal code', 'literal code rendered')
    assert not js('return !!window.__literalExecuted || !!document.querySelector(".ProseMirror script")')
    rich_edit('Literal code stays inert.')
    click('Save')
    wait(lambda: 'Literal code stays inert.' in literal.read_text(), 'literal code saved')
    assert '<script>window.__literalExecuted=true</script>' in literal.read_text()
    assert not js('return !!window.__literalExecuted')

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
    history_action('undo')
    wait(lambda: not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'frontmatter undo restores exact text')
    assert metadata.read_bytes() == untouched
    history_action('redo', menu=True)
    wait(lambda: 'Edited body, unchanged metadata.' in body(), 'frontmatter redo')
    click('Save')
    wait(lambda: b'Edited body' in metadata.read_bytes(), 'frontmatter body saved')
    assert metadata.read_bytes().startswith(prefix)
    assert b'\n' not in metadata.read_bytes().replace(b'\r\n', b'')
    screenshot('frontmatter.png')

    money = folder / 'money.md'
    money.write_text('Price $5\n')
    launch(money)
    wait(lambda: js('return document.querySelector(".ProseMirror")?.textContent.includes("Price $5")'), 'dollar sign opens in the rich editor')
    click('Source')
    wait(lambda: js('return !!document.querySelector(".monaco-editor")'), 'explicit Source')
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
    history_action('undo')
    wait(lambda: 'Last base.' in source_text(), 'undo selected disk change')
    history_action('redo', menu=True)
    wait(lambda: 'Last disk.' in source_text(), 'redo selected disk change')
    js(source_editor() + 'editor.getOriginalEditor().focus()')
    history_action('undo')
    time.sleep(.15)
    assert 'Last disk.' in source_text(), 'Undo in the read-only disk pane must not edit the draft'
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
    wait(lambda: 'Compare' in body() and js('return !!document.querySelector(".changes-bar")'), 'clean change review')
    click('Compare')
    wait(lambda: js('return !!document.querySelector(".monaco-diff-editor")'), 'clean comparison')
    assert js(source_editor() + 'return editor.getModifiedEditor().getRawOptions().readOnly')
    review_text = source_text()
    history_action('undo', menu=True)
    history_action('redo')
    time.sleep(.15)
    assert source_text() == review_text and not js('return !!document.querySelector(".tab.active .dirty-dot")'), 'review history is read only'
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
    assert not js('return document.querySelector(".app-menu").open'), 'file actions close Actions'
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
    time.sleep(.5)
    session = request('/session', {'capabilities': {}})['sessionId']
    # A script sent during navigation is lost; fail fast and retry instead of waiting 30 seconds.
    request(f'/session/{session}/timeouts', {'script': 5000})
    wait(lambda: 'Restore your last session?' in body(), 'restart recovery offer', timeout=30)
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
    # Left unreviewed and closed long before the crash above.
    launch(pending)
    wait(lambda: '1 change' in body() and js('return document.querySelectorAll(".sidelit-change").length') == 1, 'marks survive a crash and restart')
    assert pending.read_bytes() == b'Kept.\n\nNew line.\n'
    click('Mark reviewed')
    wait(lambda: not js('return !!document.querySelector(".changes-bar")'), 'reviewed after restart')
    time.sleep(.3)
    js('document.querySelector(".tab.active .tab-close").click()')
    wait(lambda: not js('return [...document.querySelectorAll(".tab")].some(t=>t.textContent.startsWith("Pending.md"))'), 'closed once reviewed')
    launch(pending)
    wait(lambda: js('return document.querySelector(".tab.active")?.textContent').startswith('Pending.md'), 'reopened once reviewed')
    time.sleep(.5)
    assert not js('return !!document.querySelector(".changes-bar")'), 'marking reviewed must delete the saved baseline'
    errors = errors_before_crash + js('return __errors')
    assert errors == [], errors
    focus = guard.check()
    report = {**focus, 'handoffSeconds': timing, 'editorReadySeconds': ready_seconds, 'warmHandoffSeconds': warm, 'workers': workers_before_crash + js('return __workers'), 'errors': errors, 'checks': 'Saved marks across close and crash; rewrites not marked; math from source; walkthroughs; Find; Change marks, stepping, revert and undo; math with byte preservation; outline, anchors and --find in the rich editor, Source and HTML; Git marks and commit comparison; comments and raw HTML in the rich editor with byte preservation; Mermaid in the rich editor, invalid diagrams, CRLF no-op save, themes and narrow layout; MDX split with live render, last good render and recovery; Source selection actions; Crepe input; Monaco input; 80% rendered column and narrow gutter; keyboard/menu undo and redo in both editors, code blocks, and search inputs; disk reload history reset; undo/redo disk adoption; read-only history guards; CRLF; no-op save; mode/tab switches; clean refresh; conflict/diff; discard/cancel; rename; delete/recreate; repeated CLI; Unicode/caller cwd; local image and alt fidelity; project README preview/mode/no-op save; user guide rich editing; literal code preserved and HTML examples inert; frontmatter; dirty close/quit cancel; save on close; task/numbered/nested/wrapped list alignment at 12–28px; local fonts; One themes; system preference; live sizing without editor remounts; opaque frontmatter rich editing; sticky Source; scoped Quick Open; background close selection; editable diff and keyboard change acceptance; stale merged-save rejection; clean change review; New/Save As UI (native selection simulated); Save As cancel/failure; recovery checkpoint, process crash, restart, conflict-safe restore (native approval simulated), and deletion'}
    (OUT / 'desktop.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    # Close only the temporary documents; the app remains available for manual checks.
    for _ in range(12):
        js('const b=[...document.querySelectorAll(".tab-close")].find(b=>b.closest(".tab").querySelector("button[title]").title.startsWith(arguments[0]));if(b)b.click()', str(folder))
        time.sleep(.2)
    set_theme('system')
    set_size(16)
    launch(ROOT / 'samples')
