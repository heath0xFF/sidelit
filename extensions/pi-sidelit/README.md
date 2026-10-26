# Pi ↔ Sidelit

Tested with Pi 1.4.0's official extension API. No package install is needed here;
Pi supplies the extension runtime. The desktop app has no Node runtime/sidecar.

```sh
sidelit setup --pi --skill --dry-run --json
sidelit setup --pi --skill
```

Setup uses embedded resources and preserves custom installations. In Pi run
`/reload`, then `/sidelit-status`. Verify with `sidelit doctor --project . --json`.
Alternatively start `pi -e /absolute/path/to/sidelit/extensions/pi-sidelit/index.ts`.
Run Pi in the project directory; Rex's inherited session/block IDs are advertised
automatically. No Rex extension or terminal input API is used for delivery.

The receiver uses `/tmp/sidelit-pi-<uid>/` with 0700 permissions, a 0600 Unix
socket, and an atomic 0600 registration file. The short path fits macOS socket
limits. Startup/reload registration and shutdown cleanup are awaited. Active
connections are closed on shutdown; stale registrations are ignored by Sidelit.

One bounded UTF-8 JSONL request per connection (32 KiB), three-second idle limit.
`{"op":"ping","id":"..."}` returns `status: ready`, protocol version 1,
PID and busy state without recording a receipt or prompting Pi.
Messages include an ID, project, document, selection, and instruction. The bridge
validates context and project ancestry, persists a receipt with `appendEntry`,
and calls `sendUserMessage(prompt, { deliverAs: 'followUp' })`. Busy sessions use
Pi's follow-up queue. No public port, authentication service, or cloud dependency.

Review batches use `{id, source: "sidelit", projectRoot?, notes: [...]}`. Each note has the existing message shape and keeps its own ID and intent. The receiver validates every note, distinct IDs, one exact project or live-page origin, and a 30 KiB aggregate limit before recording one receipt and calling Pi once. Limits are 1–20 notes; nested batches are rejected. Existing single messages keep the same wire format. Update the installed extension and run `/reload` before using batches; older receivers reject them without sending a prompt.

Acknowledgments:

- `received` + `submitted`/`queued`: the bridge recorded the message and invoked
  Pi's void send API. This is not proof of Pi acceptance.
- `accepted` + `consumed`: Pi emitted `message_start` for that user message.
- `duplicate`: the same ID/content was previously consumed; it is not resent.
- `error`: malformed message, wrong project, reused ID with different content,
  missing receipt, or a session limit. Errors include the request ID when valid.

Sidelit polls `{ "op": "status", "id": "…" }` until consumption. Retries preserve
the original message ID and payload. Receipts survive reload through Pi session
entries, bounded to 2,000 per session. They are not an edit-completion signal.
If Pi discards a follow-up, the receipt remains received; send a new deliberate
instruction instead of retrying the same ID. Ephemeral Pi sessions do not provide
crash-persistent receipts. OS user permissions are the trust boundary; this is
not isolation from other processes already running as the same user.

`pnpm test` exercises the socket with mocked Pi lifecycle hooks.
`scripts/companion-smoke.py` exercises an installed real Pi with a deterministic
offline provider and the real edit tool, alongside packaged WKWebView.
