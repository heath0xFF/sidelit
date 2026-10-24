#!/usr/bin/env python3
"""Packaged WKWebView + real Pi runtime, using an offline fixture model and temp files."""
import base64
import http.server
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BINARY = Path(os.environ['SIDELIT_TEST_BINARY'])
with (BINARY.parents[1] / 'Info.plist').open('rb') as info:
    assert plistlib.load(info)['CFBundleIdentifier'] != 'app.sidelit.desktop', 'Use an isolated desktop-test bundle'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)

def request(path, body=None):
    req = urllib.request.Request('http://127.0.0.1:4445' + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=35) as response:
        value = json.load(response)['value']
    if isinstance(value, dict) and value.get('error'):
        raise AssertionError(value)
    return value

def wait(check, description, timeout=20):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        try:
            result = check()
            if result:
                return result
        except (ConnectionError, urllib.error.URLError):
            pass
        time.sleep(.1)
    raise AssertionError('Timed out: ' + description)

def launch(path):
    subprocess.run([str(BINARY), str(path)], check=True, capture_output=True, timeout=20)

# Test instrumentation lives in the fixture, never in production preview code.
PROBE = '''
addEventListener('message', e => {
 if(e.data?.source !== 'sidelit-fixture')return;
 const el=document.querySelector('h1');
 if(e.data.action==='inspect')el.click();
 if(e.data.action==='select'){const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}
 if(e.data.action==='scroll'){document.dispatchEvent(new WheelEvent('wheel'));document.querySelector('#passage-12')?.scrollIntoView();const s=document.querySelector('#nested');if(s)s.scrollTop=240;}
 let parentBlocked=false;try{void parent.document.body}catch{parentBlocked=true}
 parent.postMessage({source:'fixture-result',text:el.textContent,padding:getComputedStyle(el).padding,ipc:typeof window.__TAURI_INTERNALS__,parentBlocked,image:!!document.querySelector('img')?.naturalWidth,url:location.href,scrollY,anchorTop:document.querySelector('#passage-12')?.getBoundingClientRect().top,nested:document.querySelector('#nested')?.scrollTop},'*');
});
'''

