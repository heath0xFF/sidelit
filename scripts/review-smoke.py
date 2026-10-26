#!/usr/bin/env python3
"""Check saved review notes and retry safety in the isolated packaged app."""
import base64
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
BINARY = Path(os.environ['SIDELIT_TEST_BINARY'])
with (BINARY.parents[1] / 'Info.plist').open('rb') as file:
    identifier = plistlib.load(file)['CFBundleIdentifier']
assert identifier != 'app.sidelit.desktop', 'Use an isolated desktop-test bundle.'
with socket.socket() as probe:
    assert probe.connect_ex(('127.0.0.1', 4445)) != 0, 'Another test app owns WebDriver'
OUT = ROOT / 'test-results/review'
OUT.mkdir(parents=True, exist_ok=True)


def request(path, body=None):
    req = urllib.request.Request('http://127.0.0.1:4445' + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as response:
        value = json.load(response)['value']
    assert not isinstance(value, dict) or 'error' not in value, value
    return value


def wait(check, label):
    for _ in range(150):
        try:
            value = check()
            if value:
                return value
        except (OSError, AssertionError):
            pass
        time.sleep(.1)
    raise AssertionError('Timed out: ' + label)


def stop():
    for line in subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True).splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1] == str(BINARY):
            os.kill(int(parts[0]), signal.SIGTERM)
    wait(lambda: not listening(), 'test app stopped')


def listening():
    with socket.socket() as probe:
        return probe.connect_ex(('127.0.0.1', 4445)) == 0


def launch(path):
    subprocess.run([str(BINARY), str(path)], check=True, capture_output=True, timeout=20)


