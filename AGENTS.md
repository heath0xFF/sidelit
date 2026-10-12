# Sidelit

Tauri 2 / Rust desktop app. React + TypeScript + Vite frontend. pnpm only. No Electron, Node runtime, or sidecars.

## Layout

- `src-tauri/src/files.rs`: UTF-8 snapshots, SHA-256, optimistic atomic saves.
- `src-tauri/src/service.rs`: path grants, dialogs, directory watchers, narrow commands.
- `src-tauri/src/search.rs`, `recovery.rs`: bounded workspace search and private, validated recovery checkpoints.
- `src-tauri/src/cli.rs`, `main.rs`: CLI parsing, nonblocking handoff receipts, single instance, macOS file-open events.
- `src/documents.ts`: canonical buffers, baseline snapshots, revisions, pending external versions.
- `src/Rich.tsx`: Crepe transactions; `Source.tsx`: lazy Monaco, local worker, model lifecycle.
- `src/fidelity.ts`: frontmatter preservation and a conservative Source-only gate at Rendered entry.
- `src/closing.ts`, `recovery.ts`: live close approvals and serialized, coalesced checkpoints.
- `src/appearance.ts`: bounded font-size settings and System/One Light/One Dark preference resolution. `style.css` owns shared palette tokens; fonts and OFL notices are bundled offline.
- `src/App.tsx`: tabs, workspace, tree, dialogs, keyboard actions.

## Commands

`pnpm install --frozen-lockfile`; `pnpm desktop`; `pnpm check`; `pnpm test`.

`cargo fmt --manifest-path src-tauri/Cargo.toml --check`

`cargo check --manifest-path src-tauri/Cargo.toml`

`cargo test --manifest-path src-tauri/Cargo.toml`

`pnpm tauri build`

Desktop checks: use the isolated `desktop-test` bundle command in `README.md`, then run `scripts/desktop-smoke.py` with `SIDELIT_TEST_BINARY` set to that bundle. The test kills and restarts its own app for recovery checks; do not put real work in that window. This checks packaged WKWebView, not a browser preview. Rebuild **without** the feature before distribution. See `VERIFICATION.md`.

## Safety invariants

1. Mount, focus, mode switch, and no-op Save must not change canonical text or file bytes.
2. Only a real editor document transaction updates the draft. Do not use Crepe's debounced listener for the canonical buffer.
3. A dirty draft survives every external change and failed operation. Reload requires explicit discard consent.
4. Re-read disk before saving, compare the baseline hash, write and sync a same-directory temp file, then replace. Never overwrite a conflict.
5. Save acknowledgments update the baseline, not the current buffer. Read tokens reject stale results. New edits during Save remain dirty.
6. Never render raw document HTML or MDX. Unsupported syntax uses Source. New fidelity cases need tests.
7. Native selections, CLI requests, and confirmed links grant paths in Rust. Every custom filesystem command must enforce these grants and canonical identities. Capabilities do not enforce custom path scopes.
8. Watch directories, not file inodes. Keep watcher guards in application state. Do not use ignore timers for own saves.
9. Register single-instance first. Queue requests until the frontend drains them. Keep test instrumentation out of ordinary release builds.
10. Appearance updates must not remount editors, replace models, or write Markdown. Keep list markers aligned at every supported font size.
11. Close and Quit must revalidate live document revisions after awaits. Save Merged must use the explicitly reviewed disk hash, not the latest unseen version.
12. Recovery is opt-in, bounded, private, and separate from originals. Restore requires native path approval. Discarded drafts must not re-enter the final checkpoint; disabling recovery waits for writes before deleting it.
13. Keep both lockfiles. Use brief comments only where the reason is not clear from the code.
