# Sidelit

Markdown, beside your work. **Sidelit is a working name.**

An open-source desktop Markdown editor for people who work with terminal coding agents. Open a file from your terminal, edit the rendered page, and switch to raw source when needed. External edits refresh a clean buffer; a dirty draft stays safe.

Tauri 2 uses the operating system's webview. There is **no Electron, bundled Node.js, or Node sidecar**. Node and pnpm are build tools only.

## Run on macOS

Requirements:

- macOS 13 or later. Apple Silicon is the primary target.
- Xcode Command Line Tools: `xcode-select --install`. A current Xcode also works.
- Stable Rust from [rustup](https://rustup.rs/), with the host target installed.
- Node 22.12+ (or a newer supported release) and pnpm 10.33.2. Install pnpm with your preferred package manager.

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

This starts Vite and Tauri. Keep the terminal running. A browser opened at the Vite URL is **not** the desktop app and cannot access the filesystem.

From another terminal, while development is running:

```sh
./scripts/sidelit-dev samples/Welcome.md
./scripts/sidelit-dev --source samples/Research.markdown
```

The development launcher needs the Vite server. It is not the packaged launcher. Quit the release app before development: both use the same application identifier.

## Build and launch without Node

```sh
pnpm tauri build
./scripts/sidelit samples/Welcome.md
```

The native Apple Silicon build is here:

```text
src-tauri/target/release/bundle/macos/Sidelit.app
```

You can also open this app in Finder. The bundle contains all frontend assets and Monaco workers. It does not need Vite, Node, or a network connection.

For an explicit Apple Silicon target:

```sh
rustup target add aarch64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin
```

That build goes under `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/`. Use its executable directly. Signing and notarization are not configured; do these before distributing public macOS downloads. A locally built app is not a notarized release.

### Install the command on PATH

Copy `Sidelit.app` to `/Applications`, then:

```sh
mkdir -p "$HOME/.local/bin"
ln -s /Applications/Sidelit.app/Contents/MacOS/sidelit "$HOME/.local/bin/sidelit"
export PATH="$HOME/.local/bin:$PATH"
```

Add the export to your shell profile. If a `sidelit` command already exists, inspect it before replacing it.

```sh
sidelit path/to/file.md
sidelit path/to/folder
sidelit --source 'notes/研究 notes.md'
sidelit --help
sidelit --version
```

Relative paths use the caller's working directory. Each call accepts one path. Use `--` before a name that starts with a dash. Invalid paths return a nonzero status and a useful error.

The Rust executable validates the request, launches a detached GUI process when needed, and waits for a handoff receipt (up to 15 seconds). It returns after the running instance has queued the request, not when that window closes. Repeated calls focus the existing tab. Launch Services file-open events also enter the same queue.

### Linux

The code uses portable Rust filesystem and notify APIs. Install Tauri's current [Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux), including WebKitGTK 4.1, GTK 3, a C toolchain, and librsvg. Run `pnpm desktop`, or package with `pnpm tauri build --bundles deb,appimage` instead of the macOS `app` target. Linux builds and desktop integration have **not** been verified in this first version.

## Use it

- **Open File / Open Folder** use native dialogs.
- **Actions → New File / Save As** use a native save dialog and require a new filename. New File creates an empty Markdown file. Save As opens a saved copy and keeps the original draft.
- **Quick Open** (`Cmd/Ctrl+P`) searches Markdown filenames and paths within the current workspace. Use the arrow keys and Enter to open a match. Large searches report incomplete results; narrow the query.
- Click a file in the sidebar. Folders expand on demand. `.git`, `node_modules`, `target`, `dist`, `build`, `.next`, and `.cache` are excluded.
- Resize the sidebar by dragging its edge, or focus the edge and press the arrow keys. The toolbar button collapses it.
- Tabs keep their unsaved drafts. A dot marks an unsaved change.
- **Rendered** is an editable Crepe document, not a preview. It supports CommonMark/GFM headings, lists, tasks, tables, quotes, links, images, and code.
- **Source** is Monaco, with line numbers, wrapping, find/replace, and undo/redo. It loads only when Source or Compare first opens.
- **Save** is explicit. Optional recovery writes a separate checkpoint, never an automatic save over your Markdown files.
- The theme selector offers **System**, **One Light**, and **One Dark**. System is the default and follows OS theme changes. An explicit choice is retained across launches.
- Rendered text uses **IBM Plex Sans**. Source, inline code, code blocks, and Compare use **Inconsolata**. Both fonts are bundled locally, including IBM Plex Sans italics; no network or font installation is needed.
- Use **A− / A+** to set document text size from 12–28px. Click the size value to reset to 16px. The setting is shared across editing modes and retained across launches; it does not change Markdown, undo history, or the shell's text size.

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl+N | New File |
| Cmd/Ctrl+P | Quick Open |
| Cmd/Ctrl+O | Open File |
| Cmd/Ctrl+Shift+O | Open Folder |
| Cmd/Ctrl+S | Save / Save Merged in an editable comparison |
| Cmd/Ctrl+Shift+S | Save As |
| Cmd/Ctrl+W | Close tab |
| Cmd/Ctrl+Q | Quit |
| Cmd/Ctrl+Backslash | Switch editing mode |
| Cmd/Ctrl+Plus or Equals | Increase document font size |
| Cmd/Ctrl+Minus | Decrease document font size |
| Cmd/Ctrl+0 | Reset document font size to 16px |
| Cmd/Ctrl+B / I | Bold / italic in rendered text |
| Cmd/Ctrl+Z | Undo in the current editor |
| Cmd/Ctrl+F | Find in Source |
| Cmd+Option+F / Ctrl+H | Replace in Source |

One sidebar workspace is active at a time. Opening the first file uses its parent folder. Files outside that root become standalone tabs. Explicit Open Folder replaces only the sidebar root, not the open drafts.

## Document safety

Each open file has one Markdown buffer, a disk snapshot and SHA-256 hash, a revision, and an optional pending external version.

- Opening, focusing, changing tabs or modes, and no-op Save do not rewrite a file. Crepe does not serialize its initial document into the buffer.
- A real rich edit can normalize supported syntax: list markers, whitespace, tables, or fences. **Arbitrary Markdown round trips are not byte-perfect.** Use Source for exact syntax control.
- YAML (`---`) and TOML (`+++`) frontmatter stays byte-for-byte unchanged while you edit the rendered body. Use Source to edit metadata. Unclosed frontmatter, raw HTML, reference syntax, math, Mermaid, code metadata, and recognized extensions use Source with an explanation. The conservative gate can also route ordinary dollar signs or large documents to Source. Source stays selected until you explicitly change mode.
- UTF-8 and uniform LF/CRLF are supported. Rich edits preserve uniform CRLF. Mixed line endings can normalize after an edit.
- A clean buffer refreshes after an external change. **Review changes** shows its previous disk version beside the current text, both read-only. Only the latest previous version is kept in memory.
- A dirty buffer keeps its draft and shows **Compare**, **Reload from Disk**, and **Save Copy**. Reload asks before discarding a draft.
- In Compare, the disk pane is read-only and the draft pane is editable. Use a change arrow to take that part of the disk text, or edit the draft directly. Keyboard users can focus an arrow and press Enter or Space. **Save Merged** checks the exact reviewed disk version before writing. A newer external change stops the save; use **Refresh disk pane** to review it first.
- Save Copy requires a **new** file name. It opens the saved draft in a new tab, then reloads the original from current disk. A failed or cancelled copy does not resolve the conflict. If the original is unavailable or gains newer edits while copying, those edits remain in memory.
- Every Save re-reads disk, even before a watcher event arrives. A hash mismatch prevents overwrite. Saves use a synced temporary file in the same directory followed by replacement. No-op Save does not change the file's modification time.
- Directory watchers survive atomic rename saves and report deletion/recreation. notify's maintained debounce helper coalesces chunked/duplicate events. A writer that pauses longer than the debounce interval can expose an intermediate version; a later event refreshes it again.
- Own saves are recognized by content identity, not a time-based event blackout. Stale reads and save replies cannot replace newer drafts.
- Close and Quit block new UI actions while checking live document revisions. A changed draft or an unfinished Save stops the close rather than using an old approval.

Optimistic checks are **not a filesystem lock**. An arbitrary writer can still race the final check and replacement. Keep version control or backups for important work.

### Session and crash recovery

Recovery is **off by default**. Turn it on in **Actions → Session & Recovery**. It keeps the latest tabs, active file, workspace, modes, drafts, and their disk baselines. Originals still require an explicit Save.

- Checkpoints start every 500 ms. Slow writes keep only the newest waiting checkpoint. Close and Quit also flush the final state. Edits after the last successful checkpoint can be lost in a crash; write failures show an error.
- At the next launch, choose Restore session and approve folder access in the native dialog. Current disk contents are checked again. Changed or missing files do not replace recovered drafts.
- Only the latest checkpoint is kept. It expires after seven days without an update; expired data is removed when the app next checks recovery. Limits are 100 tabs, 64 MiB of session data, and 16 MiB per document.
- On macOS, data is under `~/Library/Application Support/app.sidelit.desktop/recovery/`. Files use private OS permissions but are **not encrypted**. Turn recovery off to delete saved data. An explicitly discarded draft is not included in the final checkpoint.
- Recovery is not version history or a backup. It does not retain undo stacks or comparison snapshots. Without recovery, unsaved drafts exist only in memory.

## Desktop and content boundaries

Rust owns dialogs, path authorization, filesystem access, watching, and external URL opening. Custom commands check canonical path grants; they do not rely on plugin filesystem scopes. Grants last for the app session. Selecting a file permits browsing its parent; links outside authorized folders ask for native approval. The tree does not follow symlinks.

Local PNG, JPEG, GIF, and WebP images are loaded through a bounded Rust command. Non-regular files, including named pipes, are rejected. Image reads do not hold the shared service lock. Paths must stay in an authorized folder. Remote images, SVG, and arbitrary `file:` webview access are disabled. Put images beside your document and use relative Markdown paths.

Raw HTML and MDX are never executed. HTML documents use Source; rich paste is restricted to the editor's schema. Rust accepts only HTTP, HTTPS, mailto, and confirmed local document links. Window navigation is restricted to the app origin; new webview windows are denied. The CSP allows bundled scripts/workers, inline editor styles, and scoped image data, not remote script origins or `unsafe-eval`.

## Architecture

- **Rust:** `files.rs` handles bounded reads and atomic saves. `service.rs` owns grants, open-file watches, native dialogs, images, and the request queue. `search.rs` bounds workspace search; `recovery.rs` validates and stores private checkpoints. `cli.rs` parses requests. `main.rs` registers single-instance first and handles lifecycle/native events.
- **React:** `documents.ts` is the authoritative buffer state. It rejects stale reads and keeps save acknowledgments separate from current edits. `closing.ts` checks live revisions; `recovery.ts` coalesces checkpoint writes. `App.tsx` connects these to tabs, navigation, and conflict actions. Markdown safety parsing runs when entering Rendered, not on routine application renders or Source typing.
- **Editors:** `Rich.tsx` publishes synchronous document transactions. `Source.tsx` owns stable file-URI Monaco models and local worker setup. Models/listeners are released when tabs close. Both retain cursor/scroll state where practical.

The first implementation used a packaged editor shell, then connected file navigation, saves, refresh/conflicts, CLI requests, and desktop checks. There were no stack substitutions. Crepe's optional block-image feature is disabled because it stores image size in Markdown alt text. A standard Milkdown image node with a scoped local-image view preserves alt text and titles instead. See [AGENTS.md](AGENTS.md) for change rules and [VERIFICATION.md](VERIFICATION.md) for results.

## Checks

```sh
pnpm check
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

For packaged WKWebView automation, use an isolated test bundle. The test deliberately kills and restarts its app to check recovery. Do not use that test window for real work.

```sh
pnpm tauri build --features desktop-test --config '{"identifier":"app.sidelit.feature-check","productName":"Sidelit Feature Check"}'
SIDELIT_TEST_BINARY="$PWD/src-tauri/target/release/bundle/macos/Sidelit Feature Check.app/Contents/MacOS/sidelit" python3 scripts/desktop-smoke.py
```

The optional `tauri-plugin-wdio-webdriver` is current Tauri-supported desktop tooling. The Python script uses its W3C endpoints directly; it needs no browser or Node runtime. It creates temporary files and writes captures/results to ignored `test-results/`. New/Save As selection and restore approval use simulated replies in this script; Rust creation and recovery primitives have separate tests. Full native OS dialog interaction remains a manual check.

**Never distribute a `desktop-test` build.** That feature exposes a local test server. Quit it, then run `pnpm tauri build` without the feature for an ordinary release.

### Manual smoke test

1. Copy `samples/` to a temporary folder. Run `sidelit <copy>/Welcome.md`. Check the local image, tasks, table, and code block.
2. Edit a paragraph, switch modes, and Save. Switch tabs and confirm an unsaved draft stays intact. Try selection, copy/paste, undo/redo, and Source find/replace.
3. Write to the file from a terminal while it is clean. Confirm refresh. Make an unsaved edit, then write externally again. Confirm the draft stays visible and Compare shows both versions.
4. Cancel Reload. Use Save Copy with a new name. Confirm the new tab has the draft and the original has current disk content. Repeat with an invalid save location; the draft must remain.
5. Open a folder with the native dialog. Open a file outside it; the sidebar root must stay unchanged. Close a dirty tab and try Cancel, Save, and Discard. Repeat with Quit.
6. Quit, then open a file with Finder's Open With. Run repeated CLI requests from another directory, including a path with spaces. There should still be one application instance and one tab per file.
7. Use New File and Save As. Cancel each dialog; try an existing name and an unwritable folder. No original or draft may be lost. Delete an original file and its parent directory, then recover its draft with Save Copy.
8. Use Quick Open with a nested path and the keyboard. Edit a conflict, take one disk change with its arrow, then change disk again before Save Merged. The new disk version must block that save.
9. Turn recovery on in a test workspace. Make an unsaved edit, wait for a checkpoint, and force-quit the test app. Change its file externally. Relaunch, cancel native restore approval, then approve it. Confirm the draft survives beside the new disk conflict. Turn recovery off and confirm the saved recovery file is removed.

## Known limits and next steps

- Undo history is editor-local: rich history resets on tab/mode remount; Monaco retains its model history until a rich edit or disk reload resets that model. There is no cross-mode undo contract or recovered undo history.
- Files and local images are limited to 16 MiB. Large documents use Source. Quick Open is limited to 200 matches, 50,000 entries, depth 64, and a two-second traversal budget. Hard links are not deduplicated. Atomic replacement preserves basic permissions, not all extended metadata or hard-link relationships.
- No image upload manager, remote images, raw HTML preview, or math/Mermaid rendering. Same-file anchor scrolling is not implemented. Workspace restoration requires recovery to be enabled.
- macOS signing/notarization, Linux packaging, screen-reader use, narrow-window layouts, and native dialog edge cases need more coverage.

## References and license

Versions are locked in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`: Tauri 2.12, Crepe/Milkdown 7.22, Monaco 0.57, Vite 8.3, and stable notify-debouncer-full 0.7 (not its release candidate).

Official references checked: [Tauri single instance](https://v2.tauri.app/plugin/single-instance/), [capabilities](https://v2.tauri.app/security/capabilities/), [desktop WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [Crepe](https://milkdown.dev/docs/guide/using-crepe), [Monaco](https://github.com/microsoft/monaco-editor), and [notify-debouncer-full](https://docs.rs/notify-debouncer-full/0.7.0/notify_debouncer_full/).

New Sidelit code and sample assets are [MIT licensed](LICENSE). Dependencies retain their own licenses. IBM Plex Sans and Inconsolata use the SIL Open Font License; their notices are in `public/licenses/` and are included in the packaged assets. Typora is UX inspiration; this is an original implementation.
