# Verification

## v0.4.0 release checks

Saved review notes, batch delivery, request visibility, quit protection, and
HTML-comment previews are included in v0.4.0. The feature checks below record
the implementation passes before the release version was set.

Release checks passed: frozen pnpm install, TypeScript, 140 frontend/bridge
tests, 27 Rust tests, Cargo check/format, and the isolated signed updater test
at v0.4.0. The updater test used a disposable key and its own bundle; it checked
version/signature rejection, failed-install draft retention, real replacement,
and restart without stale CLI paths. It did not touch the installed Sidelit.
Packaged review, feedback, editor, and real-Pi fixture checks passed in the final
feature pass. The macOS release workflow checks universal architectures,
installer signatures, and the signed update feed before publication.

VoiceOver, Intel runtime, and older macOS versions still need manual checks.
Current releases remain ad-hoc Apple-signed, not notarized.

## Quit protection for unsent requests — unreleased

Quit, window close, and update/restart now share live request approvals with
Save to Notes / Discard / Cancel. Save waits for local storage and never sends.
Failed saves leave the app open. Edited saved notes keep their original ID;
unchanged saved notes need no prompt. Discard consent does not erase a request
if another prompt is canceled or exit fails. Attempted deliveries are not saved
as new unsent notes. Cancel receives focus after the modal opens.

- TypeScript, **140 frontend tests**, **27 Rust tests**, Cargo check/format,
  and whitespace checks passed. Unit tests cover storage failures, a full list,
  unavailable storage, changed requests across awaits, and stale approvals.
- Packaged `review-smoke.py` covers hidden drafts, Cancel/Escape, failed save,
  real save/quit/restart, explicit discard, unchanged and edited saved notes,
  unchanged document bytes/mtimes, and no extra delivery. It emits the native
  close event's `request-quit` message; Rust's window-close/exit routing was
  checked in `main.rs`. Update cancellation and failure use a test API, not an
  actual installer. No new native permissions or shipping test hooks were added.
- Packaged feedback and full desktop checks passed. The real-Pi companion test
  passed with its offline fixture model. The ordinary app was rebuilt without
  `desktop-test`; no installed app was replaced and no release was tagged.
- Light 720×480 and dark 1180×820 captures reviewed:
  `test-results/review/quit-unsent-light.png` and `quit-unsent-dark.png`.

Limits: force-quit and crashes can still lose a quick draft. The signed updater
installation test and VoiceOver were not rerun in this pass.

## Request dismissal and draft visibility — unreleased

Escape and Hide now clear the attachment highlight without discarding the
request. The preview also clears its native text selection. An explicit Reveal
selection can show the highlight with the composer closed; Escape clears it.
The toolbar keeps an Unsent draft label visible at narrow widths. It changes to
View request when delivery starts, not when a receipt arrives.

The packaged feedback regression failed on the old build and passed with the
fix. Packaged checks cover rich text, Mermaid previews, saved-note reveal,
reopening the same draft, and the visible label at 720×480. The real-Pi fixture
checks that delivery no longer leaves an Unsent draft label. TypeScript and all
134 frontend tests passed. Screenshots:
`test-results/ux-review/hidden-draft-narrow.png` and
`test-results/mermaid-hidden-draft.png`.

No installed app was replaced. Rust code was unchanged; Rust tests and VoiceOver
were not rerun for this fix. Quick requests still last only until app exit.

## Saved review notes — unreleased

One local list holds up to 20 notes. Add to review and Save note are explicit
local-save actions. Selected notes from one project or live-page origin are sent
as one bounded message. Its ID, target and payload are saved before sending and
kept unchanged for retry. Restarts do not send; acceptance is not completion.

Verified in this pass:

- TypeScript, **134 frontend/bridge tests**, **27 Rust tests** (including updater
  manifest tests), Rust formatting/check, and packaged builds.
- `scripts/review-smoke.py`: actual packaged WKWebView, multi-file capture,
  edit/hide/resume, reveal, explicit target, payload preview, private atomic
  storage, a dropped receipt, restart, identical retry, removal, unchanged file
  bytes and modification times, and controls at 720×480. The receiver is a
  private test socket; no real agent receives these batch requests.
- `scripts/feedback-smoke.py` and the full `scripts/desktop-smoke.py` passed.
  Desktop tests now float their own window under AeroSpace and scroll the lazy
  code editor into view instead of depending on the desktop's layout.
- `scripts/companion-smoke.py` passed with real Pi, its real edit tool, and an
  offline fixture model. It verifies the existing single-request flow. Socket
  unit tests cover one-message batch delivery and deduplication through Pi hooks.
