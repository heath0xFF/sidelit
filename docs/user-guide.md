# Using Sidelit

[Overview](../README.md) · [Development](development.md)

This guide covers setup, preview controls, feedback, and document safety.

- [Install](#download-and-install)
- [Connect Pi and Rex](#pi-and-rex-setup)
- [Preview a development server](#local-development-servers--project-aware-mdx)
- [Use the CLI](#install-the-command-on-path)
- [Controls and shortcuts](#use-it)
- [Document safety](#document-safety)
- [Security boundaries](#desktop-and-content-boundaries)
- [Known limits](#known-limits-and-next-steps)

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

For maintainers, [RELEASING.md](../RELEASING.md) explains the GitHub build and release workflow.

## Visual companion workflow

Sidelit keeps the terminal and editor as the primary development environment:

- Ordinary Markdown opens for reading in the Crepe renderer, with GFM tables, tasks, images, links, and code blocks. Choose **Edit** for rich editing or **Source** for Monaco. Markdown with Mermaid diagrams uses a read-only sandboxed preview; edit it in Source.
- HTML and MDX open in a bounded preview surface. HTML is sanitized before it enters a sandboxed iframe; page scripts are off until you explicitly enable them.
- Standalone MDX uses the official MDX compiler: JSX, expressions, locally exported components, GFM, highlighted code, and built-in Callout, Card, Badge, and Stack components. Compiled code runs only inside the isolated preview. Imports (including dynamic imports) require a development-server preview; Sidelit does not recreate your framework runtime.
- Use Dev Server to connect to a running local URL such as http://localhost:5173. Sidelit does not start or manage that process.
- Select text to reveal **Explain / Review / Edit** beside the passage. Inspect an element or use Feedback for a document-level request. The composer captures bounded context and sends it to a selected Pi session.

Attached selections remain highlighted while you compose. **Hide** or Escape retains the request in memory; reopening Feedback resumes it across tab changes and refresh. **Discard request** explicitly removes it. A new selection can replace the attachment without erasing your instruction. Expand **Attached context** to see the excerpt and technical details; **Reveal selection** returns to it. Shortened excerpts, changed documents and unsaved drafts are disclosed. Sending an earlier captured version requires an explicit choice. Requests last until app exit, with one active request at a time; batch review notes are not implemented.

Batch review notes and their acceptance criteria are tracked in [ROADMAP.md](../ROADMAP.md).

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

## Install the command on PATH

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

## Agent skill

[`skills/sidelit/SKILL.md`](../skills/sidelit/SKILL.md) is the repository-owned agent skill. It covers Markdown/HTML/MDX previews, safe external edits beside unsaved human drafts, development-server limitations, and connecting an existing Pi session. It uses the standard Agent Skills format and needs no extra runtime. The skill and the Pi receiver extension are separate: the skill guides the agent; the extension enables delivery.

From this checkout, install it in the shared skill directory:

```sh
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/sidelit" "$HOME/.agents/skills/sidelit"
```

Do not replace an existing skill without checking it. Agents that use a separate skills directory can link the same folder there. Restart the agent or reload its skills; in Pi, use `/reload`, then `/skill:sidelit`.

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
- YAML (`---`) and TOML (`+++`) frontmatter stays byte-for-byte unchanged while you edit the rendered body. Use Source to edit metadata. Markdown with Mermaid blocks uses a read-only Rendered preview; edit the document in Source. Unclosed frontmatter, raw HTML, reference syntax, math, code metadata, and recognized extensions still use Source with an explanation. The conservative gate can also route ordinary dollar signs or large documents to Source. Source stays selected until you explicitly change mode.
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

### Mermaid diagrams

Fenced `mermaid` blocks render offline with [Pele](https://github.com/obsidianmd/pele) in the isolated preview frame. Markdown files with diagrams are read-only in Rendered mode; Source remains editable. MDX previews also render Mermaid blocks. The original Markdown is not rewritten.

- Expand **Diagram source** to read or select the diagram code. Failed diagrams show their source and an error; the surrounding prose stays visible.
- Diagrams follow the theme and text size. Links, external images, custom icons, and math renderers are not enabled.
- Each page renders at most 32 diagrams. Each diagram is limited to 20,000 source characters, 500 flowchart edges, and 1,000,000 SVG characters. These bounds are not a CPU time limit.
- Pele uses its own layout; it does not promise the same appearance as Mermaid.js.

Try [samples/Diagrams.md](../samples/Diagrams.md). Other unsupported Markdown syntax still uses Source, even when the document contains diagrams.

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

Static previews are served from a memory-only custom protocol, not `srcdoc` (which would inherit the privileged page's CSP). They use an opaque-origin iframe with no same-origin, top-navigation, pop-up, or native API permission. HTML scripts are disabled unless explicitly trusted for that document. Standalone MDX and read-only Markdown diagram previews execute their compiled rendering code only in this sandbox; Markdown is compiled as Markdown, not MDX expressions. Network access remains blocked. Script execution can still consume CPU, so do not preview hostile MDX or enable hostile HTML scripts.

Local CSS (including bounded imports), images, SVG image data, fonts, and explicitly trusted local scripts pass through canonical Rust path grants. Stylesheet-relative URLs resolve from the stylesheet, not the document. Asset directories are watched alongside document directories. Missing or unauthorized assets surface warnings. Static previews are bounded to 256 asset references, 128 watched asset directories per open document, 24 MiB of expanded assets, and 32 MiB of prepared HTML; larger applications belong in a development server. Static previews cannot fetch arbitrary local files or make network requests; module dependencies and framework behavior belong in a development server.

Dev-server frames retain their separate HTTP origin for ordinary JS/HMR and forms; they receive no Tauri capabilities. Parent messages require the opened frame, expected origin, per-mount token, and bounded validated context. A page can supply context, never deliver agent instructions or invoke native commands. Source lines derived from a unique text match are marked **possible**, not exact; compiled DOM usually has no reliable source mapping.

Pi uses `/tmp/sidelit-pi-<uid>/` (0700 directory, 0600 socket/registration). No TCP listener, cloud service, or account is needed. Receipts are recorded in the Pi session for deduplication across extension reloads. They prove consumption, not successful completion; if Pi discards a queued instruction, it may remain **received**. The same ID will not resubmit a discarded queue entry; compose a new instruction deliberately. Receipt persistence follows Pi's own session-storage settings.

## Known limits and next steps

- Undo/Redo use the current editor's own history, including rendered code blocks and the editable Compare pane. The native Edit menu and keyboard shortcuts use the same route. Search fields keep their own text history; read-only comparison panes cannot undo the draft. History is editor-local: rich history resets on tab/mode remount, and a disk reload clears either editor's history. Monaco retains its model history until a rich edit or disk reload resets it. There is no cross-mode undo contract or recovered undo history.
- Files and local images are limited to 16 MiB. Large documents use Source. Quick Open is limited to 200 matches, 50,000 entries, depth 64, and a two-second traversal budget. Hard links are not deduplicated. Atomic replacement preserves basic permissions, not all extended metadata or hard-link relationships.
- Standalone MDX supports local components and expressions, but not imports, JSX supplied by an external application, dynamic asset expressions, framework routing, or module loading. Use a development server for these. Static HTML module imports, remote assets, fetch, and nested frames are intentionally restricted; use a server for ordinary application development.
- WebKit can redact HTML runtime error details in an opaque-origin frame. Sidelit reports that a page script failed; use the project development server for fuller debugging. MDX compilation errors retain the compiler's explanation.
- Development-server inspection requires a small page-side bridge; Sidelit does not inject JavaScript into arbitrary remote applications. The bridge is intentionally limited to selection/element context, shortcuts and bounded scroll restoration, and does not expose native commands. Remote page scripts and dependencies remain the responsibility of the development server.
- Markdown's existing raster-only image policy is unchanged. Static HTML/MDX support SVG as inert image data, not embedded SVG documents with privileges. Remote static-preview assets are blocked. Workspace restoration requires recovery to be enabled. Windows bridge support is not implemented (Unix sockets/permissions).
- macOS signing/notarization, Linux packaging, screen-reader use, narrow-window layouts, and native dialog edge cases need more coverage.
