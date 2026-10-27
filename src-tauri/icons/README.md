# App icons

Source: the user-supplied `sidelit-the-fold-icons.zip` (“The Fold”).
These PNG, ICNS, and ICO files are copied from the archive without changes.
The editable sources are `scripts/icon.svg` (light) and `scripts/icon-dark.svg`.

The light set is in this directory; the dark set is in `dark/`.
`tauri.conf.json` uses the light set for the static bundle icon.

`src-tauri/src/icons.rs` selects the system appearance at startup and on native
theme-change events. On macOS it updates the running app's Dock icon through
AppKit. On other platforms it sets the window icon where supported. The icon
follows the system, not the editor's saved theme preference.

Finder and other static launchers can keep the light bundle icon. The app never
rewrites its signed bundle to change an icon.

## Check on macOS

1. Build and launch an isolated test bundle as described in `docs/development.md`.
2. Start once in system Light and once in system Dark. Check the Dock icon.
3. With the app open, switch system appearance Light → Dark → Light.
   The Dock icon must change without a restart.
4. Repeat with the editor set to an explicit Light or Dark theme.
   The Dock icon must still follow the system; drafts must not change.
5. Restore the original system appearance after the check.
