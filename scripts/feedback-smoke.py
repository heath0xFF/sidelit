"""Read-only product UX probes against the disposable packaged test app."""
import base64, json, os, plistlib, shutil, signal, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BINARY = Path(os.environ['SIDELIT_TEST_BINARY'])
OUT = ROOT / 'test-results/ux-review'
OUT.mkdir(exist_ok=True)
with (BINARY.parents[1] / 'Info.plist').open('rb') as f:
    identifier = plistlib.load(f)['CFBundleIdentifier']
    assert identifier != 'app.sidelit.desktop'
with socket.socket() as s:
    assert s.connect_ex(('127.0.0.1', 4445)) != 0, 'Another test app owns WebDriver'

def req(path, body=None):
    r = urllib.request.Request('http://127.0.0.1:4445' + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=15) as f:
        v = json.load(f)['value']
    assert not isinstance(v, dict) or 'error' not in v, v
    return v

def wait(fn):
    for _ in range(100):
        try:
            if fn(): return
        except (OSError, AssertionError): pass
        time.sleep(.1)
    raise AssertionError('Timed out')

def launch(path):
    subprocess.run([str(BINARY), str(path)], check=True, capture_output=True, timeout=20)

report = {}
try:
    with tempfile.TemporaryDirectory(prefix='sidelit-ux-') as folder:
        folder = Path(folder).resolve()
        document = folder / 'reading.md'
        original = '# Reading and asking\n\nThis passage deserves a closer explanation.\n\n## Another section\n\nKeep my request while I keep reading.\n'
        document.write_text(original)
        launch(folder)
        launch(document)
        wait(lambda: req('/status')['ready'])
        session = req('/session', {'capabilities': {}})['sessionId']
        if shutil.which('aerospace'):
            windows = subprocess.check_output(['aerospace', 'list-windows', '--all', '--format', '%{window-id} %{app-bundle-id}'], text=True)
            for line in windows.splitlines():
                if line.endswith(' ' + identifier): subprocess.run(['aerospace', 'layout', '--window-id', line.split()[0], 'floating'], check=True)
        def js(script, *args):
            return req(f'/session/{session}/execute/sync', {'script': script, 'args': list(args)})
        def input_text(value):
            js('const el=document.querySelector(".feedback-panel textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,arguments[0]);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))', value)
        def feedback():
            js('document.querySelector(".feedback-button").click()')
            wait(lambda: js('return document.querySelector(".feedback-panel")?.hidden === false'))
        wait(lambda: js('return !!document.querySelector(".ProseMirror p")'))
        req(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
        report['markdownEditable'] = js('return document.querySelector(".ProseMirror").isContentEditable')
        assert not report['markdownEditable']
        js('const p=document.querySelector(".ProseMirror p");const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))')
        wait(lambda: js('return document.querySelector("button[aria-label=Feedback]").classList.contains("tool-active")'))
        report['textSelectionAutomaticallyOpensComposer'] = js('return !!document.querySelector(".feedback-panel")')
        assert not report['textSelectionAutomaticallyOpensComposer']
        wait(lambda: js('return !!document.querySelector(".selection-actions")'))
        (OUT / 'selection-actions.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        js('document.querySelector(".selection-actions button").click()')
        wait(lambda: js('return !!document.querySelector(".feedback-panel textarea")'))
        assert js('return document.querySelector(".feedback-heading button[aria-pressed=true]").textContent') == 'Explain'
        wait(lambda: js('return !!document.querySelector(".selection-highlight i")'))
        (OUT / 'attached-selection.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        input_text('Explain how this works without changing the document.')
        feedback()
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Explain how this works without changing the document.'
        js('document.querySelector(".feedback-panel textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
        wait(lambda: js('return document.querySelector(".feedback-panel").hidden && !document.querySelector(".selection-highlight")'))
        assert js('return document.querySelector(".feedback-button").textContent') == 'Unsent draft'
        assert js('return document.querySelector(".feedback-button").getAttribute("aria-label")') == 'Resume unsent draft'
        req(f'/session/{session}/window/rect', {'width': 720, 'height': 480})
        wait(lambda: js('const b=document.querySelector(".feedback-button"),r=b.getBoundingClientRect();return getComputedStyle(b.querySelector("span")).display!=="none" && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth'))
        (OUT / 'hidden-draft-narrow.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        req(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
        feedback()
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Explain how this works without changing the document.'
        wait(lambda: js('return !!document.querySelector(".selection-highlight i")'))
        js('document.querySelector(".reveal-selection").click()')
        wait(lambda: js('return document.querySelector(".feedback-panel").hidden && !!document.querySelector(".selection-highlight i")'))
        js('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
        wait(lambda: js('return !document.querySelector(".selection-highlight")'))
        feedback()
        js('document.querySelector("button[aria-label=\\"Dismiss feedback, keep draft\\"]").click()')
        wait(lambda: js('return document.querySelector(".feedback-panel").hidden && !document.querySelector(".selection-highlight")'))
        report['dismissClearsHighlightAndKeepsDraft'] = True
        report['unsentDraftVisibleAtMinimumSize'] = True
        js('const p=document.querySelector(".ProseMirror h2");const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))')
        js('[...document.querySelectorAll(".selection-actions button")].find(b=>b.textContent==="Edit").click()')
        wait(lambda: js('return document.body.innerText.includes("Use new selection")'))
        js('[...document.querySelectorAll(".feedback-panel button")].find(b=>b.textContent==="Use new selection").click()')
        assert js('return document.querySelector(".feedback-heading button[aria-pressed=true]").textContent') == 'Explain'
        report['replacementPreservesIntent'] = True
        js('[...document.querySelectorAll(".feedback-panel button")].find(b=>b.textContent==="Discard request").click()')
        wait(lambda: js('return !document.querySelector(".feedback-panel")'))
        assert js('return document.querySelector(".feedback-button").textContent') == 'Feedback'
        js('const p=document.querySelector(".ProseMirror p");const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))')
        document.write_text(original + '\nChanged before opening the request.\n')
        wait(lambda: js('return document.querySelector(".ProseMirror").innerText.includes("Changed before opening")'))
        js('document.querySelector(".selection-actions button").click()')
        wait(lambda: js('return document.body.innerText.includes("This capture may no longer match")'))
        report['capturePredatesComposer'] = True
        js('[...document.querySelectorAll(".feedback-panel button")].find(b=>b.textContent==="Discard request").click()')
        document.write_text(original)
        wait(lambda: js('return !document.querySelector(".ProseMirror").innerText.includes("Changed before opening")'))
        js('getSelection().removeAllRanges();document.querySelector(".ProseMirror h2").dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))')
        feedback()
        report['contextAfterCollapsingSelection'] = js('return document.querySelector(".feedback-context").innerText')
        assert 'current document' in report['contextAfterCollapsingSelection']
        input_text('Explain how this works without changing the document.')
        wait(lambda: js('return document.querySelector(".feedback-panel textarea").value.length>0'))
        feedback()
        time.sleep(.2)
        report['draftAfterRepeatedFeedbackAction'] = js('return document.querySelector(".feedback-panel textarea").value')
        assert report['draftAfterRepeatedFeedbackAction'] == 'Explain how this works without changing the document.'
        input_text('Keep this unsent request.')
        js('document.querySelector(".feedback-panel textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
        wait(lambda: js('return document.querySelector(".feedback-panel").hidden'))
        feedback()
        report['draftAfterEscapeAndReopen'] = js('return document.querySelector(".feedback-panel textarea").value')
        assert report['draftAfterEscapeAndReopen'] == 'Keep this unsent request.'
        other = folder / 'other.md'; other.write_text('# Another document\n\nOther content.\n')
        launch(other)
        wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Another document')
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Keep this unsent request.'
        assert js('return document.querySelector(".feedback-document").textContent') == 'reading.md'
        launch(document)
        wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Reading and asking')
        document.write_text(original + '\nAn external update.\n')
        wait(lambda: js('return document.body.innerText.includes("This capture may no longer match")'))
        report['staleContextDisclosed'] = True
        input_text('Explain how this works without changing the document.')
        (OUT / 'reading-feedback.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        req(f'/session/{session}/window/rect', {'width': 720, 'height': 630})
        time.sleep(.2)
        assert js('return document.documentElement.scrollWidth <= innerWidth')
        (OUT / 'narrow-feedback.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        def delivery_visible():
            return js('const panel=document.querySelector(".feedback-panel").getBoundingClientRect();const footer=document.querySelector(".feedback-delivery").getBoundingClientRect();return footer.top>=panel.top && footer.bottom<=panel.bottom+1 && footer.bottom<innerHeight && footer.right<=innerWidth')
        assert delivery_visible(), 'Narrow composer must keep delivery controls visible'
        req(f'/session/{session}/window/rect', {'width': 720, 'height': 480})
        time.sleep(.2)
        assert delivery_visible(), 'Minimum window must keep delivery controls visible'
        (OUT / 'minimum-feedback.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        report['documentBytesUnchangedByApp'] = document.read_text() == original + '\nAn external update.\n'
        assert report['documentBytesUnchangedByApp']
        report['sentAnyFeedback'] = False
finally:
    for line in subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True).splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1] == str(BINARY):
            os.kill(int(parts[0]), signal.SIGTERM)
(OUT / 'probe.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
