# Sidelit roadmap

## Batch review notes

Status: planned after the single-request workflow shipped in v0.2.0.

While reading, collect several selected passages or elements with individual
Explain, Review, or Edit instructions. Keep reading without sending each note
immediately, then review the collection and send it deliberately to an existing
Pi session. Keep the interface compact; this is a review list, not agent chat.

Acceptance criteria:

- Add a note from text selection, element inspection, or the current document.
  Each note retains its instruction, intent, document identity and capture version.
- Keep notes when hiding the composer, changing tabs, or refreshing. Decide and
  document whether drafts survive app exit; do not imply persistence before it exists.
- Show a concise list with edit, remove and Reveal selection actions. Reattachment
  must fail closed, and stale or unsaved context must remain visible.
- Let the user choose which notes to send, inspect the final payload and explicitly
  select the target. Never silently combine different projects or change intent.
- Bound both individual notes and the aggregate message. Freeze sent IDs, payloads
  and destination; safely retry uncertain delivery without duplicating accepted notes.
- Distinguish unsent, received and accepted notes. Busy or disconnected Pi sessions
  must not lose notes or misrepresent delivery as completed work. Answers stay in Pi.
- Test multiple documents, stale captures, partial failures, retries, keyboard use,
  and the minimum window size. Preserve the single-request path and editor safety.

Current behavior and delivery semantics are documented in [README.md](README.md).