- Wide dark and minimum-size light captures reviewed in-thread:
  `test-results/review/notes-dark.png` and `notes-light-minimum.png`. No new
  dependencies, chat history, automatic resolution, or browser engine was added.
  The new panel title uses the documented type scale; remaining detector
  advisories are in existing CSS outside this change.

Limits: no live-model batch run, Linux, or VoiceOver check. Saved notes are not
encrypted. Batch delivery needs the updated Pi extension and `/reload`.
No installed app or integration was replaced, and no release was published.

## HTML comment previews

Markdown with complete HTML comments now uses the read-only sandbox preview,
not Crepe. Comments stay hidden and unchanged; editing requires Source. Other
raw HTML and unsupported syntax still use Source.

- `pnpm check` and all **119 frontend/bridge tests** passed.
- The isolated packaged `desktop-smoke.py` passed, including comment visibility,
  blocked rich editing, sandbox isolation, Source/Rendered switching, and CRLF
  bytes and modification time unchanged after Save.
- Tests cover inline, multiline, adjacent, and literal code comments; mixed raw
  HTML; unclosed comments; disk refresh; recovery; and dirty-draft conflicts.
- Light and dark captures reviewed in-thread: `test-results/comments-light.png`
  and `comments-dark.png`. No layout or styling changes were needed.
- The actual `../mrmr/PRODUCT.md` passes the read-only preview check unchanged.

No installed app was replaced. Rust unit tests and VoiceOver were not rerun.
The isolated bundle uses `desktop-test` and must not be distributed.

## v0.3.0 — Mermaid previews — 2026-10-24

Pele 1.9.0 renders fenced Mermaid blocks offline in the opaque-origin preview.
Markdown files with diagrams stay read-only in Rendered mode and editable in
Source. The other fidelity checks remain in place. MDX shares the renderer.

Verified in this pass:

- TypeScript, **101 frontend/bridge tests**, **23 Rust tests**, and frontend build.
- Full packaged `scripts/desktop-smoke.py`, with new checks for two diagram types,
  invalid-source fallback, no parent DOM or native API access, live themes and
  font size, narrow layout, CRLF preservation, and no-op Save modification time.
  The test injects its probe through the test transport, not shipping code.
- Unit tests for disabled diagram links/images, inert HTML labels and Markdown
  expressions, source/edge/output limits, the 32-diagram cap, frontmatter,
  mixed unsupported syntax, dirty drafts, and external refresh.
- Wide dark, narrow light, and error-state captures reviewed in-thread:
  `test-results/mermaid-dark.png`, `mermaid-light-narrow.png`, and
  `mermaid-invalid.png`. No separate reviewer was available. The scoped review
  result is **ship**; existing MDX palette drift was not changed.
- Ordinary app bundle rebuilt without `desktop-test` during feature checks.
  Release preparation sets all three manifests and the Cargo lockfile to 0.3.0;
  frozen pnpm install, type checks, all tests, and Rust format/check pass again.
- The README image at `docs/images/sidelit.png` is an actual packaged 0.3.0
  WKWebView capture, with demonstration content and no user documents. It was
  checked at 1180×850 logical pixels and includes embedded capture provenance.
  No installation into `/Applications` was performed.

Limits: full Mermaid syntax compatibility and VoiceOver were not checked.
Pele uses its own layout. Diagram size limits do not impose a CPU time limit;
complex input can still delay rendering.

## v0.2.0 release preparation — 2026-10-23

All manifests and the Cargo lockfile agree on 0.2.0. Frozen pnpm installation,
TypeScript, 89 frontend/bridge tests, Rust formatting/check and 23 Rust tests pass.
`scripts/updater-smoke.py` passed against disposable app bundles and a temporary
signing key: version substitution and corrupt archives are rejected, cancelled
and failed installs preserve the dirty draft, Save precedes installation, and
real bundle replacement/restart succeeds without reusing a deleted CLI path.
The current version is not offered again. The test's editing step now explicitly
enters rich Edit, and its restart assertion checks the empty view rather than old
branding copy. No production key or ordinary running app was used by that test.

## Selection workflow and integration setup — 2026-10-23

Markdown now opens read-only with explicit rich Edit. Selection-adjacent Explain,
Review and Edit open a retained request: Hide/Escape, repeated opening and tab
changes preserve its instruction and original attachment. Capture records the
document version immediately, before the composer opens. Changed or unsaved
context is disclosed; text/element highlights refuse mismatched locations.
Delivery attempts retain their original target, ID and payload. Answers remain
in Pi, with a focus-only Show in Rex action.

Verified in this pass:

