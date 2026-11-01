"""Run with: python3 -m unittest discover -s scripts -p 'test_desktop_app.py'."""
from pathlib import Path
import plistlib
import signal
import tempfile
import unittest
from unittest.mock import patch

from desktop_app import _pids, isolated_app


class DesktopAppTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.contents = Path(temp.name) / 'Test App.app/Contents'
        self.contents.mkdir(parents=True)
        self.binary = self.contents / 'MacOS/sidelit'
        self.bundle('app.sidelit.feature-check')

    def bundle(self, identifier):
        (self.contents / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': identifier}))

    def test_pid_match_is_exact_and_allows_spaces(self):
        rows = f'10 {self.binary}\n11 /Applications/Sidelit.app/Contents/MacOS/sidelit\n12 {self.binary}-other\n'
        with patch('desktop_app.subprocess.check_output', return_value=rows):
            self.assertEqual(_pids(self.binary), [10])

    def test_rejects_release_bundle(self):
        self.bundle('app.sidelit.desktop')
        with patch('desktop_app.os.kill') as kill:
            with self.assertRaisesRegex(AssertionError, 'isolated'):
                with isolated_app(self.binary):
                    self.fail('must not enter')
            kill.assert_not_called()

    def test_rejects_existing_app_without_stopping_it(self):
        with patch('desktop_app._pids', return_value=[10]), patch('desktop_app.os.kill') as kill:
            with self.assertRaisesRegex(AssertionError, 'already running'):
                with isolated_app(self.binary):
                    self.fail('must not enter')
            kill.assert_not_called()

    def test_rejects_occupied_webdriver_without_stopping_it(self):
        with patch('desktop_app._pids', return_value=[]), patch('desktop_app.socket.socket') as socket, patch('desktop_app.os.kill') as kill:
            socket.return_value.__enter__.return_value.connect_ex.return_value = 0
            with self.assertRaisesRegex(AssertionError, 'owns WebDriver'):
                with isolated_app(self.binary):
                    self.fail('must not enter')
            kill.assert_not_called()

    def test_cleanup_on_success_and_failure_including_restart(self):
        for fail in (False, True):
            with self.subTest(fail=fail), patch('desktop_app._pids', side_effect=[[], [20], []]), patch('desktop_app.socket.socket') as socket, patch('desktop_app.os.kill') as kill, patch('desktop_app.time.sleep'):
                socket.return_value.__enter__.return_value.connect_ex.return_value = 1
                try:
                    with isolated_app(self.binary) as identifier:
                        self.assertEqual(identifier, 'app.sidelit.feature-check')
                        if fail:
                            raise RuntimeError('smoke failed')
                except RuntimeError as error:
                    self.assertTrue(fail)
                    self.assertEqual(str(error), 'smoke failed')
                kill.assert_called_once_with(20, signal.SIGTERM)

    def test_kills_unresponsive_app(self):
        with patch('desktop_app._pids', side_effect=[[], [20], []]), patch('desktop_app.socket.socket') as socket, patch('desktop_app.os.kill') as kill, patch('desktop_app.time.sleep'), patch('desktop_app.time.monotonic', side_effect=[0, 6, 6, 6]):
            socket.return_value.__enter__.return_value.connect_ex.return_value = 1
            with isolated_app(self.binary):
                pass
            self.assertEqual([call.args for call in kill.call_args_list], [(20, signal.SIGTERM), (20, signal.SIGKILL)])

    def test_already_exited_app_needs_no_signal(self):
        with patch('desktop_app._pids', return_value=[]), patch('desktop_app.socket.socket') as socket, patch('desktop_app.os.kill') as kill:
            socket.return_value.__enter__.return_value.connect_ex.return_value = 1
            with isolated_app(self.binary):
                pass
            kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
