# Sidelit

Rendered context, beside your terminal. **Sidelit is a working name.**

An open-source desktop visual companion for developers who work in Rex, Pi, and Neovim. Open Markdown, HTML, or MDX from your terminal, inspect the rendered result, send contextual feedback to an existing Pi session, and see file changes refresh without losing a dirty draft.

Tauri 2 uses the operating system's webview. There is **no Electron, bundled Node.js, or Node sidecar**. Node and pnpm are build tools only.

## Download and install

**[Download the latest macOS release](https://github.com/heath0xFF/sidelit/releases/latest)**

1. Download the `.dmg` under **Assets**, not the source-code archive. Downloads are public; no GitHub account is needed.
2. Open the DMG and drag **Sidelit** into **Applications**.
3. Eject the disk image, then open Sidelit from Applications.

No Node, pnpm, Rust, or terminal command is needed. The universal app includes Apple Silicon and Intel binaries and requires macOS 13 or later. Intel runtime checks are still pending.

Current releases are **ad-hoc signed, not Apple-notarized**. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** for Sidelit, only if you trust this download. Do not disable Gatekeeper.

**Upgrading from 0.1.0:** install the new DMG once. Save your work and quit Sidelit before replacing it.

From **0.1.1**, Sidelit checks for updates on startup and once a day while open. Use **Install & Restart** when an update is offered, or **Actions → Check for Updates**. Installation uses the normal Save/Discard/Cancel prompts, checks live drafts, and flushes enabled recovery before it starts. Failed updates keep drafts in memory. Nothing installs or restarts without your confirmation.

Update archives must have a valid signature from Sidelit's release key, bound to the advertised version. Checks and downloads use HTTPS. Only update requests contact GitHub; they do not send document text or paths. Offline editing still works, and failed background checks stay quiet. Your Markdown files remain separate from the app. Turn on Session & Recovery if you want to restore tabs after a restart.

For maintainers, [RELEASING.md](RELEASING.md) explains the GitHub build and release workflow.

## Develop on macOS

Build-tool requirements:

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

## Visual companion workflow

Sidelit keeps the terminal and editor as the primary development environment:

- Markdown opens for reading in the existing Crepe renderer, with GFM tables, tasks, images, links, and code blocks. Choose **Edit** for rich editing or **Source** for Monaco.
- HTML and MDX open in a bounded preview surface. HTML is sanitized before it enters a sandboxed iframe; page scripts are off until you explicitly enable them.
- Standalone MDX uses the official MDX compiler: JSX, expressions, locally exported components, GFM, highlighted code, and built-in Callout, Card, Badge, and Stack components. Compiled code runs only inside the isolated preview. Imports (including dynamic imports) require a development-server preview; Sidelit does not recreate your framework runtime.
- Use Dev Server to connect to a running local URL such as http://localhost:5173. Sidelit does not start or manage that process.
- Select text to reveal **Explain / Review / Edit** beside the passage. Inspect an element or use Feedback for a document-level request. The composer captures bounded context and sends it to a selected Pi session.

Attached selections remain highlighted while you compose. **Hide** or Escape retains the request in memory; reopening Feedback resumes it across tab changes and refresh. **Discard request** explicitly removes it. A new selection can replace the attachment without erasing your instruction. Expand **Attached context** to see the excerpt and technical details; **Reveal selection** returns to it. Shortened excerpts, changed documents and unsaved drafts are disclosed. Sending an earlier captured version requires an explicit choice. Requests last until app exit, with one active request at a time; batch review notes are not implemented.

Batch review notes and their acceptance criteria are tracked in [ROADMAP.md](ROADMAP.md).

Explain and Review send explicit answer-only instructions, not an edit-permission sandbox. Answers stay in Pi; **Show in Rex** focuses the associated terminal without typing into it.

The core loop is Render, Inspect, Select, Instruct Agent, Refresh. File watchers continue to refresh clean buffers after Pi edits; a dirty draft remains protected by the existing conflict flow.

### Pi and Rex setup

Sidelit uses Pi's documented extension API, not terminal keystroke simulation. The repository extension creates a user-only Unix socket, validates project and message IDs, and calls Pi's sendUserMessage API. Busy Pi sessions receive a native follow-up message.

Install the bundled extension and agent skill once (no checkout is required):

```sh
sidelit setup --pi --skill --dry-run --json
sidelit setup --pi --skill
sidelit doctor --project /absolute/path/to/project --json
sidelit sessions --project /absolute/path/to/project --json
```

Setup installs versioned resources in Sidelit's user application-support directory and links them into `~/.pi/agent/extensions/sidelit` (or `$PI_CODING_AGENT_DIR/extensions/sidelit`) and `~/.agents/skills/sidelit`. It is idempotent, upgrades unchanged managed installations, and preserves custom or modified installations with a conflict report. Dry-run makes no changes. Run `/reload`, then `/sidelit-status` in the intended existing Pi session; setup never sends terminal input or starts another agent. Development checkouts can still use `pi -e /absolute/path/to/sidelit/extensions/pi-sidelit/index.ts`.

Doctor reports the invoked build, known running builds, installation versus live registration, project matches and a read-only socket health check. It never prompts an agent. Older running apps may report an unknown build: save, quit and reopen the intended bundle. JSON uses `schemaVersion: 1`; exit codes are 0 for success, 1 for setup conflicts or no healthy matching session in doctor, and 2 for invalid arguments or operational errors. Use `--` before a document named `setup`, `doctor`, or `sessions`.

Select text and choose Explain, Review or Edit, choose the Pi target, and press **Send to Pi** (Cmd/Ctrl+Enter). General feedback works without a selection. **Queued** or **Received** means submitted as a native follow-up; **Pi accepted the request** appears only after Pi emits its user-message event. It does not mean the work is finished. Retry preserves the message ID and payload so an uncertain delivery cannot inject the same instruction twice.

End-to-end example: run `cd ~/code/site && pi` in Rex, open `src/pages/index.mdx` in Sidelit, press `Cmd/Ctrl+Shift+I`, click the navigation element, enter “Make this navigation more compact,” choose `Pi · site`, and press **Send to Pi**. After Pi edits the file, Sidelit refreshes the clean preview automatically.

Rex discovery is read-only. When Sidelit is launched from an environment with Rex available, it uses Rex's documented session inspection and terminal process APIs to find Pi blocks, their working directories, and project association. A Rex-only target is shown as unavailable until the Pi extension is installed. Sidelit never writes into an active terminal as a delivery mechanism.

If Sidelit was launched from Finder and cannot find Rex on PATH, start it from a Rex terminal or make the Rex executable available in PATH. Session discovery is best-effort; select a target explicitly when more than one Pi session matches.

Pi registration works independently of Rex CLI availability. It advertises the inherited `REX_SESSION` / `REX_BLOCK`, Pi session ID, canonical working directory, and busy state. Discovery prefers related project paths, remembers an explicitly selected target per project, and never chooses the first of several matches. No Rex plugin or terminal typing is involved. Verified API baseline: Pi 1.4.0 (`@earendil-works/pi-coding-agent`); older Pi packages may require upgrading.

### Local development servers / project-aware MDX

Start your normal dev server in Rex. Choose **Dev Server**, enter a loopback HTTP(S) URL, and open the preview. HMR continues through the server; width/height controls resize the actual viewport. Only `localhost`, `127.0.0.1`, and `[::1]` are accepted. Sidelit's own development origin (`http://127.0.0.1:1420`) is reserved.

Open the project's folder in Sidelit first to scope Pi discovery. A URL alone does not reliably identify a project; without a folder, choose explicitly from the discovered sessions.

For selection and inspection, copy `extensions/preview-bridge/sidelit.js` into the project's public assets and include it **only in development**, for example:

```html
<script src="/sidelit.js"></script>
```

Then enable **Enable inspection bridge** in Sidelit. This shipped bridge handles highlights, text context, keyboard actions, and the handshake; you do not need to implement a messaging protocol. It exposes no native APIs. Pages that disallow embedding through CSP or X-Frame-Options must enable embedding for this workflow. HTTPS with an untrusted development certificate may fail to load. Sidelit does not bypass those protections.

## Build and launch without Node

```sh
pnpm tauri build
./scripts/sidelit samples/Welcome.md
```

The native Apple Silicon build is here:

```text
src-tauri/target/release/bundle/macos/Sidelit.app
src-tauri/target/release/bundle/dmg/Sidelit_0.1.1_aarch64.dmg
```

The DMG filename includes the app version and target architecture.

You can also open this app in Finder. The bundle contains all frontend assets and Monaco workers. It does not need Vite, Node, or a network connection.

For an explicit Apple Silicon target:

```sh
rustup target add aarch64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin
```

That build goes under `src-tauri/target/aarch64-apple-darwin/release/bundle/`. GitHub builds both Mac architectures into one universal DMG. The default signature is ad-hoc (`-`); a Developer ID certificate and notarization are still needed for normal Gatekeeper approval. See [RELEASING.md](RELEASING.md).

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

### Agent skill

[`skills/sidelit/SKILL.md`](skills/sidelit/SKILL.md) is the repository-owned agent skill. It covers Markdown/HTML/MDX previews, safe external edits beside unsaved human drafts, development-server limitations, and connecting an existing Pi session. It uses the standard Agent Skills format and needs no extra runtime. The skill and the Pi receiver extension are separate: the skill guides the agent; the extension enables delivery.

From this checkout, install it in the shared skill directory:

```sh
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/sidelit" "$HOME/.agents/skills/sidelit"
```

Do not replace an existing skill without checking it. Agents that use a separate skills directory can link the same folder there. Restart the agent or reload its skills; in Pi, use `/reload`, then `/skill:sidelit`.

### Linux

The code uses portable Rust filesystem and notify APIs. Install Tauri's current [Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux), including WebKitGTK 4.1, GTK 3, a C toolchain, and librsvg. Run `pnpm desktop`, or package with `pnpm tauri build --bundles deb,appimage` instead of the macOS `app,dmg` targets. Linux builds and desktop integration have **not** been verified in this first version.

## Use it

- **Open File / Open Folder** use native dialogs.
- **Actions → New File / Save As** use a native save dialog and require a new filename. New File creates an empty Markdown file. Save As opens a saved copy and keeps the original draft.
- **Quick Open** (`Cmd/Ctrl+P`) searches supported document filenames and paths within the current workspace. Use the arrow keys and Enter to open a match. Large searches report incomplete results; narrow the query.
- Click a file in the sidebar. Folders expand on demand. `.git`, `node_modules`, `target`, `dist`, `build`, `.next`, and `.cache` are excluded.
- Resize the sidebar by dragging its edge, or focus the edge and press the arrow keys. The toolbar button collapses it.
- Tabs keep their unsaved drafts. A dot marks an unsaved change.
- **Rendered** is a reading view for Markdown (choose **Edit** to enable Crepe editing) and an isolated preview for HTML/MDX. Markdown supports CommonMark/GFM headings, lists, tasks, tables, quotes, links, images, and code. HTML/MDX previews include text selection, element inspection, local image/CSS asset resolution, and viewport controls.
- **Source** is Monaco, with line numbers, wrapping, find/replace, and undo/redo. It loads only when Source or Compare first opens.
- **Save** is explicit. Optional recovery writes a separate checkpoint, never an automatic save over your Markdown files.
- **Check for Updates** is under Actions and the native Sidelit menu. An update offers **Install & Restart**; it never silently restarts an editor with a draft.
- **Actions → Theme** offers **System**, **Light**, and **Dark**. New installations default to Dark. The shell follows Rex's native blue-charcoal/violet visual language, with a matching light variant. Existing preferences are retained; System follows OS changes. HTML/dev-server content retains its own styling.
- HTML/MDX refreshes keep your reading position using a visible content anchor with a pixel fallback, including up to eight separately scrolled containers. The bounded in-memory cache also survives switching tabs or Source/Rendered. Scroll restoration yields to your input; deleted/restructured anchors fall back to coordinates. Development-server reloads use the same behavior when the bridge is enabled and the route is unchanged. View state does not persist across app restarts.
- Rendered text uses **IBM Plex Sans**. Source, inline code, code blocks, and Compare use **Inconsolata**. Both fonts are bundled locally, including IBM Plex Sans italics; no network or font installation is needed.
- Use **Actions → Text size → A− / A+** to set document text size from 12–28px. Click the size value to reset to 16px. The setting is shared across editing modes and retained across launches; it does not change Markdown, undo history, or the shell's text size.

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
| Cmd/Ctrl+Shift+I | Toggle element inspection |
| Cmd/Ctrl+Shift+F | Open contextual or document feedback |
| Cmd/Ctrl+Shift+R | Refresh preview |
| Cmd/Ctrl+Shift+E | Toggle file explorer |
| Cmd/Ctrl+Enter | Send feedback (in composer) |
| Cmd/Ctrl+Shift+T | Focus Pi target selector (in composer) |
| Escape | Dismiss inspection/selection or hide feedback, retaining the request |
| Cmd/Ctrl+Plus or Equals | Increase document font size |
| Cmd/Ctrl+Minus | Decrease document font size |
| Cmd/Ctrl+0 | Reset document font size to 16px |
| Cmd/Ctrl+B / I | Bold / italic in rendered text |
| Cmd/Ctrl+Z | Undo in the current editor |
| Cmd/Ctrl+Shift+Z | Redo in the current editor |
| Cmd/Ctrl+F | Find in Source |
| Cmd+Option+F / Ctrl+H | Replace in Source |

One sidebar workspace is active at a time. Opening the first file uses its parent folder. Files outside that root become standalone tabs. Explicit Open Folder replaces only the sidebar root, not the open drafts.

## Document safety

Each open file has one canonical text buffer, a disk snapshot and SHA-256 hash, a revision, and an optional pending external version.

- Opening, focusing, changing tabs or modes, and no-op Save do not rewrite a file. Crepe does not serialize its initial document into the buffer.
- A real rich edit can normalize supported syntax: list markers, whitespace, tables, or fences. **Arbitrary Markdown round trips are not byte-perfect.** Use Source for exact syntax control. Undoing back to the loaded rendered document restores its original Markdown bytes.
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

Raw HTML and MDX are never executed in Sidelit's privileged webview. Rich Markdown paste is restricted to the editor's schema. Rust accepts only HTTP, HTTPS, mailto, and confirmed local document links. New webview windows are denied. The main webview CSP allows bundled scripts/workers, inline editor styles, and scoped image data, not remote script origins or `unsafe-eval`.

Static previews are served from a memory-only custom protocol, not `srcdoc` (which would inherit the privileged page's CSP). They use an opaque-origin iframe with no same-origin, top-navigation, pop-up, or native API permission. HTML scripts are disabled unless explicitly trusted for that document. Standalone MDX executes compiled JavaScript only in this sandbox; network access remains blocked. Script execution can still consume CPU, so do not preview hostile MDX or enable hostile HTML scripts.

Local CSS (including bounded imports), images, SVG image data, fonts, and explicitly trusted local scripts pass through canonical Rust path grants. Stylesheet-relative URLs resolve from the stylesheet, not the document. Asset directories are watched alongside document directories. Missing or unauthorized assets surface warnings. Static previews are bounded to 256 asset references, 128 watched asset directories per open document, 24 MiB of expanded assets, and 32 MiB of prepared HTML; larger applications belong in a development server. Static previews cannot fetch arbitrary local files or make network requests; module dependencies and framework behavior belong in a development server.

Dev-server frames retain their separate HTTP origin for ordinary JS/HMR and forms; they receive no Tauri capabilities. Parent messages require the opened frame, expected origin, per-mount token, and bounded validated context. A page can supply context, never deliver agent instructions or invoke native commands. Source lines derived from a unique text match are marked **possible**, not exact; compiled DOM usually has no reliable source mapping.

Pi uses `/tmp/sidelit-pi-<uid>/` (0700 directory, 0600 socket/registration). No TCP listener, cloud service, or account is needed. Receipts are recorded in the Pi session for deduplication across extension reloads. They prove consumption, not successful completion; if Pi discards a queued instruction, it may remain **received**. The same ID will not resubmit a discarded queue entry; compose a new instruction deliberately. Receipt persistence follows Pi's own session-storage settings.

## Architecture

- **Rust:** `updates.rs` checks signed releases and installs only the offered version after frontend close approval. `files.rs` handles bounded reads and atomic saves. `service.rs` owns grants, open-file watches, native dialogs, images, and the request queue. `search.rs` bounds workspace search; `recovery.rs` validates and stores private checkpoints. `cli.rs` parses requests. `main.rs` registers single-instance first and handles lifecycle/native events.
- **React:** `documents.ts` is the authoritative buffer state. It rejects stale reads and keeps save acknowledgments separate from current edits. `closing.ts` checks live revisions; `recovery.ts` coalesces checkpoint writes. `App.tsx` connects these to tabs, navigation, and conflict actions. Markdown safety parsing runs when entering Rendered, not on routine application renders or Source typing.
- **Editors:** `Rich.tsx` publishes synchronous document transactions. `Source.tsx` owns stable file-URI Monaco models and local worker setup. Models/listeners are released when tabs close. Both retain cursor/scroll state where practical.
- **Preview:** `formats.ts` classifies documents; `preview-html.ts` resolves assets and applies CSP, `mdx.ts` compiles without execution, and `preview-runtime.tsx` is built as an iframe-only bundle. `preview.rs` serves bounded in-memory publications. `Preview.tsx` owns viewport/trust/bridge lifecycle. `inspection.ts` bounds and validates context; `extensions/preview-bridge/` is shared with development pages.
- **Feedback:** `SelectionActions.tsx` offers Explain/Review/Edit; `selection-dom.ts` reattaches verified selections. `App.tsx` retains a versioned request snapshot; `FeedbackComposer.tsx` keeps an immutable delivery attempt and reports acknowledgments. `agents.rs` matches project-aware Rex/Pi targets and delivers JSONL over a user-only Unix socket. `extensions/pi-sidelit/` uses Pi's native `sendUserMessage` and follow-up delivery for busy sessions.
- **Setup:** `integrations.rs` installs embedded, versioned Pi/skill resources without a checkout or package manager. Doctor uses a read-only socket ping and build registrations; it distinguishes installation from a loaded receiver.

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
SIDELIT_TEST_BINARY="$PWD/src-tauri/target/release/bundle/macos/Sidelit Feature Check.app/Contents/MacOS/sidelit" python3 scripts/feedback-smoke.py
SIDELIT_TEST_BINARY="$PWD/src-tauri/target/release/bundle/macos/Sidelit Feature Check.app/Contents/MacOS/sidelit" python3 scripts/companion-smoke.py
```

The optional `tauri-plugin-wdio-webdriver` is current Tauri-supported desktop tooling. The Python script uses its W3C endpoints directly; it needs no browser or Node runtime. It creates temporary files and writes captures/results to ignored `test-results/`. New/Save As selection and restore approval use simulated replies in this script; Rust creation and recovery primitives have separate tests. Full native OS dialog interaction remains a manual check.

The companion smoke test additionally requires an installed Pi. It starts an isolated Pi runtime with a deterministic offline model extension, invokes Pi's real edit tool against temporary files, and checks native delivery, acceptance, refresh, MDX, assets, and sandbox boundaries. It does not use your model accounts or change your Pi configuration. Run it from a separate Rex test pane to verify inherited Rex identifiers. Unit tests cover disconnected/busy sockets, duplicate delivery, malformed messages, project matching, and compilation errors.

`python3 scripts/updater-smoke.py` builds two isolated app versions with a disposable signing key and local feed. It checks corrupt archives, version substitution, cancelled/failed installs, real bundle replacement, and restart after the original CLI file was deleted. It does not touch your ordinary Sidelit bundle. Public update artifacts use a separate release key and HTTPS; see `RELEASING.md`.

**Never distribute a `desktop-test` build.** That feature exposes a local test server. Quit it, then run `pnpm tauri build` without the feature for an ordinary release.

### Manual smoke test

1. Copy `samples/` to a temporary folder. Run `sidelit <copy>/Welcome.md`. Check the local image, tasks, table, and code block.
2. Choose **Edit**, edit a paragraph, switch modes, and Save. Switch tabs and confirm an unsaved draft stays intact. Try selection, copy/paste, undo/redo, and Source find/replace. In reading mode, select a passage and choose Explain; hide/reopen the request, switch tabs, and confirm the instruction and original attachment survive.
3. Write to the file from a terminal while it is clean. Confirm refresh. Make an unsaved edit, then write externally again. Confirm the draft stays visible and Compare shows both versions.
4. Cancel Reload. Use Save Copy with a new name. Confirm the new tab has the draft and the original has current disk content. Repeat with an invalid save location; the draft must remain.
5. Open a folder with the native dialog. Open a file outside it; the sidebar root must stay unchanged. Close a dirty tab and try Cancel, Save, and Discard. Repeat with Quit.
6. Quit, then open a file with Finder's Open With. Run repeated CLI requests from another directory, including a path with spaces. There should still be one application instance and one tab per file.
7. Use New File and Save As. Cancel each dialog; try an existing name and an unwritable folder. No original or draft may be lost. Delete an original file and its parent directory, then recover its draft with Save Copy.
8. Use Quick Open with a nested path and the keyboard. Edit a conflict, take one disk change with its arrow, then change disk again before Save Merged. The new disk version must block that save.
9. Turn recovery on in a test workspace. Make an unsaved edit, wait for a checkpoint, and force-quit the test app. Change its file externally. Relaunch, cancel native restore approval, then approve it. Confirm the draft survives beside the new disk conflict. Turn recovery off and confirm the saved recovery file is removed.

## Known limits and next steps

- Undo/Redo use the current editor's own history, including rendered code blocks and the editable Compare pane. The native Edit menu and keyboard shortcuts use the same route. Search fields keep their own text history; read-only comparison panes cannot undo the draft. History is editor-local: rich history resets on tab/mode remount, and a disk reload clears either editor's history. Monaco retains its model history until a rich edit or disk reload resets it. There is no cross-mode undo contract or recovered undo history.
- Files and local images are limited to 16 MiB. Large documents use Source. Quick Open is limited to 200 matches, 50,000 entries, depth 64, and a two-second traversal budget. Hard links are not deduplicated. Atomic replacement preserves basic permissions, not all extended metadata or hard-link relationships.
- Standalone MDX supports local components and expressions, but not imports, JSX supplied by an external application, dynamic asset expressions, framework routing, or module loading. Use a development server for these. Static HTML module imports, remote assets, fetch, and nested frames are intentionally restricted; use a server for ordinary application development.
- WebKit can redact HTML runtime error details in an opaque-origin frame. Sidelit reports that a page script failed; use the project development server for fuller debugging. MDX compilation errors retain the compiler's explanation.
- Development-server inspection requires a small page-side bridge; Sidelit does not inject JavaScript into arbitrary remote applications. The bridge is intentionally limited to selection/element context, shortcuts and bounded scroll restoration, and does not expose native commands. Remote page scripts and dependencies remain the responsibility of the development server.
- Markdown's existing raster-only image policy is unchanged. Static HTML/MDX support SVG as inert image data, not embedded SVG documents with privileges. Remote static-preview assets are blocked. Workspace restoration requires recovery to be enabled. Windows bridge support is not implemented (Unix sockets/permissions).
- macOS signing/notarization, Linux packaging, screen-reader use, narrow-window layouts, and native dialog edge cases need more coverage.

## References and license

Versions are locked in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`: Tauri 2.12, Crepe/Milkdown 7.22, Monaco 0.57, Vite 8.3, and stable notify-debouncer-full 0.7 (not its release candidate).

Official references checked: [Tauri single instance](https://v2.tauri.app/plugin/single-instance/), [capabilities](https://v2.tauri.app/security/capabilities/), [desktop WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [Crepe](https://milkdown.dev/docs/guide/using-crepe), [Monaco](https://github.com/microsoft/monaco-editor), [Rex Server API](https://www.superlogical.com/rex/docs/automate/server-api), [Rex CLI](https://www.superlogical.com/rex/docs/automate/cli), [Pi extensions](https://pi.dev/docs/extensions), and [notify-debouncer-full](https://docs.rs/notify-debouncer-full/0.7.0/notify_debouncer_full/).

New Sidelit code and sample assets are [MIT licensed](LICENSE). Dependencies retain their own licenses. IBM Plex Sans and Inconsolata use the SIL Open Font License; their notices are in `public/licenses/` and are included in the packaged assets. Typora is UX inspiration; this is an original implementation.
