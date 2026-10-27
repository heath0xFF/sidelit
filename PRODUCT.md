# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

Desktop UI in Tauri's OS webview. macOS first; portable to Linux.

## Stack
Tauri 2 and Rust; React, TypeScript, Vite, Crepe, and lazy-loaded Monaco. No Electron or Node runtime.

## Users and purpose
Developers use Rex for terminals, Pi for agent work, and Neovim for general source editing. Sidelit renders Markdown, HTML, and MDX, captures bounded text/element context, and sends an Explain, Review, or Edit request to an existing Pi session. The core loop is read → select or inspect → request → follow up in Pi → refresh. It is not an IDE, terminal emulator, or chat harness.

## Constraints
Files are the source of truth. Explicit saves, safe conflict handling, offline local previews, native dialogs, and one application instance. Preserve Crepe and Monaco; isolate executable previews. Pi delivery is local-only, acknowledged, and uses its native follow-up queue, never terminal typing. No cloud, agent chat, server process manager, or proprietary storage.

Sidelit keeps one quick request in memory; hiding it and switching tabs preserve it, but app exit does not. Add to review explicitly saves a note locally. One bounded list holds up to 20 notes across restarts, separate from document recovery. Selected notes from one project or live-page origin can be sent as one batch to an explicitly chosen Pi session. One batch delivery attempt is retained until the user removes it; there is no task history, automatic sending, or completion tracking. Captured context remains tied to its original document and version: unsaved captures are labelled, changed file context needs explicit acknowledgment, and a new selection requires explicit replacement. A delivery attempt is immutable, including retries. Answers belong in Pi; delivery or acceptance is not completion.

## Brand commitments
Sidelit is a working name. The user requested Rex's native structure: blue-charcoal surfaces, quiet icons and soft tabs, without copying its terminal layout. The Fold icon now supplies amber and burnt-orange action accents. Minimal chrome, compact controls, subtle borders, clear focus, and maximum preview space. New installs use Dark; preserve explicit System or Light preferences. Rendered text uses IBM Plex Sans; monospace uses Inconsolata. HTML and dev servers retain their own page styles.

## Decisions
The brief supplies the product and visual direction; no extra interview is needed. Rendered Markdown defaults to reading, with explicit Edit for local changes and Source when needed. Selection-adjacent Explain and Review ask Pi to answer without editing files; request Edit requires a change instruction. A compact contextual composer can be hidden and reopened; a persistent attachment highlight and Reveal selection reconnect it to the document only when the capture can be located safely. Show in Rex returns to a linked Pi session. Never choose an ambiguous agent target or label a bridge receipt as completed work. Retain appearance preferences without remounting editors.

Approved additions: New File and Save As with native, no-clobber creation; workspace Quick Open; editable conflict comparison; review of the latest clean external change; frontmatter-preserving rendered editing; and opt-in local session recovery. Recovery stays separate from the original Markdown, requires fresh native folder approval, keeps only the latest checkpoint for seven days, and provides an off-and-delete control. No version-history system, cloud service, or embedded agent runtime was added. Public GitHub releases supply signed app updates: check on startup and daily, install and restart only after user approval and safe draft handling. Document text and paths are not sent in update requests.
