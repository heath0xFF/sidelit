#!/usr/bin/env python3
"""Build and update an isolated app using disposable keys and a local feed."""
import base64
import functools
import http.server
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
BUNDLE = ROOT / 'src-tauri/target/release/bundle/macos/Sidelit Update Check.app'
BINARY = BUNDLE / 'Contents/MacOS/sidelit'
BASE = 'http://127.0.0.1:4445'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']


def test_pids():
    return [int(line.strip().split(None, 1)[0]) for line in subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True).splitlines() if Path(line.strip().split(None, 1)[-1]).name == 'sidelit' and Path(line.strip().split(None, 1)[-1]).resolve() == BINARY.resolve()]


def stop_test_app():
    for pid in test_pids():
        os.kill(pid, signal.SIGTERM)


def request(path, body=None):
    req = urllib.request.Request(BASE + path, None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=35) as response:
        value = json.load(response)['value']
    if isinstance(value, dict) and value.get('error'):
        raise AssertionError(value)
    return value


def wait(check, label, timeout=20):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        try:
            if check():
                return
        except (ConnectionError, urllib.error.URLError):
            pass
        time.sleep(.1)
    raise AssertionError('Timed out: ' + label)


class Feed(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith('.tar.gz'):
            # Keep the progress state visible long enough to capture it.
            time.sleep(1)
        super().do_GET()

    def log_message(self, *_):
        pass


with tempfile.TemporaryDirectory(prefix='sidelit-update-') as temporary, (OUT / 'updater-build.log').open('w') as log:
    temporary = Path(temporary)
    web = temporary / 'web'
    web.mkdir()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Feed, directory=str(web)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    key = temporary / 'test.key'
    subprocess.run(['pnpm', 'tauri', 'signer', 'generate', '--ci', '--password', '', '--write-keys', str(key)], cwd=ROOT, stdout=log, stderr=log, check=True)
    config = {
        'identifier': 'app.sidelit.update-check', 'productName': 'Sidelit Update Check',
        'bundle': {'createUpdaterArtifacts': True},
        'plugins': {'updater': {'pubkey': key.with_suffix('.key.pub').read_text().strip(),
            'endpoints': [url + '/latest.json'], 'requireSignedVersion': True,
            'dangerousInsecureTransportProtocol': True}},
    }
    env = {**os.environ, 'CI': 'true', 'TAURI_SIGNING_PRIVATE_KEY': str(key), 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': ''}

    def build(version):
        config['version'] = version
        subprocess.run(['pnpm', 'tauri', 'build', '--ci', '--bundles', 'app', '--features', 'desktop-test', '--config', json.dumps(config)], cwd=ROOT, env=env, stdout=log, stderr=log, check=True)

    def installed_version():
        with (BUNDLE / 'Contents/Info.plist').open('rb') as file:
            info = plistlib.load(file)
        assert info['CFBundleIdentifier'] == 'app.sidelit.update-check'
        return info['CFBundleShortVersionString']

    try:
        stop_test_app()
        build(VERSION)
        archive = BUNDLE.with_suffix('.app.tar.gz').read_bytes()
        signature = BUNDLE.with_suffix('.app.tar.gz.sig').read_text().strip()
        (web / 'Sidelit.app.tar.gz').write_bytes(archive)
        build('0.0.0')
        assert installed_version() == '0.0.0'
        initial = temporary / 'initial.md'
        initial.write_text('Initial launch file.\n')
        draft = temporary / 'draft.md'
        draft.write_text('Original draft file.\n')
        launcher = temporary / 'sidelit'
        launcher.symlink_to(BINARY)
        subprocess.run([str(launcher), str(initial)], check=True, timeout=20)
        wait(lambda: request('/status')['ready'], 'WebDriver')
        time.sleep(.5)
        session = request('/session', {'capabilities': {}})['sessionId']

        def js(script, *args):
            return request(f'/session/{session}/execute/sync', {'script': script, 'args': list(args)})

        def text():
            return js('return document.body.innerText')

        def screenshot(name):
            (OUT / name).write_bytes(base64.b64decode(request(f'/session/{session}/screenshot')))

        def click(label):
            assert js('const scope=document.querySelector("dialog[open]")||document;const button=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.click();return true', label), label

        def choose(label):
            wait(lambda: 'Save changes to' in js('return document.querySelector("dialog[open]")?.textContent || ""'), 'save prompt')
            click(label)

        def check_update(version=None):
            if version:
                artifact = {'url': url + '/Sidelit.app.tar.gz', 'signature': signature}
                (web / 'latest.json').write_text(json.dumps({'version': version, 'platforms': {'darwin-aarch64': artifact, 'darwin-x86_64': artifact}}))
            wait(lambda: not js('return [...document.querySelectorAll("button")].find(b=>b.textContent==="Check for Updates…")?.disabled'), 'check ready')
            js('document.querySelector(".app-menu summary").click()')
            click('Check for Updates…')
            expected = 'Sidelit is up to date.' if version == installed_version() else f'Sidelit {version} is available.' if version else 'Could not check for updates:'
            try:
                wait(lambda: expected in text(), 'update result')
            except AssertionError as error:
                raise AssertionError(f'{error}: {text()}') from error

        wait(lambda: 'Initial launch file.' in text(), 'initial document')
        check_update()
        subprocess.run([str(BINARY), str(draft)], check=True, timeout=20)
        wait(lambda: 'Original draft file.' in text(), 'draft document')
        initial.unlink()
        js('[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Edit rendered Markdown").click()')
        wait(lambda: js('return document.querySelector(".ProseMirror").isContentEditable'), 'explicit rich Edit')
        js('const el=document.querySelector(".ProseMirror p");el.focus();const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);document.execCommand("insertText",false,"Keep this draft through failed updates.")')
        wait(lambda: js('return !!document.querySelector(".tab.active .dirty-dot")'), 'dirty draft')
        check_update('9.9.9')
        click('Install & Restart')
        wait(lambda: 'Save changes to' in text(), 'update save prompt')
        choose('Cancel')
        assert installed_version() == '0.0.0' and 'Keep this draft' in text()
        click('Install & Restart')
        choose('Discard')
        wait(lambda: 'Installing update' in text(), 'installation progress')
        screenshot('update-installing.png')
        wait(lambda: js('return !!document.querySelector(".error-banner") && !document.querySelector(".app").inert'), 'signed version rejection')
        assert 'version' in js('return document.querySelector(".error-banner").textContent').lower()
        assert 'Keep this draft' in text() and js('return !!document.querySelector(".tab.active .dirty-dot")')
        assert installed_version() == '0.0.0' and draft.read_text() == 'Original draft file.\n'
        js('document.querySelector(`button[aria-label="Dismiss error"]`).click()')
        check_update(VERSION)
        screenshot('update-available.png')
        (web / 'Sidelit.app.tar.gz').write_bytes(b'corrupt' + archive[7:])
        click('Install & Restart')
        choose('Discard')
        wait(lambda: js('return !!document.querySelector(".error-banner") && !document.querySelector(".app").inert'), 'signature rejection')
        assert 'Keep this draft' in text() and installed_version() == '0.0.0'
        js('document.querySelector(`button[aria-label="Dismiss error"]`).click()')
        (web / 'Sidelit.app.tar.gz').write_bytes(archive)
        old_pids = test_pids()
        click('Install & Restart')
        choose('Save')
        wait(lambda: installed_version() == VERSION, 'archive installation', timeout=40)
        wait(lambda: bool(test_pids()) and not set(old_pids).intersection(test_pids()), 'new app process', timeout=30)
        wait(lambda: request('/status')['ready'], 'restarted updater', timeout=30)
        time.sleep(1)
        session = request('/session', {'capabilities': {}})['sessionId']
        wait(lambda: js('return !!document.querySelector(".empty") && !document.querySelector(".tab")'), 'restarted without stale CLI arguments', timeout=30)
        assert draft.read_text() == 'Keep this draft through failed updates.\n'
        check_update(VERSION)
        # A current version must not be offered for installation again.
        wait(lambda: 'Sidelit is up to date.' in text(), 'current version check')
        result = {'version': VERSION, 'checks': ['missing feed error', 'cancel preserves draft', 'signed-version mismatch rejected', 'corrupt archive rejected', 'failed install retains discarded draft', 'save before install', 'real bundle replacement', 'symlink CLI launch', 'restart without deleted CLI path', 'no same-version update']}
        (OUT / 'updater.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
    except Exception:
        try:
            print(text(), flush=True)
        except Exception:
            pass
        raise
    finally:
        stop_test_app()
        server.shutdown()
        if BUNDLE.exists():
            shutil.rmtree(BUNDLE)
        for path in [BUNDLE.with_suffix('.app.tar.gz'), BUNDLE.with_suffix('.app.tar.gz.sig')]:
            path.unlink(missing_ok=True)
