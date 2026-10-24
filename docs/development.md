# Developing Sidelit

[Overview](../README.md) · [User guide](user-guide.md) · [Release process](../RELEASING.md)

Run the commands below from the repository root. These instructions are for building Sidelit, not for installing the released app.

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

## Build and launch without Node

```sh
pnpm tauri build
./scripts/sidelit samples/Welcome.md
```

The native Apple Silicon build is here:

```text
src-tauri/target/release/bundle/macos/Sidelit.app
src-tauri/target/release/bundle/dmg/
```

The DMG filename includes the app version and target architecture.

You can also open this app in Finder. The bundle contains all frontend assets and Monaco workers. It does not need Vite, Node, or a network connection.

For an explicit Apple Silicon target:

```sh
rustup target add aarch64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin
```

That build goes under `src-tauri/target/aarch64-apple-darwin/release/bundle/`. GitHub builds both Mac architectures into one universal DMG. The default signature is ad-hoc (`-`); a Developer ID certificate and notarization are still needed for normal Gatekeeper approval. See [RELEASING.md](../RELEASING.md).

## Linux

The code uses portable Rust filesystem and notify APIs. Install Tauri's current [Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux), including WebKitGTK 4.1, GTK 3, a C toolchain, and librsvg. Run `pnpm desktop`, or package with `pnpm tauri build --bundles deb,appimage` instead of the macOS `app,dmg` targets. Linux builds and desktop integration have **not** been verified in this first version.

## Architecture

- **Rust:** `updates.rs` checks signed releases and installs only the offered version after frontend close approval. `files.rs` handles bounded reads and atomic saves. `service.rs` owns grants, open-file watches, native dialogs, images, and the request queue. `search.rs` bounds workspace search; `recovery.rs` validates and stores private checkpoints. `cli.rs` parses requests. `main.rs` registers single-instance first and handles lifecycle/native events.
- **React:** `documents.ts` is the authoritative buffer state. It rejects stale reads and keeps save acknowledgments separate from current edits. `closing.ts` checks live revisions; `recovery.ts` coalesces checkpoint writes. `App.tsx` connects these to tabs, navigation, and conflict actions. Markdown safety parsing runs when entering Rendered, not on routine application renders or Source typing.
- **Editors:** `Rich.tsx` publishes synchronous document transactions. `Source.tsx` owns stable file-URI Monaco models and local worker setup. Models/listeners are released when tabs close. Both retain cursor/scroll state where practical.
- **Preview:** `formats.ts` classifies documents; `preview-html.ts` resolves assets and applies CSP, `mdx.ts` compiles without execution, and `preview-runtime.tsx` is built as an iframe-only bundle. `preview.rs` serves bounded in-memory publications. `Preview.tsx` owns viewport/trust/bridge lifecycle. `inspection.ts` bounds and validates context; `extensions/preview-bridge/` is shared with development pages.
- **Feedback:** `SelectionActions.tsx` offers Explain/Review/Edit; `selection-dom.ts` reattaches verified selections. `App.tsx` retains a versioned request snapshot; `FeedbackComposer.tsx` keeps an immutable delivery attempt and reports acknowledgments. `agents.rs` matches project-aware Rex/Pi targets and delivers JSONL over a user-only Unix socket. `extensions/pi-sidelit/` uses Pi's native `sendUserMessage` and follow-up delivery for busy sessions.
- **Setup:** `integrations.rs` installs embedded, versioned Pi/skill resources without a checkout or package manager. Doctor uses a read-only socket ping and build registrations; it distinguishes installation from a loaded receiver.

The first implementation used a packaged editor shell, then connected file navigation, saves, refresh/conflicts, CLI requests, and desktop checks. There were no stack substitutions. Crepe's optional block-image feature is disabled because it stores image size in Markdown alt text. A standard Milkdown image node with a scoped local-image view preserves alt text and titles instead. See [AGENTS.md](../AGENTS.md) for change rules and [VERIFICATION.md](../VERIFICATION.md) for results.

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

## References and license

Versions are locked in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`: Tauri 2.12, Crepe/Milkdown 7.22, Monaco 0.57, Vite 8.3, and stable notify-debouncer-full 0.7 (not its release candidate).

Official references checked: [Tauri single instance](https://v2.tauri.app/plugin/single-instance/), [capabilities](https://v2.tauri.app/security/capabilities/), [desktop WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [Crepe](https://milkdown.dev/docs/guide/using-crepe), [Monaco](https://github.com/microsoft/monaco-editor), [Rex Server API](https://www.superlogical.com/rex/docs/automate/server-api), [Rex CLI](https://www.superlogical.com/rex/docs/automate/cli), [Pi extensions](https://pi.dev/docs/extensions), and [notify-debouncer-full](https://docs.rs/notify-debouncer-full/0.7.0/notify_debouncer_full/).

New Sidelit code and sample assets are [MIT licensed](../LICENSE). Dependencies retain their own licenses. IBM Plex Sans and Inconsolata use the SIL Open Font License; their notices are in `public/licenses/` and are included in the packaged assets. Typora is UX inspiration; this is an original implementation.