with tempfile.TemporaryDirectory(prefix='sidelit-companion-') as temp:
    folder = Path(temp).resolve()
    (folder / 'css').mkdir()
    (folder / 'css/theme.css').write_text('h1 { padding: 12px; color: rgb(120,180,240) }')
    (folder / 'dot.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>')
    file = folder / 'index.html'
    file.write_text('<!doctype html><html><head><link rel="stylesheet" href="css/theme.css"><style>body{background:#20242b;color:#ddd;font:18px system-ui;padding:40px}</style><script>throw Error("Fixture expected runtime error")</script></head><body><h1 id="headline">Build something great.</h1><img src="dot.svg"><p>A local HTML preview.</p><script>' + PROBE + '</script></body></html>')
    passages = ''.join(f'<section id="passage-{i}" style="min-height:200px"><h2>Passage {i}</h2><p>Keep this passage in view while the agent edits the page.</p></section>' for i in range(30))
    file.write_text(file.read_text().replace('</body>', '<div id="nested" style="height:160px;overflow:auto"><div style="height:900px">A separately scrolled area</div></div>' + passages + '</body>'))
    before = file.read_bytes()
    events = []
    environment = {**os.environ, 'PI_CODING_AGENT_DIR': str(folder / 'pi-config'), 'PI_OFFLINE': '1', 'PI_TELEMETRY': '0'}
    args = ['pi', '--mode', 'rpc', '--no-session', '--no-extensions', '-e', str(ROOT / 'extensions/pi-sidelit/index.ts'), '-e', str(ROOT / 'tests/fixtures/pi-provider.ts'), '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--offline', '--model', 'sidelit-test/fixture', '--tools', 'edit']
    with (OUT / 'companion-pi-errors.log').open('w') as stderr:
        pi = subprocess.Popen(args, cwd=folder, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True)
        def consume():
            for line in pi.stdout:
                try: events.append(json.loads(line))
                except ValueError: events.append({'output': line})
        threading.Thread(target=consume, daemon=True).start()
        def rpc(value):
            pi.stdin.write(json.dumps(value) + '\n'); pi.stdin.flush()
        server = None
        try:
            registry = Path(f'/tmp/sidelit-pi-{os.getuid()}')
            def registered():
                return next((json.loads(p.read_text()) for p in registry.glob('*.sock.json') if json.loads(p.read_text()).get('pid') == pi.pid), None)
            target = wait(registered, 'real Pi registration')
            diagnosis = json.loads(subprocess.check_output([str(BINARY), 'doctor', '--project', str(folder), '--json'], text=True))
            assert any(t['id'] == target['id'] and t['health']['status'] == 'ready' for t in diagnosis['sessions']), diagnosis
            assert len(target['socketPath']) < 104 and target.get('blockId') == os.environ.get('REX_BLOCK'), target
            launch(folder)
            launch(file)
            wait(lambda: request('/status')['ready'], 'WebDriver')
            session = request('/session', {'capabilities': {}})['sessionId']
            def js(script, *args):
                return request(f'/session/{session}/execute/sync', {'script': script, 'args': list(args)})
            def click(text):
                assert js('const scope=document.querySelector("dialog[open]")||document;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);if(b){b.click();return true}return false', text), text
            def body():
                return js('return document.body.innerText')
            def value(selector, text):
                js('const el=document.querySelector(arguments[0]);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,arguments[1]);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))', selector, text)
            def capture(name):
                (OUT / name).write_bytes(base64.b64decode(request(f'/session/{session}/screenshot')))
            js('window.__previewEvents=[];window.__errors=[];addEventListener("message",e=>__previewEvents.push({data:e.data,origin:e.origin}));addEventListener("error",e=>__errors.push(e.message))')
            wait(lambda: js('return !!document.querySelector(".preview-frame")'), 'HTML frame')
            if os.environ.get('SIDELIT_TEST_FLOAT') == '1':
                windows = json.loads(subprocess.check_output(['aerospace', 'list-windows', '--all', '--json']))
                test_window = next(w for w in windows if w['app-name'] == BINARY.parents[2].stem)
                subprocess.run(['aerospace', 'layout', '--window-id', str(test_window['window-id']), 'floating'], check=True)
            request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
            value('select[aria-label="Theme"]', 'dark')
            js('const b=document.querySelector(".error-banner");if(b?.textContent.includes("sidelit-companion-"))b.querySelector("button").click()')
            click('Refresh')
            wait(lambda: js('return __previewEvents.some(e=>e.data.type==="ready")'), 'sandbox inspection bridge')
            def probe(action='read'):
                js('document.querySelector("iframe").contentWindow.postMessage({source:"sidelit-fixture",action:arguments[0]},"*")', action)
            probe(); time.sleep(.3)
            assert not js('return __previewEvents.some(e=>e.data.source==="fixture-result")'), 'scripts must be disabled initially'
            js('document.querySelector(".preview-toolbar input[type=checkbox]").click()')
            def metrics():
                probe()
                return js('return __previewEvents.filter(e=>e.data.source==="fixture-result").at(-1)?.data')
            result = wait(metrics, 'trusted page scripts')
            wait(lambda: js('return /Fixture expected runtime error|A page script failed/.test(document.querySelector(".preview-warnings")?.textContent||"")'), 'initial script error reporting')
            assert result['padding'] == '12px' and result['image'] and result['ipc'] == 'undefined' and result['parentBlocked'], result
            assert file.read_bytes() == before, 'preview must not rewrite source'
            probe('scroll')
            wait(lambda: js('return __previewEvents.some(e=>e.data.type==="position"&&e.data.context.y>1500)'), 'scroll snapshot from isolated frame')
            start_position = wait(lambda: (m if (m := metrics()) and m['scrollY'] > 1500 else None), 'long-page scroll')
            (folder / 'css/theme.css').write_text('h1 { padding: 24px; color: rgb(120,180,240) }')
            changed = wait(lambda: (m if (m := metrics()) and m['padding'] == '24px' else None), 'stylesheet directory watcher')
            assert abs(changed['anchorTop'] - start_position['anchorTop']) <= 2 and changed['nested'] == 240, changed
            file.write_text(file.read_text().replace('<section id="passage-2"', '<div style="height:250px">New content above the reading position</div><section id="passage-2"'))
            shifted = wait(lambda: (m if (m := metrics()) and m['scrollY'] > changed['scrollY'] + 200 else None), 'anchor survives inserted content')
            assert abs(shifted['anchorTop'] - start_position['anchorTop']) <= 2, shifted
            previous_url = shifted['url']
            click('Refresh')
            refreshed = wait(lambda: (m if (m := metrics()) and m['url'] != previous_url else None), 'manual refresh keeps reading position')
            assert abs(refreshed['anchorTop'] - start_position['anchorTop']) <= 2 and refreshed['nested'] == 240, refreshed
            value('input[aria-label="Preview width"]', '640')
            assert js('return document.querySelector("iframe").getBoundingClientRect().width') == 640
            probe('select')
            wait(lambda: js('return !!document.querySelector(".feedback-button.tool-active")'), 'text selection')
            click('Feedback')
            assert 'Build something great.' in body()
            click('Discard request')
            click('Inspect')
            probe('inspect')
            wait(lambda: js('return !!document.querySelector(".feedback-panel")'), 'element inspection')
            assert 'h1#headline' in body(), body()
            wait(lambda: js('return [...document.querySelectorAll(".feedback-target option")].some(o=>o.value===arguments[0])', target['id']), 'Pi discovered by native app')
            value('.feedback-target select', target['id'])
            value('.feedback-panel textarea', 'Make this heading more concise.')
            probe('scroll')
            before_agent = wait(lambda: (m if (m := metrics()) and abs(m['anchorTop']) <= 2 else None), 'position before agent edit')
            rpc({'type': 'prompt', 'message': 'busy fixture'})
            wait(lambda: any(e.get('type') == 'agent_start' for e in events), 'Pi busy')
            click('Send to Pi')
            wait(lambda: 'Queued for Pi' in body() or 'Received' in body() or 'Pi accepted' in body(), 'native delivery acknowledgment')
            wait(lambda: 'Build useful things.' in file.read_text(), 'real Pi edit tool', 30)
            after_agent = wait(lambda: (m if (m := metrics()) and m['text'] == 'Build useful things.' else None), 'agent edit live refresh')
            assert abs(after_agent['anchorTop'] - before_agent['anchorTop']) <= 2, after_agent
            wait(lambda: 'Pi accepted the request' in body(), 'Pi consumption acknowledgment')
            assert any(e.get('type') == 'tool_execution_end' and not e.get('isError') for e in events), events
            capture('companion-feedback.png')
            request(f'/session/{session}/window/rect', {'width': 720, 'height': 630})
            time.sleep(.2)
            assert js('return document.documentElement.scrollWidth <= innerWidth'), 'narrow layout must not overflow'
            assert js('const f=document.querySelector("iframe").getBoundingClientRect(),v=document.querySelector(".preview-viewport").getBoundingClientRect();return f.left>=v.left'), 'oversized viewport must remain scrollable from its left edge'
            capture('companion-feedback-narrow.png')
            request(f'/session/{session}/window/rect', {'width': 1180, 'height': 820})
            click('New request')
            mdx = folder / 'page.mdx'
            mdx.write_text('export const Heading = ({children}) => <h1>{children}</h1>\n\nexport const Probe = () => <span ref={el => {if(el)setTimeout(()=>parent.postMessage({source:"fixture-mdx",text:document.body.innerText,ipc:typeof window.__TAURI_INTERNALS__},"*"),50)}} />\n\n<Heading>Real MDX {2 + 2}</Heading>\n\n<Callout>Local component</Callout>\n\n- [x] Task\n\n```js\nconst answer = 42\n```\n\n<Probe />\n')
            launch(mdx)
            report = wait(lambda: js('return __previewEvents.filter(e=>e.data.source==="fixture-mdx").at(-1)?.data'), 'real MDX runtime')
            assert 'Real MDX 4' in report['text'] and report['ipc'] == 'undefined', report
            original_frame = js('return document.querySelector("iframe").src')
            value('select[aria-label="Theme"]', 'light')
            assert js('return document.querySelector("iframe").src') == original_frame, 'appearance must not remount MDX'
            time.sleep(.2)
            capture('companion-mdx-light.png')
            value('select[aria-label="Theme"]', 'dark')
            time.sleep(.2)
            capture('companion-mdx.png')
            mdx.write_text(mdx.read_text().replace('if(el)setTimeout', 'if(el){' + PROBE + '}if(el)setTimeout') + '\n<div style={{height:2000}} />\n\n<section id="passage-12"><h2>Keep reading here</h2><p>This position survives an MDX recompile.</p></section>\n\n<div style={{height:1000}} />\n')
            wait(lambda: (m if (m := metrics()) and m['url'] != original_frame and m['text'] == 'Real MDX 4' else None), 'long MDX fixture')
            probe('scroll')
            mdx_position = wait(lambda: (m if (m := metrics()) and m['scrollY'] > 1500 else None), 'MDX scroll')
            time.sleep(.1)
            mdx.write_text(mdx.read_text().replace('height:2000', 'height:2250'))
            mdx_refreshed = wait(lambda: (m if (m := metrics()) and m['scrollY'] > mdx_position['scrollY'] + 200 else None), 'MDX scroll after recompile')
            assert abs(mdx_refreshed['anchorTop'] - mdx_position['anchorTop']) <= 2, mdx_refreshed
            mdx.write_text('import Site from "./site"\n\n<Site />')
            wait(lambda: 'Preview unavailable' in body(), 'unsupported project import error')
            # The shipped bridge is the only integration added to this local server.
            (folder / 'sidelit.js').write_text((ROOT / 'extensions/preview-bridge/sidelit.js').read_text())
            (folder / 'dev.html').write_text('<h1>Local dev app</h1>' + passages + '<script src="sidelit.js"></script><script>' + PROBE + '</script>')
            class Handler(http.server.SimpleHTTPRequestHandler):
                def __init__(self, *args, **kwargs): super().__init__(*args, directory=folder, **kwargs)
                def log_message(self, *_args): pass
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            click('Dev Server')
            value('.server-dialog input', f'http://127.0.0.1:{server.server_port}/dev.html')
            click('Open preview')
            wait(lambda: js('return !!document.querySelector(".preview-toolbar input[type=checkbox]")'), 'dev preview')
            js('document.querySelector(".preview-toolbar input[type=checkbox]").click()')
            wait(lambda: 'Waiting for the page' not in body(), 'opt-in development bridge')
            click('Inspect'); probe('inspect')
            wait(lambda: js('return !!document.querySelector(".feedback-panel")'), 'development element selection')
            assert js('return __previewEvents.filter(e=>e.data.type==="element").at(-1)?.data.context.text') == 'Local dev app'
            capture('companion-dev-server.png')
            click('Discard request')
            probe('scroll')
            dev_position = wait(lambda: (m if (m := metrics()) and m['text'] == 'Local dev app' and m['scrollY'] > 1500 else None), 'dev-server scroll')
            time.sleep(.1)
            js('window.__previewEvents=[]')
            click('Refresh')
            dev_refreshed = wait(metrics, 'dev-server reload')
            assert abs(dev_refreshed['anchorTop'] - dev_position['anchorTop']) <= 2, dev_refreshed
            js('document.querySelector(".preview-toolbar input[type=checkbox]").click();window.__previewEvents=[]')
            probe('select'); time.sleep(.2)
            assert not js('return __previewEvents.some(e=>e.data.type==="text")'), 'disabled bridge must stop selection events'
            assert not js('return __errors'), js('return __errors')
            print(json.dumps({'result': 'PASS', 'pi': 'real runtime, offline deterministic model, real edit tool', 'rexBlock': target.get('blockId'), 'checks': ['sandbox script opt-in', 'no IPC or parent access', 'relative CSS/image assets', 'asset watcher', 'HTML/MDX/dev-server scroll restoration', 'nested scroll and inserted-content anchors', 'text and DOM selection', 'viewport', 'busy Pi follow-up and consumption ack', 'live agent edit refresh at reading position', 'real MDX', 'MDX import errors', 'development bridge enable/disable']}, indent=2), flush=True)
            try: js('setTimeout(()=>window.__TAURI_INTERNALS__.invoke("quit"),100)')
            except (ConnectionError, urllib.error.URLError): pass
        finally:
            try:
                if 'js' in locals(): js('setTimeout(()=>window.__TAURI_INTERNALS__.invoke("quit"),100)')
            except (ConnectionError, urllib.error.URLError): pass
            if server: server.shutdown()
            if pi.poll() is None:
                pi.stdin.close()
                try: pi.wait(timeout=10)
                except subprocess.TimeoutExpired: pi.terminate(); pi.wait(timeout=5)
            (OUT / 'companion-pi-events.json').write_text(json.dumps(events, indent=2))