with tempfile.TemporaryDirectory(prefix='sidelit-review-') as tmp:
    folder = Path(tmp).resolve()
    first, second = folder / 'first.md', folder / 'second.md'
    first.write_bytes(b'# First review\r\n\r\nA passage worth explaining.\r\n')
    second.write_text('# Second review\n\nA paragraph that needs a change.\n')
    originals = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in [first, second]}
    registry = Path(f'/tmp/sidelit-pi-{os.getuid()}')
    registry.mkdir(mode=0o700, exist_ok=True)
    assert not registry.is_symlink() and registry.stat().st_uid == os.getuid() and registry.stat().st_mode & 0o077 == 0
    target = 'review-test-' + uuid.uuid4().hex
    socket_path = registry / (target + '.sock')
    registration = registry / (target + '.json')
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(socket_path)); os.chmod(socket_path, 0o600); server.listen(); server.settimeout(.2)
    registration.write_text(json.dumps({'id': target, 'socketPath': str(socket_path), 'projectRoot': str(folder), 'label': 'Review test Pi', 'busy': True, 'pid': os.getpid()}))
    os.chmod(registration, 0o600)
    received, deliveries, stopped = {}, [], threading.Event()

    def receive():
        while not stopped.is_set():
            try:
                connection, _ = server.accept()
            except socket.timeout:
                continue
            with connection:
                connection.settimeout(3)
                value = json.loads(connection.makefile('rb').readline(32769))
                if value.get('op') == 'ping':
                    ack = {'id': value['id'], 'status': 'ready', 'protocol': 1}
                elif value.get('op') == 'status':
                    ack = {'id': value['id'], 'status': 'accepted', 'delivery': 'consumed'}
                else:
                    deliveries.append(value)
                    previous = received.get(value['id'])
                    if previous:
                        assert previous == value, 'Retry changed the batch'
                    else:
                        received[value['id']] = value
                        # Drop the first receipt after recording the batch.
                        continue
                    ack = {'id': value['id'], 'status': 'duplicate', 'delivery': 'consumed'}
                connection.sendall(json.dumps(ack).encode() + b'\n')
    thread = threading.Thread(target=receive, daemon=True); thread.start()
    try:
        launch(folder); launch(first)
        wait(lambda: request('/status')['ready'], 'WebDriver')
        session = request('/session', {'capabilities': {}})['sessionId']

        def js(script, *args):
            return request(f'/session/{session}/execute/sync', {'script': script, 'args': list(args)})

        def click(text, scope='document'):
            assert js('const root=arguments[1]==="document"?document:document.querySelector(arguments[1]);const b=[...root.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);if(!b||b.disabled)return false;b.click();return true', text, scope), text

        def notes():
            wait(lambda: js('return !!document.querySelector("button[aria-label^=\\"Review notes (\\"]")'), 'notes button')
            js('document.querySelector("button[aria-label^=\\"Review notes (\\"]").click()')
            wait(lambda: js('return !document.querySelector(".review-panel").hidden'), 'review list')

        def compose(intent, instruction):
            wait(lambda: js('return !!document.querySelector(".ProseMirror p")'), 'rendered paragraph')
            js('const p=document.querySelector(".ProseMirror p"),r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))')
            wait(lambda: js('return !!document.querySelector(".selection-actions")'), 'selection actions')
            click(intent, '.selection-actions')
            js('const input=document.querySelector(".feedback-panel textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,arguments[0]);input.dispatchEvent(new Event("input",{bubbles:true}))', instruction)

        def collect(intent, instruction):
            compose(intent, instruction)
            wait(lambda: js('return [...document.querySelectorAll(".feedback-panel button")].some(b=>b.textContent==="Add to review"&&!b.disabled)'), 'save enabled')
            click('Add to review', '.feedback-panel')
            wait(lambda: js('return !document.querySelector(".feedback-panel")'), 'note saved')

        def capture(name):
            (OUT / name).write_bytes(base64.b64decode(request(f'/session/{session}/screenshot')))

        def size(width, height):
            if shutil.which('aerospace'):
                windows = subprocess.check_output(['aerospace', 'list-windows', '--all', '--format', '%{window-id} %{app-bundle-id}'], text=True)
                for line in windows.splitlines():
                    if line.endswith(' ' + identifier):
                        subprocess.run(['aerospace', 'layout', '--window-id', line.split()[0], 'floating'], check=True)
            request(f'/session/{session}/window/rect', {'width': width, 'height': height})
            time.sleep(.2)

        notes()
        if js('return document.querySelectorAll(".review-list li").length'):
            click('Delete all saved notes', '.review-panel'); click('Remove', 'dialog[open]')
            wait(lambda: js('return !document.querySelectorAll(".review-list li").length'), 'old test notes cleared')
        click('Hide', '.review-panel')
        collect('Explain', 'Explain this passage without editing files.')
        launch(second); wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'Second review', 'second document')
        collect('Edit', 'Make the paragraph more direct.')
        notes(); wait(lambda: js('return document.querySelectorAll(".review-list li").length') == 2, 'two saved notes')
        click('Edit note', '.review-panel')
        wait(lambda: js('return !!document.querySelector(".feedback-panel textarea")'), 'saved note editor')
        assert not js('return [...document.querySelectorAll(".feedback-panel button")].some(b=>b.textContent==="Send to Pi")')
        js('const input=document.querySelector(".feedback-panel textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"Explain this passage carefully without editing files.");input.dispatchEvent(new Event("input",{bubbles:true}))')
        click('Hide', '.feedback-panel'); notes(); click('Edit note', '.review-panel')
        wait(lambda: js('return !document.querySelector(".feedback-panel").hidden'), 'resume note edit')
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Explain this passage carefully without editing files.'
        click('Save note', '.feedback-panel')
        wait(lambda: js('return !document.querySelector(".review-panel").hidden'), 'return to list')
        click('Reveal selection', '.review-panel')
        wait(lambda: js('return document.querySelector(".ProseMirror h1")?.textContent') == 'First review', 'reveal original document')
        wait(lambda: js('return !!document.querySelector(".selection-highlight i")'), 'selection highlight')
        js('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
        wait(lambda: js('return !document.querySelector(".selection-highlight")'), 'dismiss revealed note highlight')
        notes()
        js('document.querySelectorAll(".review-note-choice input").forEach(input=>input.click())')
        wait(lambda: js('return document.querySelector(".review-payload pre")?.textContent.includes("Make the paragraph")'), 'exact batch payload')
        assert js('return document.querySelector("select[aria-label=\\"Review target\\"]").value') == ''
        wait(lambda: js('return !!document.querySelector("select[aria-label=\\"Review target\\"] option[value=\\"'+target+'\\"]")'), 'test Pi target')
        js('const s=document.querySelector("select[aria-label=\\"Review target\\"]");s.value=arguments[0];s.dispatchEvent(new Event("change",{bubbles:true}))', target)
        js('const s=document.querySelector("select[aria-label=Theme]");s.value="dark";s.dispatchEvent(new Event("change",{bubbles:true}))')
        size(1180, 820); capture('notes-dark.png')
        click('Send selected to Pi', '.review-panel')
        wait(lambda: len(deliveries) == 1 and js('return document.querySelector(".review-panel .error")?.textContent'), 'uncertain delivery')
        assert len(received) == 1 and len(deliveries[0]['notes']) == 2
        assert deliveries[0]['notes'][0]['intent'] == 'explain' and deliveries[0]['notes'][1]['intent'] == 'edit'
        assert 'anchorText' not in deliveries[0]['notes'][0]['selection']
        state_path = Path.home() / 'Library/Application Support' / identifier / 'review/notes.json'
        stored = json.loads(state_path.read_text())
        assert stored['attempt']['message']['id'] == deliveries[0]['id']
        assert state_path.stat().st_mode & 0o777 == 0o600
        stop(); launch(first)
        wait(lambda: request('/status')['ready'], 'restarted WebDriver')
        session = request('/session', {'capabilities': {}})['sessionId']
        notes(); wait(lambda: js('return document.querySelectorAll(".review-list li").length') == 2, 'restored notes')
        time.sleep(.3); assert len(deliveries) == 1, 'Restart must not send'
        wait(lambda: js('return !!document.querySelector(".review-stale input")'), 'restored-context consent')
        js('document.querySelector(".review-stale input").click()')
        wait(lambda: js('return [...document.querySelectorAll(".review-panel button")].some(b=>b.textContent==="Retry batch"&&!b.disabled)'), 'retry ready')
        click('Retry batch', '.review-panel')
        wait(lambda: js('return document.querySelector(".review-panel").innerText.includes("Pi accepted")'), 'accepted retry')
        assert len(deliveries) == 2 and deliveries[0] == deliveries[1] and len(received) == 1
        size(720, 480)
        js('const s=document.querySelector("select[aria-label=Theme]");s.value="light";s.dispatchEvent(new Event("change",{bubbles:true}))')
        time.sleep(.2)
        assert js('const p=document.querySelector(".review-panel").getBoundingClientRect(),f=document.querySelector(".review-panel .feedback-delivery").getBoundingClientRect();return f.bottom<=p.bottom+1&&p.bottom<innerHeight&&f.right<=innerWidth'), 'Delivery controls must fit'
        capture('notes-light-minimum.png')
        click('Remove attempted notes', '.review-panel'); click('Remove', 'dialog[open]')
        wait(lambda: js('return !document.querySelectorAll(".review-list li").length'), 'attempt removed')
        assert not state_path.exists()
        click('Hide', '.review-panel')
        compose('Explain', 'Keep this request when I quit.')
        click('Hide', '.feedback-panel')

        def exit_request(native=False):
            js('void window.__TAURI_INTERNALS__.invoke("plugin:event|emit",{event:arguments[0],payload:arguments[1]})', 'request-quit' if native else 'menu-action', None if native else 'quit')

        def exit_prompt():
            wait(lambda: js('return document.querySelector("dialog[open]")?.textContent.includes("Save to Notes")'), 'request exit prompt')

        def exit_choice(text):
            js('const b=[...document.querySelectorAll("dialog[open] button")].find(b=>b.textContent===arguments[0]);if(!b)throw Error("Missing exit choice");setTimeout(()=>b.click(),100)', text)

        exit_request(); exit_prompt()
        assert js('return document.activeElement.textContent') == 'Cancel'
        capture('quit-unsent-light.png')
        click('Cancel', 'dialog[open]')
        wait(lambda: js('return !document.querySelector("dialog[open]")'), 'cancel quit')
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Keep this request when I quit.'
        assert not state_path.exists()
        js('const s=document.querySelector("select[aria-label=Theme]");s.value="dark";s.dispatchEvent(new Event("change",{bubbles:true}))')
        size(1180, 820)
        exit_request(native=True); exit_prompt(); capture('quit-unsent-dark.png')
        js('document.querySelector("dialog[open]").dispatchEvent(new Event("cancel",{cancelable:true}))')
        wait(lambda: js('return !document.querySelector("dialog[open]")'), 'Escape cancels native close')

        # Faults stay in the test API object; no shipping test hooks or real updates.
        js('import(document.querySelector("script[type=module]").src).then(m=>{window.__exitApi=Object.values(m).find(v=>v&&typeof v.storeReview==="function");window.__storeReview=__exitApi.storeReview;__exitApi.storeReview=async()=>{throw Error("test note storage failure")}})')
        wait(lambda: js('return !!window.__storeReview'), 'storage fault injection')
        exit_request(); exit_prompt(); click('Save to Notes', 'dialog[open]')
        wait(lambda: js('return document.querySelector(".error-banner")?.textContent.includes("test note storage failure")'), 'failed save prevents quit')
        assert js('return !document.querySelector(".app").inert && document.querySelector(".feedback-panel textarea").value === "Keep this request when I quit."')
        assert not state_path.exists()
        js('__exitApi.storeReview=__storeReview;window.__installs=0;__exitApi.checkUpdate=async()=>({version:"999.0.0",currentVersion:"0.3.0"});__exitApi.installUpdate=async()=>{__installs++;throw Error("test update failure")};void window.__TAURI_INTERNALS__.invoke("plugin:event|emit",{event:"menu-action",payload:"updates"})')
        wait(lambda: js('return [...document.querySelectorAll("button")].some(b=>b.textContent==="Install & Restart")'), 'test update offer')
        click('Install & Restart'); exit_prompt()
        assert js('return document.querySelector("dialog[open] h2").textContent.includes("restarting")')
        click('Cancel', 'dialog[open]')
        assert js('return __installs') == 0
        click('Install & Restart'); exit_prompt(); click('Discard', 'dialog[open]')
        wait(lambda: js('return __installs===1 && !document.querySelector(".app").inert'), 'failed update restores editing')
        assert js('return document.querySelector(".feedback-panel textarea").value') == 'Keep this request when I quit.'

        exit_request(); exit_prompt(); exit_choice('Save to Notes')
        wait(lambda: not listening(), 'save note then quit')
        saved = json.loads(state_path.read_text())['notes']
        assert len(saved) == 1 and saved[0]['instruction'] == 'Keep this request when I quit.'
        saved_id = saved[0]['id']
        launch(first); wait(lambda: request('/status')['ready'], 'restart after saving request')
        session = request('/session', {'capabilities': {}})['sessionId']
        notes(); wait(lambda: js('return document.querySelectorAll(".review-list li").length') == 1, 'request restored as a note')
        js('import(document.querySelector("script[type=module]").src).then(m=>{window.__exitApi=Object.values(m).find(v=>v&&typeof v.storeReview==="function");window.__realQuit=__exitApi.quit;window.__quits=0;__exitApi.quit=async()=>{__quits++;throw Error("test exit failure")}})')
        wait(lambda: js('return !!window.__realQuit'), 'exit fault injection')
        click('Edit note', '.review-panel')
        exit_request()
        wait(lambda: js('return __quits===1 && !document.querySelector(".app").inert'), 'unchanged note needs no prompt')
        assert not js('return !!document.querySelector("dialog[open]")')
        notes(); click('Edit note', '.review-panel')
        js('const el=document.querySelector(".feedback-panel textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"Keep my changed note.");el.dispatchEvent(new Event("input",{bubbles:true}))')
        click('Hide', '.feedback-panel')
        exit_request(); exit_prompt()
        assert js('return document.querySelector("dialog[open] h2").textContent.includes("note changes")')
        click('Save to Notes', 'dialog[open]')
        wait(lambda: js('return __quits===2 && !document.querySelector(".app").inert'), 'changed note saved before failed exit')
        saved = json.loads(state_path.read_text())['notes']
        assert len(saved) == 1 and saved[0]['id'] == saved_id and saved[0]['instruction'] == 'Keep my changed note.'
        compose('Explain', '')
        click('Hide', '.feedback-panel')
        js('__exitApi.quit=__realQuit')
        exit_request(); exit_prompt(); exit_choice('Discard')
        wait(lambda: not listening(), 'discard unsent request and quit')
        assert json.loads(state_path.read_text())['notes'] == saved
        launch(first); wait(lambda: request('/status')['ready'], 'restart after discard')
        session = request('/session', {'capabilities': {}})['sessionId']
        notes(); wait(lambda: js('return document.querySelectorAll(".review-list li").length') == 1, 'saved note retained after discard')
        assert js('return document.querySelector(".feedback-button").textContent') == 'Feedback'
        click('Delete all saved notes', '.review-panel'); click('Remove', 'dialog[open]')
        wait(lambda: not state_path.exists(), 'test notes removed')
        assert len(deliveries) == 2, 'Exit actions must never send feedback'
        assert all(path.read_bytes() == data and path.stat().st_mtime_ns == stamp for path, (data, stamp) in originals.items())
        print(json.dumps({'notes': 2, 'deliveryAttempts': 2, 'uniqueBatches': 1, 'restartDidNotSend': True, 'privateStorageDeleted': True, 'documentBytesUnchanged': True, 'quitDraftProtection': 'cancel, Escape, save failure, save/restart, discard, saved-note edits, unchanged notes', 'updateDraftProtection': 'cancel and failed install (test API)'}, indent=2))
    finally:
        stop(); stopped.set(); thread.join(timeout=2); server.close()
        registration.unlink(missing_ok=True); socket_path.unlink(missing_ok=True)
