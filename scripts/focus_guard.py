"""Fails a test run that took focus from, or drew over, whatever the person was doing."""
import json
import os
import plistlib
import subprocess
import threading
import time
from pathlib import Path


def _front():
    asn = subprocess.run(['lsappinfo', 'front'], capture_output=True, text=True).stdout.strip()
    info = subprocess.run(['lsappinfo', 'info', '-only', 'bundleid', asn], capture_output=True, text=True).stdout
    return info.split('=', 1)[-1].strip().strip('"')


WINDOWS = """
import CoreGraphics
import Foundation
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
let keys = ["kCGWindowOwnerPID", "kCGWindowAlpha", "kCGWindowBounds"]
let rows = windows.map { window in window.filter { keys.contains($0.key) } }
print(String(data: try! JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!)
"""


def _visible_windows(identifier):
    asn = subprocess.run(['lsappinfo', 'find', f'bundleid={identifier}'], capture_output=True, text=True).stdout.split()
    assert asn, f'{identifier} is not running'
    info = subprocess.run(['lsappinfo', 'info', '-only', 'pid', asn[0]], capture_output=True, text=True).stdout
    pid = int(info.split('=', 1)[-1])
    rows = json.loads(subprocess.run(['swift', '-'], input=WINDOWS, capture_output=True, text=True, check=True).stdout)
    return [row for row in rows if row['kCGWindowOwnerPID'] == pid and row['kCGWindowAlpha'] > 0]


class FocusGuard:
    def __init__(self, binary):
        contents = Path(binary).resolve().parents[1]
        with open(contents / 'Info.plist', 'rb') as info:
            self.identifier = plistlib.load(info)['CFBundleIdentifier']
        self.samples = 0
        self.stolen = 0
        self.running = True
        threading.Thread(target=self._watch, daemon=True).start()

    def _watch(self):
        while self.running:
            self.samples += 1
            if _front() == self.identifier:
                self.stolen += 1
            time.sleep(.1)

    def check(self):
        """Call at the end of a run, while the app is still open."""
        self.running = False
        if os.environ.get('SIDELIT_TEST_VISIBLE'):
            return {}
        assert not self.stolen, f'{self.identifier} was frontmost in {self.stolen} of {self.samples} samples'
        assert self.samples > 0
        shown = _visible_windows(self.identifier)
        assert not shown, f'{self.identifier} has visible windows: {shown}'
        return {'focusSamples': self.samples, 'focusStolen': self.stolen, 'visibleWindows': 0}