- TypeScript check, **89 frontend/bridge tests** and **23 Rust tests**, including
  multi-paragraph anchors, ambiguous/deleted selections, installer dry-run,
  idempotence, upgrades and preservation of modified/extra files.
- Full packaged `desktop-smoke.py`: rich and Monaco input, CodeMirror blocks,
  undo/redo, no-op saves, conflicts, refresh, file lifecycle and crash recovery.
  The suite caught a Crepe read-only transition that did not update embedded
  CodeMirror blocks; a decoration-only node-view refresh fixed it without
  changing canonical text or replacing editor models.
- Packaged `feedback-smoke.py`: selection capture predates composer opening,
  attachment replacement retains Explain, requests survive hiding/reopening and
  tab changes, stale context appears, and reading/selection writes no file bytes.
  The delivery controls remain visible at 720×630 and 720×480. Captures and the
  report are under `test-results/ux-review/`.
- Packaged `companion-smoke.py`: real Pi 1.4 runtime in a separate Rex pane,
  read-only doctor health check, busy-session follow-up, consumption acknowledgment,
  real edit-tool execution and live refresh without losing reading position.
  HTML/MDX/server previews, local assets, script opt-in and sandbox boundaries
  passed. The model is an isolated deterministic offline fixture, not a personal
  model account or the user's existing Pi session.

Setup embeds the matching Pi extension and agent skill in the executable and
installs versioned private resources. Doctor and sessions emit schema-versioned
JSON, distinguish installed from loaded receivers, and do not send instructions.
The installed user's integrations and running ordinary Sidelit were not replaced
or restarted. No Rex plugin, new runtime dependency or terminal typing was added.

The independent reviewer scored all five submitted fixes resolved and returned
**ship for the submitted scope**, including the rebuilt wide/narrow captures.
Rust format/check, skill validation and `git diff --check` passed. The ordinary
release app was rebuilt without `desktop-test`; its build ID is
`0cd57af-1792813685`, and `codesign --verify --deep --strict` passes. Its setup
dry-run reports both existing repo-linked integrations current. Nothing was
pushed or installed into `/Applications`.

Limitations: one active request at a time, held in memory until app exit; no batch
review queue or persisted feedback drafts. Explain/Review are instructions to Pi,
not an agent permission boundary. Source lines remain inferred text matches;
ambiguous or changed attachments require selecting again. Dev-server inspection
requires the updated opt-in bridge. Native accessibility/VoiceOver and focus-only
Show in Rex still need a manual human pass.

## Scroll preservation and Rex styling — 2026-10-23

The preview previously removed/recreated its iframe without preserving view state.
It now keeps the old frame during preparation, captures a bounded scroll snapshot
through the isolated bridge, and restores a visible anchor/offset with a pixel
fallback. This includes up to eight scrolling elements and a 32-document memory
cache. Restoration waits up to two seconds for layout and stops on user input;
it does not restore a different development-server route. Disabling the server
bridge also disables its inspection and keyboard interception.

Verified:

- **82 frontend/bridge tests**, including shell and sandbox syntax-contrast
  regressions, TypeScript check, **20 Rust tests**, Rust format
  check and `git diff --check`.
- Packaged WKWebView: long-page HTML, CSS refresh, 250px of content inserted
  above the reading position, manual refresh, nested scroll position, MDX
  recompilation and local server reload. The same passage stayed within 2px
  of its previous viewport offset.
- A real Pi runtime in a separate Rex pane accepted a busy-session follow-up,
  used its real edit tool, and updated HTML without moving the reading position.
  The model remains the deterministic offline fixture; no personal model account
  or existing agent session was used for this test.
- Full desktop smoke suite: no-op saves, dirty conflicts, merge safety,
  undo/redo, recovery/crash handling, image watching, live font/theme changes
  without editor remounts, and no unhandled JavaScript errors.
- Dark/light, Source, conflict, focus and Actions-panel captures in packaged
  WKWebView at 1180×790 and 720×630, plus the 720×480 minimum window. Captures and
  geometry checks are in `test-results/polish/rex/`; companion captures and logs
  remain under `test-results/companion-*`.
- The repository-owned skill at `skills/sidelit/SKILL.md` now describes all
  supported formats and distinguishes the skill from the Pi receiver extension.
  The skill validator passes. The installed skill on this machine is already a
  symlink to that repository folder.

Rex's current native app was inspected directly; the official Superlogical site
was also checked but uses a different light documentation design. The new shell
adapts the native app's charcoal/violet palette, soft tabs, compact icons and inset
panes. HTML/server document styles remain independent. No dependencies or fonts
were added in this pass. The design hook's only findings were two sandbox aliases
for existing fonts; those exact values were documented and narrowly suppressed.

