#!/usr/bin/env python3
"""Measure a cold packaged launch and sample observed idle processes on macOS."""
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parent.parent
binary = root / 'src-tauri/target/release/bundle/macos/Sidelit.app/Contents/MacOS/sidelit'
assert sys.platform == 'darwin', 'This measurement uses macOS process names.'
assert binary.is_file(), 'Build the release app first.'


def processes():
    output = subprocess.check_output(['ps', '-axo', 'pid=,rss=,%cpu=,time=,comm='], text=True)
    result = {}
    for line in output.splitlines():
        fields = line.split(None, 4)
        if len(fields) == 5:
            pid, rss, cpu, elapsed, command = fields
            result[int(pid)] = {'rssKiB': int(rss), 'cpuPercent': float(cpu), 'cpuTime': elapsed, 'command': command}
    return result


before = processes()
assert not any(p['command'].endswith('/MacOS/sidelit') for p in before.values()), 'Quit Sidelit before measuring.'
start = time.monotonic()
subprocess.run([str(binary), str(root / 'samples/Welcome.md')], check=True, timeout=20)
handoff = time.monotonic() - start
# Let compilation and image decoding settle before the idle samples.
time.sleep(5)
after = processes()
pids = [pid for pid, p in after.items() if pid not in before and (p['command'].endswith('/MacOS/sidelit') or '/com.apple.WebKit.' in p['command'])]
assert any(after[pid]['command'].endswith('/MacOS/sidelit') for pid in pids), 'No new application process found.'
samples = []
for _ in range(5):
    current = processes()
    samples.append({str(pid): current[pid] for pid in pids if pid in current})
    time.sleep(2)
report = {'handoffSeconds': round(handoff, 3), 'note': 'New WebKit processes observed during launch; shared OS services are not exclusively attributable. ps %CPU is a sampled estimate, RSS is not physical footprint.', 'samples': samples}
out = root / 'test-results'
out.mkdir(exist_ok=True)
(out / 'resources.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
