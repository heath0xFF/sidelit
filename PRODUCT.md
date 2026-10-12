# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

Desktop UI in Tauri's OS webview. macOS first; portable to Linux.

## Stack
Tauri 2 and Rust; React, TypeScript, Vite, Crepe, and lazy-loaded Monaco. No Electron or Node runtime.

## Users and purpose
People who work with terminal coding agents need to read and edit the Markdown those agents write. Open from the CLI, browse a directory, edit rendered text or source, and see external changes without losing a draft.

## Constraints
Markdown is the source of truth. Explicit saves, safe conflict handling, offline operation, native dialogs, and one application instance. No cloud, AI chat, or proprietary storage.

## Brand commitments
Sidelit is a working name. Typora is a UX reference, not an implementation to copy. A restrained desktop writing tool with clear keyboard focus. Use One Light and One Dark, defaulting to the machine's system theme. Rendered text uses IBM Plex Sans; monospace text uses Inconsolata. Users can increase and decrease document font size.

## Decisions
The brief supplies the product and visual direction; no extra interview is needed. Follow the OS theme by default, including changes while running. Retain an explicit local override and the document font-size preference.

Approved additions: New File and Save As with native, no-clobber creation; workspace Quick Open; editable conflict comparison; review of the latest clean external change; frontmatter-preserving rendered editing; and opt-in local session recovery. Recovery stays separate from the original Markdown, requires fresh native folder approval, keeps only the latest checkpoint for seven days, and provides an off-and-delete control. No version-history system, cloud service, or AI component was added. Public GitHub releases supply signed app updates: check on startup and daily, install and restart only after user approval and safe draft handling. Document text and paths are not sent in update requests.