The independent visual review requested higher syntax contrast. That fix was
recaptured and scored resolved (`ship` for the scored contrast fix), with no
introduced regressions observed in the supplied captures. Palette tests now
enforce at least 4.5:1 for normal shell/editor text and MDX syntax in both themes.
The ordinary app was rebuilt without `desktop-test`; its ad-hoc signature passes
`codesign --verify --deep --strict`. No release publishing or installation into
`/Applications` was performed.

Limitations: view state is not saved across application restarts. Removed,
ambiguous, sticky, virtualized or heavily restructured anchors use best-effort
pixel restoration; layout arriving after the bounded two-second window can still
move content. A development server needs the updated opt-in bridge to participate.
No changes were made to the user's running Sidelit, Rex or Pi sessions.

## Visual companion review — 2026-10-23

Reviewed the previous implementation against the visual-companion brief. Corrected
the MDX whitelist renderer (now real compilation/execution in an isolated frame),
inherited `srcdoc` CSP and frame navigation failures, stylesheet-relative assets,
missing asset watches, ambiguous target selection, overlong macOS socket paths,
and premature claims of Pi acceptance. Added the actual page-side development
bridge, bounded context validation, retry-safe receipts, lifecycle cleanup, and
responsive feedback states. Existing file/save/recovery logic was retained.

Verified on this Mac:

- `pnpm install --frozen-lockfile`, `pnpm check`, and **70 frontend/bridge tests**.
- Rust formatting/check and **20 Rust tests** (17 application + 3 update signature).
- Extension and offline-provider TypeScript against the installed **Pi 1.4.0** types.
- Packaged `app.sidelit.companion-check` WKWebView, not a browser approximation.
- Full `scripts/desktop-smoke.py`: no-op/optimistic saves, rich/source editing,
  undo/redo, source fidelity, dirty conflict protection, merge races, recovery
  crash/restart/deletion, font/theme identity, and nested image refresh without
  changing Markdown. No unhandled JavaScript, CSP, or worker errors.
- `scripts/companion-smoke.py`, launched in its own Rex terminal pane, with an
  **actual Pi runtime and actual edit tool**. The provider is a deterministic
  offline fixture, not a remote LLM. Feedback sent from the composer while Pi was
  busy became a native follow-up, received an acknowledgment, was consumed by Pi,
  edited the temporary HTML, and refreshed the preview. Shutdown removed its
  socket and registration. No personal Pi configuration or account was used.
- HTML scripts off by default; explicit trust; local CSS/SVG and stylesheet
  refresh; configurable viewport; text/DOM selection; real MDX JSX, expressions,
  components, tasks and highlighting; import errors; development-server bridge.
  Local frames had no Tauri globals and could not read the parent document.
  Initial script failures surface even before the inspection handshake; WebKit
  may redact their details because the frame has an opaque origin.
- Packaged captures inspected at 1180px and 720px window widths. The Impeccable
  pass guided compact controls, selection summaries, focus/error states, and
  overflow fixes without replacing the existing visual system. The static
  detector reported no findings; this is not an accessibility certification.

Evidence is in ignored `test-results/desktop-review.log`, `desktop.json`,
`companion-review.log`, `companion-pi-events.json`, and `companion-*.png`.
The test bundles are not for distribution; ordinary builds exclude WebDriver.

An ordinary `pnpm tauri build --bundles app` also passed, with no `desktop-test`
feature. The ad-hoc-signed Apple Silicon app is at
`src-tauri/target/release/bundle/macos/Sidelit.app` (about 16.94 MiB). Build warnings
remain for the large editor chunks and harmless empty MDX dependency directives.
No app installation or release publishing was performed.

Remaining real-world checks: your chosen hosted/local LLM provider, your specific
framework's HMR and embedding policy, native dialog/VoiceOver interaction, Intel,
Linux, and older macOS versions. The real Pi queue/tool/extension lifecycle was
tested; model reasoning and arbitrary framework runtimes were not. Standalone
MDX intentionally rejects imports; project-aware MDX uses an existing server.
No production updater installation or release signing was performed in this pass.

