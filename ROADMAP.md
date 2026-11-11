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

## Send to any agent

Status: Copy as prompt shipped in 0.9.0; direct delivery not started. Today requests only reach Pi directly. Let them reach Claude Code,
Codex, and other agents in sessions that are already running.

Likely approach, from reading how [Orca](https://github.com/stablyai/orca) does it:

- Keep the Pi bridge, which has the strongest receipts.
- For agents in Rex panes, paste the request and press Enter with
  `com.superlogical.terminal.write`, then watch `com.superlogical.terminal.program_status`
  for a turn starting. No start flags or restart should be needed.
- For everything else, add Copy as prompt.

To decide first: this reverses the rule that delivery never types into a terminal.

Requirements if it goes ahead:

- Never send to a pane that is waiting on permission, or whose process has changed.
  Enter could answer the dialog.
- Don't submit text the person has half typed. Orca doesn't appear to guard against this;
  reading the screen first needs a parser for each agent.
- Say what was actually confirmed. Sidelit can show "sent" and "a turn started" but can't
  tie a turn to a request, and an already busy agent gives no confirmation at all.
- Carry the no-edit instruction for Explain and Review through every route.
- Discovery only accepts a process named `pi`; Claude's process name is its version, so
  match on `argv0` or the status app.

Unverified: `write` hasn't been tried. `program_status` has only been seen on one Claude
Code pane; Orca's matrix lists Codex and Pi as reporting it too. Paste timing differs by
agent, so check Orca's `src/shared/agent-prompt-injection.ts` (MIT) first. Fallbacks if
typing is ruled out: Claude Code channels (research preview, needs a start flag) and the
Codex app server or `codex queue`.

## switch html renderer for real browser?

i have no idea if this is a good idea or not, but i wanted to capture it somewhere

## Ghost scroll bug

Status: idea, not started. When opening and scrolling a document, the program scrolls with no user input — the view jumps or drifts on its own. Needs repro steps: does it happen on all document sizes, only on first open, or only after certain operations? Check the scroll state sync between the editor and the preview pane, and whether the initial scroll position is being applied twice.

## Sidebar icon clarity — "modified" vs "marked reviewed"

Status: idea, not started. The left sidebar uses similar icons for "modified" (unsaved changes) and "marked reviewed" (review batch status). They are hard to distinguish at a glance. Redesign the two icons so they are visually distinct — different shape, color, or both — and verify they remain distinguishable at small sizes and in dark/light themes.

## Tooltips for sidebar status icons

Status: idea, not started. The sidebar icons referenced above (and any other status icons in the left sidebar) need tooltips so the meaning is discoverable without hovering guesswork. Add clear, concise tooltip text to each icon.
