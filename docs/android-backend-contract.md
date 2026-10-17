# Android chat contract: backend-authoritative configuration

The Go backend owns model selection, generation configuration, validation, permissions,
execution, and durable conversation state (see `docs/chat-api-contract.md`). Android sends
**user intent**; it never reimplements model-selection or generation-option policy.

## The omission rule

Request bodies distinguish *omitted* from *explicitly supplied* fields. An omitted
generation field inherits the backend's authoritative settings; an explicit value overrides
them. This makes blind zero values destructive: sending `webSearch: false` disables web
search even when the conversation enables it, and sending `systemPrompt: ""` clears the
user prompt. Android therefore omits every generation field it does not genuinely override.

Kotlin serialization omits null properties (`explicitNulls = false`), so nullable DTO fields
are the omission mechanism. `SendRequest` and `EphemeralRequest` do not even carry
`model`/`systemPrompt`/`webSearch`/`mathTools`/`advanced` — a regression that re-introduces
zero-value overrides cannot compile. The tests in `RequestContractTest` assert the exact
serialized key sets, not just Kotlin object values.

## Commands

- `POST /api/sessions` (with `message` and an idempotency key) creates and starts a
  conversation atomically. Include `settings` with the user's draft — the backend persists it
  as the new conversation's settings. A missing `settings` inherits the account's default
  chat settings plus the selected model's saved preset.
- `POST /api/sessions/{friendlyId}/messages` sends a turn into an existing conversation.
  Omit `settings` and all generation fields; the backend reads its own saved settings.
- `POST /api/sessions/{friendlyId}/messages/{messageId}/edit` edits a user turn. Same
  minimal body: the backend starts the new run from current saved settings or supplied
  overrides.
- `POST /api/ephemeral/messages` streams a throwaway answer. Send the fully resolved
  `settings` draft (user defaults + model preset + the picked model, as the web resolves
  client-side) — a supplied settings object replaces the backend base for that command only.
- `PATCH /api/sessions/{friendlyId}/settings` persists a settings draft for a conversation.
  It is used for existing conversations; for a new chat Android updates its local draft and
  sends it with the first command instead.

All commands carry `clientId`, a stable `idempotencyKey` for the logical send,
`expectedRevision` for existing sessions, and `clientTime`/`clientTimeZone`.

## Consuming backend state

- Session summaries (`GET /api/sessions/{friendlyId}`, the paged list, and mutation
  responses) carry normalized `settings`. Render them; do not maintain local defaults
  beyond the initial draft.
- Send/create/edit acknowledgements and canonical assistant turns include
  `effectiveConfiguration` — the frozen model, prompt, tool flags, and normalized advanced
  options actually used. Display it when available instead of re-deriving options.
- Model references are canonical (`system:<provider-id>:<model-id>` or
  `user:<provider-id>:<model-id>`). Keep them verbatim; resolve display names through the
  model catalog.

## Commands, revisions, idempotency

- Treat a timeout or 5xx as an ambiguous acceptance. Reuse the same key when replaying the
  *same* command (`PendingSendStore` journals only a payload digest and the key); reconcile
  server history first. A definitive 4xx cannot be replayed as the same command.
- Command results return `revision`, `runId`, `invalidatedRunIds`, and `removedTurnIds`.
  Apply them before subsequent event patches.
- The conversation SSE connection provides canonical snapshots and event cursors. Reject
  stale revisions/cursors, refetch on a missing patch base, and reconnect using
  `Last-Event-ID`.
- Retry eligibility, run state, MCP approvals, and tool execution remain backend-enforced.
  Clients must not infer eligibility from local timers or tool names.

## Ephemeral chats

Ephemeral history is client-owned. Remote MCP tools are unavailable for these stateless
chats because they cannot host durable approvals. The assistant overlay uses the same
persisted command endpoints as the full Android app.
