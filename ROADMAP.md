# Sidelit roadmap

## Batch review notes

Status: implemented in v0.4.0. One local list, 20 notes, and one immutable batch delivery record. Add to review is the explicit local-save action. No task history, automatic sending, or completion tracking.

While reading, collect several selected passages or elements with individual
Explain, Review, or Edit instructions. Keep reading without sending each note
immediately, then review the collection and send it deliberately to an existing
Pi session. Keep the interface compact; this is a review list, not agent chat.

Acceptance criteria:

- Add a note from text selection, element inspection, or the current document.
  Each note retains its instruction, intent, document identity and capture version.
- Keep saved notes when hiding the composer, changing tabs, refreshing, or exiting.
  Composer edits require Add to review, Save note, or Save to Notes on exit before
  they are stored. Quit, window close, and update/restart offer Save to Notes /
  Discard / Cancel for unsent requests and unsaved note edits; failed saves stop exit.
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

## switch html renderer for real browser?

i have no idea if this is a good idea or not, but i wanted to capture it somewhere
