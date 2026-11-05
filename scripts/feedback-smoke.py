"""Read-only product UX probes against the disposable packaged test app."""
import base64, json, os, plistlib, shutil, signal, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path

from focus_guard import FocusGuard

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
        guard = FocusGuard(BINARY)
        launch(folder)
        launch(document)
        wait(lambda: req('/status')['ready'])
        session = req('/session', {'capabilities': {}})['sessionId']
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
        # Keep delivery faults in the test API object, outside the shipping bridge.
        js('[...document.querySelectorAll(".feedback-panel button")].find(b=>b.textContent==="Discard request").click()')
        js('document.querySelector(".error-banner button")?.click()')
        js('''import(document.querySelector('script[type=module]').src).then(m=>{
          const api=Object.values(m).find(v=>v&&typeof v.sendFeedback==='function');
          window.__sent=[];window.__settled=false;
          api.agentTargets=async()=>[{id:'fixture-pi',label:'Fixture Pi',projectRoot:arguments[0],connected:true,busy:false}];
          api.sendFeedback=async(_target,message)=>{__sent.push(message);if(__sent.length===2)throw Error('Fixture lost receipt');return {id:message.id,status:'received',delivery:'queued'}};
          api.feedbackStatus=async(_target,id)=>({id,status:__settled?'settled':'received',delivery:__settled?'consumed':'queued'});
          const path=arguments[1];api.requestChanges=async()=>({files:[{path,status:'modified'}],incomplete:false});
          window.__requestsFixture=true;
        })''', str(folder), str(document))
        wait(lambda: js('return window.__requestsFixture'))
        for index, intent in enumerate(['Explain', 'Review', 'Edit']):
            js('const p=document.querySelector(arguments[0]),r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))', '.ProseMirror h2' if index == 1 else '.ProseMirror p')
            wait(lambda: js('return !!document.querySelector(".selection-actions")'))
            js('[...document.querySelectorAll(".selection-actions button")].find(b=>b.textContent===arguments[0]).click()', intent)
            wait(lambda: js('return document.querySelector(".feedback-heading button[aria-pressed=true]")?.textContent') == intent)
            assert js('return document.querySelector(".feedback-panel textarea").value') == ''
            assert not js('return document.querySelector(".feedback-panel textarea").readOnly')
            if index == 2:
                input_text('Keep this unsent edit while I read history.')
                break
            wait(lambda: js('return [...document.querySelectorAll(".feedback-panel button")].some(b=>b.textContent==="Send to Pi"&&!b.disabled)'))
            js('[...document.querySelectorAll(".feedback-panel button")].find(b=>b.textContent==="Send to Pi").click()')
            wait(lambda: js('return __sent.length') == index + 1)
            if index == 1:
                wait(lambda: js('return document.querySelector(".feedback-panel .error")?.textContent.includes("Fixture lost receipt")'))
        assert js('return new Set(__sent.map(m=>m.id)).size') == 2
        js('window.__settled=true;if(!document.querySelector(".sidebar"))document.querySelector(".sidebar-toggle").click();[...document.querySelectorAll(".sidebar-views button")].find(b=>b.textContent==="Requests").click()')
        wait(lambda: js('return document.querySelectorAll(".request-history > ul > li").length') == 2)
        wait(lambda: js('return [...document.querySelectorAll(".request-history-status")].some(n=>n.textContent==="Pi finished · not verified")'))
        js('document.querySelector(".request-history summary").click()')
        wait(lambda: js('return document.querySelector(".feedback-panel").hidden'))
        js('[...document.querySelectorAll(".request-history button")].find(b=>b.textContent==="Check receipt").click()')
        wait(lambda: js('return [...document.querySelectorAll(".request-history-status")].every(n=>n.textContent==="Pi finished · not verified")'))
        assert js('return __sent.length') == 2, 'Checking a receipt must not send again'
        assert not js('return !!document.querySelector(".error-banner")'), 'Fresh selections must not use an earlier attachment'
        for theme, width, height in [('dark', 1180, 820), ('light', 720, 480)]:
            req(f'/session/{session}/window/rect', {'width': width, 'height': height})
            js('const s=document.querySelector("select[aria-label=Theme]");s.value=arguments[0];s.dispatchEvent(new Event("change",{bubbles:true}))', theme)
            time.sleep(.2)
            assert js('return document.documentElement.scrollWidth<=innerWidth && document.querySelector(".sidebar").scrollWidth<=document.querySelector(".sidebar").clientWidth')
            (OUT / f'requests-{theme}.png').write_bytes(base64.b64decode(req(f'/session/{session}/screenshot')))
        js('document.querySelector(".request-history .request-file").click()')
        wait(lambda: js('return document.querySelector(".error-banner")?.textContent.includes("No before-version")'))
        assert 'since you last reviewed' in js('return document.querySelector(".changes-bar").textContent')
        feedback()
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Keep this unsent edit while I read history.'
        assert document.read_text() == original + '\nAn external update.\n'
        report['freshRequestForEachIntent'] = True
        report['historyPreservesUnsentDraft'] = True
        report['backgroundReceiptsAndUncertainDelivery'] = True
        report['expiredRequestSnapshotKeepsReviewMarks'] = True
        report.update(guard.check())
finally:
    for line in subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True).splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1] == str(BINARY):
            os.kill(int(parts[0]), signal.SIGTERM)
(OUT / 'probe.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
