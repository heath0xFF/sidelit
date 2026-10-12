# Verification — v0.1

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

This does not verify a quarantined browser download or Gatekeeper approval. Releases are ad-hoc signed and not notarized. See [RELEASING.md](RELEASING.md).

## Not yet verified

- Full native Open/New/Save As/Save Copy dialogs and restore permission dialogs. Desktop tests simulate new save selections and restore approval; they do not prove the native dialogs. Rust creation, authorization, and recovery primitives are tested. Follow the README manual checks.
- Native macOS key-equivalent routing, full clipboard formats, VoiceOver, or other screen readers.
- Linux packaging/runtime, other macOS versions, Intel Macs, Apple notarization, native update administrator approval, or Gatekeeper distribution behavior.
- Long-running stress, very large workspaces/files, network filesystems, power-loss recovery, extended file metadata preservation, and dependency advisories.

## Known risk

The hash check plus atomic replace protects against observed conflicts and partial saves, but is not an interprocess lock. A writer can race the final check. Recovery is off by default, is not encrypted, and is not a backup. A crash can lose edits after the last successful checkpoint. Without recovery, unsaved drafts remain memory-only.
