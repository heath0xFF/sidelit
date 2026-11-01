"""Keep smoke tests from reusing or leaving a running test app."""
from contextlib import contextmanager
import os
from pathlib import Path
import plistlib
import signal
import socket
import subprocess
import time


def _pids(binary):
    output = subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True)
    return [int(parts[0]) for line in output.splitlines()
            if len(parts := line.strip().split(None, 1)) == 2 and parts[1] == str(binary)]


def _signal(pids, sig):
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


@contextmanager
def isolated_app(binary):
    binary = Path(binary).resolve()
    with (binary.parents[1] / 'Info.plist').open('rb') as info:
        identifier = plistlib.load(info)['CFBundleIdentifier']
    assert identifier != 'app.sidelit.desktop', 'Use an isolated desktop-test bundle.'
    assert not _pids(binary), f'Test app is already running: {binary}. Stop it before this run.'
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1', 4445)) != 0, 'Another test app owns WebDriver. Stop it before this run.'
    try:
        yield identifier
    finally:
        # CLI launches detach, and the recovery test replaces the original process.
        pids = _pids(binary)
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if not pids:
                break
            _signal(pids, sig)
            deadline = time.monotonic() + 5
            while pids and time.monotonic() < deadline:
                time.sleep(.1)
                pids = list(set(pids).intersection(_pids(binary)))
        assert not pids, f'Test app did not stop: {pids}'