Official API references checked: [Pi extensions](https://pi.dev/docs/latest/extensions),
[MDX compiler](https://mdxjs.com/packages/mdx/), and
[Rex automation](https://www.superlogical.com/rex/docs/automate/server-api), alongside
installed Pi types/implementation and live Rex CLI responses. Rex discovery uses
read-only commands with autostart disabled; delivery never simulates terminal input.

The older sections below are historical measurements, not new performance claims.

## Environment

Checked on Apple M5 Pro, 48 GiB RAM, macOS 26.6.2 (25G83), arm64. Rust 1.95.0, Node 26.8.1, pnpm 10.33.2. The desktop engine was the installed WKWebView, not Chromium.

## Build and automated results

All passed:

- `pnpm check`
- `pnpm test`: **42 tests**, including document safety, close races, recovery writes, fidelity, and appearance
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`: **12 tests**, including actual files, notify events, recovery, scoped search, and bounded reads
- `pnpm tauri build --features desktop-test` with the isolated `app.sidelit.feature-check` identifier
- `scripts/desktop-smoke.py` with `SIDELIT_TEST_BINARY` set to that isolated bundle
- Final **ordinary** `pnpm tauri build`, with no test feature

The final bundle is `src-tauri/target/release/bundle/macos/Sidelit.app`. Its disk size is about **13.01 MiB**. It uses an ad-hoc signature, not a Developer ID signature or Apple notarization. The build still reports the existing large-editor-chunk warning; Monaco remains lazy-loaded.

### Packaged WKWebView checks

The optional embedded WebDriver plugin drove the packaged app. It is feature-gated out of the ordinary release.

Verified through actual desktop commands and editor DOM input:

- Crepe rendered input and Monaco source input, with edits surviving mode and tab switches.
- Source syntax display, line numbers, wrapping, and find. Selection and source copy/paste event handling were also checked. A separate Crepe check copied selected text to the macOS clipboard successfully, then restored its prior text value.
- Rich bold and Save shortcuts through keyboard events. Native menu key routing still needs a manual pass.
- Source loaded from the local bundle. Monaco workers used `/assets/editor.worker-*.js`; comparison ran without worker errors, CSP violations, or unhandled JS errors.
- Relative local PNG loading. A real rich edit and Save retained the image's original alt text and path. This caught Crepe's optional block-image alt-text conversion; Sidelit now uses Milkdown's standard image schema instead.
- No-op Save preserved fixture bytes and modification time. CRLF remained intact after rich edits. Unsupported body syntax remained in Source. Rich body edits preserved frontmatter bytes, including comments and CRLF.
- Clean-buffer external refresh and read-only review of its prior disk version; dirty-buffer conflict with an editable draft comparison; cancel and confirm Reload.
- Atomic rename, deletion, and recreation observed through directory watches.
- Dirty Close and Quit showed a prompt; Cancel kept the draft. Save on Close wrote the draft.
- Repeated CLI calls reused the same instance and tab. Relative paths from a different caller cwd, spaces, Unicode, and `--source` worked.
- Task, bullet, numbered, nested, wrapped, and two-digit list markers aligned with the first text line. The desktop test checks their geometry to within 0.75 CSS px.
- Light and dark themes were captured. A native resize request did not change the capture's viewport; narrow-window visual testing is therefore **not** claimed.

A separate cold Launch Services check used `open -a <Sidelit.app> /tmp/sidelit-native-check.md`. The Markdown document opened through the native macOS file-open event.

Frontend state tests cover stale reads, edits during Save, late responses after Close, retained pending snapshots after deletion, duplicate opens, unsupported syntax, and draft retention. They also cover reviewed-hash merge saves, restored baselines, frontmatter boundaries, sticky Source mode, parser call frequency, live close approvals, and coalesced recovery writes. Rust tests cover optimistic conflicts, no-op byte/mtime preservation, no-clobber creation, atomic replacement, chunked writes, recreation, path scopes, and symlink escapes.

Test output and captures are written to ignored `test-results/`. The test server on port 4445 was not present after the ordinary release launch.

## Font and theme update

The update was tested in a separate `Sidelit Check.app` with its own application identifier. The normal running Sidelit instance and its drafts were not closed or changed.

Verified in packaged WKWebView:

- IBM Plex Sans and Inconsolata font faces loaded from bundled WOFF2 files. Rendered paragraphs use IBM Plex Sans; Monaco and fenced code use Inconsolata. Font licenses are included in the bundle.
- One Light and One Dark apply to the shell, rendered code blocks, Monaco, and comparison. Source backgrounds match the shell palette. Sun, moon, and system icons render as SVG geometry.
- System preference resolves to the current OS theme. Explicit overrides apply immediately. Theme and font size survived a webview reload. Live OS notifications are handled by `matchMedia`; the machine-wide appearance setting was not changed during tests.
- A− / A+ and keyboard shortcuts update text size without replacing the Crepe or Monaco editor DOM, changing file bytes, or marking clean documents dirty.
- List marker geometry passes at 12, 16, 24, and 28px, including nested/wrapped items and two-digit numbers.
- The full existing desktop smoke test passed with no worker, CSP, or JavaScript errors. Inspected light/dark rendered-code captures and dark Source. The mechanical design check returned no findings.
- A final production build without test instrumentation passed. The isolated test app was closed; the original user window was left running. Restart that window to load the new build.

## Recovery and review update

All six audit findings were addressed. The update also adds the six approved feature groups. Additional regression checks passed:

- Close/Quit approvals use live revisions and reject drafts changed during a delayed save. Closing a dirty background tab leaves a valid active editor.
- Save Copy authorization survives removal of the original parent directory. Native-selected creation rejects existing names and invalid destinations without replacing files.
- Bounded file reads reject FIFOs and directories. Image I/O no longer holds the service mutex.
- Source stays selected after its triggering syntax is removed. Routine renders and Source typing do not run the Markdown safety parser.
- Quick Open searches the authorized workspace, skips symlinks/generated folders, and supports keyboard selection. Traversal limits are covered in Rust.
- Editable Compare accepts individual changes through Monaco's native controls, including disk-only insertions. Enter and Space activation passed; controls were not inside an `aria-hidden` ancestor. A newer disk version blocked Save Merged. Direct draft edits and a final merged save also passed.
- Clean external changes retained their previous disk snapshot for read-only review.
- New File and Save As frontend success, cancel, and error paths passed with simulated native selections. Save As kept the original draft; Rust separately tested actual no-clobber file creation.
- Recovery wrote a real private checkpoint. The test killed its isolated host process, changed a file externally, restarted the app, and restored the saved draft beside the disk conflict. Native restore approval was simulated; CLI grants still authorized the real file reads. Turning recovery off removed the checkpoint.
- Recovery tests covered private permissions, expiration, malformed checkpoints, write coalescing, and waiting for writes before deletion. Original files are not recovery targets.
- Cold startup testing found and fixed a listener-registration race that could consume the first CLI request before initialization. Recovery initialization no longer replaces those listeners.

Packaged smoke output had no worker errors, CSP violations, or unhandled JavaScript errors. Final test-build observations were **0.644 s** cold handoff, **1.157 s** to observed editor readiness (including the 0.5 s test delay), and **0.055 s** warm handoff. These are not production performance benchmarks.

Inspected captures for frontmatter, Quick Open, editable Compare, external-change review, recovery settings, and the restore offer. The existing visual system was retained. The mechanical UI check returned no findings. Native dialog automation was unavailable (`System Events` reported UI scripting disabled); no OS permissions were changed for these tests.

## Rendered width, Undo/Redo, and agent skill

Checked in the isolated `Sidelit Input Check.app` (`app.sidelit.input-check`). The normal running Sidelit instance was left untouched.

- The rendered column has no fixed width cap. Packaged geometry checks confirmed 10% side padding and a 32px minimum gutter in a 300px editor pane. Light/dark captures were inspected. This is not a native narrow-window test; the WebDriver resize limitation still applies.
- Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z keyboard events, plus `menu-action` events, reached the real Crepe and Monaco histories. These checks do not prove physical macOS menu key-equivalent dispatch.
- Undo/Redo worked in rendered paragraphs, code blocks, Source, and editable disk-change adoption. The read-only disk pane and clean-change review did not edit the draft.
- Returning to the loaded rich document restored its original Markdown, including formatting, frontmatter, and CRLF. Disk refresh reset rich history; Undo did not restore an obsolete disk version. History operations did not save files.
- Quick Open retained its own native text history. Undo in an empty search field could not change the document behind the dialog. A temporary textarea inside Monaco checked the same field-routing boundary without changing the source buffer.
- A direct synthetic Find-widget test exposed a canceled promise in Monaco's WebKit clipboard workaround. The routing test uses the textarea fixture instead; native Find/clipboard interaction still needs a manual pass. The final smoke run reported no worker, CSP, or unhandled JavaScript errors.
- The full desktop smoke test passed, including the real recovery checkpoint, forced termination, restart, conflict-safe restore, and deletion. Restart now waits for the webview to settle before opening its WebDriver session. The script rejects the ordinary application identifier before it can launch or kill an app.
- All 42 frontend and 12 Rust tests, type checks, and Rust formatting passed. An ordinary `pnpm tauri build --ci --no-bundle -- --locked` passed without test features; no running app bundle was replaced. The mechanical UI check reported no findings.
- `skills/sidelit/SKILL.md` passed frontmatter validation. Its CLI syntax matches the existing parser and desktop handoff checks. Local links were installed in `~/.agents/skills/sidelit` and `~/.claude/skills/sidelit`.

These features require v0.1.1 or later; v0.1.0 did not include them.

## Signed updates

The repository and downloads are now public. The updater uses the public GitHub release feed, HTTPS checks/downloads, a committed public key, and signed-version enforcement. The private release key is outside Git and is stored separately in an Actions secret; see `RELEASING.md`.

`python3 scripts/updater-smoke.py` passed against real packaged WKWebViews, with a disposable key and local HTTP feed in a separate test app:

- A missing feed reports an error on a manual check without blocking editing.
- Cancel keeps the draft and the old app. Discard followed by a failed install also keeps the draft in memory and does not change its file.
- An archive with changed bytes is rejected. A valid signature paired with a false new version is also rejected before installation.
- Save completes before a valid update replaces the real test bundle. The updated process starts and recognizes its new version; it does not offer that version again.
- A PATH-symlink CLI launch works. Testing found that a GUI started through the raw symlink could not use Tauri's updater; the CLI now resolves its executable before starting the GUI.
- Restart works after the original CLI file has been deleted. It does not reuse that file argument or the old handoff receipt.

The test builds versions `0.0.0` and the current version, checks their distinct process lifetimes, and removes its app and temporary key. It never uses the release key or replaces the ordinary Sidelit app. Tests wait for the save dialog before selecting Save, so they cannot click the toolbar's Save button instead. Update-offer and progress captures were inspected; no new layout issue was found.

All 42 frontend and 15 Rust tests passed, including release-signature checks for changed bytes, changed claimed versions, altered trusted comments, and invalid signatures. Type and formatting checks passed. The full desktop smoke test also passed with no worker, CSP, or unhandled JavaScript errors (0.473 s handoff, 0.989 s observed readiness, 0.056 s warm handoff on this run). Actual native administrator approval, a quarantined browser download, and Intel runtime remain unverified.

## Visual polish

Checked in the isolated `Sidelit Polish Check.app` (`app.sidelit.polish-check`). No ordinary app bundle was replaced. The changes are limited to the shell, CSS, menu dismissal, tests, and documentation; the editors and file services are unchanged.

Before/after captures use the same fixture, three tabs, sidebar width, and native window sizes. Measured CSS viewports were **1180×790** and **720×630**. AeroSpace was forcing the test window into a tile; floating only that window allowed WebDriver to resize it. This resolves the earlier narrow-window test limitation on this machine.

Visually inspected:

- One Light and One Dark, with long filenames, nested folders, multiple tabs, and neutral selection states.
- Rendered headings, nested/wrapped lists, tasks, two-digit markers, tables, inline code, and fenced code.
- A real unsaved edit beside a watched disk conflict, in both window sizes.
- Actions and its appearance controls, a visible focus ring after Escape, and the panel fitting a **720×480** CSS viewport.
- Source in both themes, with the unsaved indicator and conflict actions retained.

Captures and the local fixture/capture script are in ignored `test-results/polish/`. Compare `before/` with `final/`. Tern screenshots were not available in the request or local repository, so no direct reference-image comparison is claimed.

Passed:

- `pnpm check` and all **58 frontend tests**.
- Rust formatting, `cargo check`, and all **15 Rust tests** (12 app tests plus 3 release-signature tests).
- Isolated packaged build and the full `scripts/desktop-smoke.py` run, including recovery crash/restart/deletion. No worker, CSP, or unhandled JavaScript errors were reported.
- New desktop assertions for Actions staying open during text-size changes, Escape focus return, outside-pointer dismissal, focus leaving the panel, and dismissal on a file action.
- First-heading spacing before and after a real edit, including Crepe's cursor widgets. Existing list geometry checks still pass at 12, 16, 24, and 28px.
- Existing no-op save, editor identity, undo/redo, and fluid-width checks. A separate capture assertion retained the dirty rendered draft, DOM identity, selection, and scroll through a theme change.
- Ordinary `pnpm tauri build --ci --no-bundle -- --locked`, without test instrumentation. The existing large-editor-chunk warning remains.

A mechanical UI scan reported no findings. The test app was closed after the checks. Physical keyboard traversal, native dialogs, VoiceOver, and older macOS/Linux runtimes still need manual verification. No updater install test was repeated for this visual-only change.

## Measured startup and idle use

The following numbers are the **baseline before the font/theme and recovery updates**; process memory and CPU were not remeasured for these changes. Measurements are observations on this Mac, not framework guarantees.

**Ordinary release, one sample document:**

- Cold CLI handoff: **0.187 s**.
- Warm CLI handoff to Source: **0.055 s**.
- Packaged test-build editor observed ready in **1.127 s** on the final run, including a deliberate 0.5 s WebDriver settling delay. This is an upper-bound observation, not an exact first-paint measurement. Earlier test runs observed 0.67–1.08 s by the same method.

`python3 scripts/measure-macos.py` took five process samples, two seconds apart, after five seconds of settling. RSS ranges were:

| Process observed during launch | Rendered | After opening Source |
| --- | ---: | ---: |
| Sidelit host | 104.6–104.8 MiB | 117.4–117.5 MiB |
| WebKit WebContent | 148.7–149.1 MiB | 277.4–277.7 MiB |
| WebKit GPU | 35.7–36.0 MiB | 41.7–41.8 MiB |
| WebKit Networking | 13.2 MiB | 13.3 MiB |

The observed RSS sum was roughly **303 MiB rendered** and **450 MiB with Source loaded**. RSS can include shared pages; it is not an exclusive physical-memory footprint. These were new WebKit processes observed during this app's launch, not a claim that every OS service is exclusively owned by Sidelit.

`ps` sampled idle CPU at **0.0%** for the host, GPU, and networking processes. WebContent samples were **0.0–0.1%** in both modes. CPU time rose about 0.01 s in the eight-second sample span. These short idle samples do not measure editing load or large-document behavior.

Monaco is lazy-loaded, but its memory cost is still material once opened. No lower footprint is claimed.

## Release packaging

A native Apple Silicon DMG was built with `CI=true pnpm tauri build --ci --bundles app,dmg -- --locked`. Its disk-image checksum passed. It was mounted read-only, and its `Sidelit.app`, Applications shortcut, code signature, and executable version were checked. All 54 existing tests passed again.

The release workflow checks version agreement and the source tag before building. Local checks confirmed that `main` and the matching version tag pass; a wrong tag or another branch is rejected. YAML and shell syntax checks passed.

[GitHub Actions run 38310055240](https://github.com/heath0xFF/sidelit/actions/runs/38310055240) passed all tests, built both architectures, verified the installer, and published [v0.1.0](https://github.com/heath0xFF/sidelit/releases/tag/v0.1.0) from commit `4076230`. The published `Sidelit_0.1.0_universal.dmg` is 13,344,897 bytes (about 12.73 MiB).

The actual GitHub download was checked on this Mac: its SHA-256 matched `SHA256SUMS.txt`, its image checksum and code signature passed, and its mounted app contained both `x86_64` and `arm64`. The executable reported `Sidelit 0.1.0`; the bundle identifier and minimum OS were `app.sidelit.desktop` and `13.0`. The Applications shortcut was present. Signing metadata confirmed an ad-hoc signature with no Apple Team ID.

The first CI attempt stopped on an incorrect `lipo` command and published nothing. The check was corrected, then split into one check per architecture for compatibility across Xcode versions.

[Actions run 38323404615](https://github.com/heath0xFF/sidelit/actions/runs/38323404615) published [v0.1.1](https://github.com/heath0xFF/sidelit/releases/tag/v0.1.1) from `f5e4c61`. Its universal DMG is 16,450,180 bytes (about 15.69 MiB); its signed update archive is 16,726,607 bytes. All five assets were downloaded without GitHub authentication. Their checksums passed. The update archive's signature and signed version passed against the committed public key, and the generated manifest matched the downloaded one. The mounted DMG's signature, both architectures, version `0.1.1`, bundle identifier, minimum OS, and Applications shortcut passed again. The ordinary production build also passed without test features.

This does not verify a quarantined browser download or Gatekeeper approval. Releases are ad-hoc signed and not notarized. See [RELEASING.md](RELEASING.md).

## Not yet verified

- Full native Open/New/Save As/Save Copy dialogs and restore permission dialogs. Desktop tests simulate new save selections and restore approval; they do not prove the native dialogs. Rust creation, authorization, and recovery primitives are tested. Follow the README manual checks.
- Native macOS key-equivalent routing, full clipboard formats, VoiceOver, or other screen readers.
- Linux packaging/runtime, other macOS versions, Intel Macs, Apple notarization, native update administrator approval, or Gatekeeper distribution behavior.
- Long-running stress, very large workspaces/files, network filesystems, power-loss recovery, extended file metadata preservation, and dependency advisories.

## Known risk

The hash check plus atomic replace protects against observed conflicts and partial saves, but is not an interprocess lock. A writer can race the final check. Recovery is off by default, is not encrypted, and is not a backup. A crash can lose edits after the last successful checkpoint. Without recovery, unsaved drafts remain memory-only.
