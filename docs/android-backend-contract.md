# Android chat contract: backend-owned effective settings

For persisted chats, mobile clients should send **user intent**, not reimplement web
model-selection and generation-option policy.

## Sending and editing

Use the existing command endpoints:

- `POST /api/sessions` for creation with `settings` (if this is a new chat).
- `POST /api/sessions/{friendlyId}/messages` for a new turn.
- `POST /api/sessions/{friendlyId}/messages/{messageId}/edit` for an edited user turn.

Include `useConversationSettings: true` in these requests. When enabled, the
backend loads the conversation's persisted settings (or the creation request's
`settings`), normalizes them, and uses those values for model, system prompt,
web search, math tools, and advanced generation options. Supplied per-turn
values are ignored in this mode. This is **opt-in**: existing web clients that
omit the flag retain their explicit per-turn settings behavior.

The server enforces numeric ranges when settings are stored and at generation
time: temperature 0–2, top-p 0–1, top-k 0–1000 (integer), penalties -2–2,
max tokens 1–200000 (integer). Unsupported reasoning effort strings normalize
to `medium`; enabled efforts still undergo provider/model capability checks
before generation.

A client may render local form defaults, but should replace them with the
`settings` returned by session mutation/lookup responses.

## Conversation state and mutation

- Include `clientId`, a stable `idempotencyKey` for a logical send, and
  `expectedRevision` when operating on an existing session.
- Treat a timeout or 5xx as an ambiguous acceptance. Reuse the same key when
  replaying *the same* command; reconcile server history first.
- Command results return revision and invalidated/removed turn identifiers.
  Apply those before subsequent event patches.
- The conversation SSE connection provides canonical snapshots and event
  cursors. Reject stale revisions/cursors, refetch on a missing patch base, and
  reconnect using `Last-Event-ID`.
- Retry eligibility, run state, MCP approval status and tool execution remain
  backend-enforced. Clients must not infer eligibility from local timers.

## Exceptions

Ephemeral chats use `POST /api/ephemeral/messages` with in-memory history and
explicit request options. This is intentionally not a persisted conversation
and requires client-local history ownership. The assistant overlay uses the
same saved-conversation command endpoints as the full Android app.

## Compatibility

Go, React and Kotlin share the JSON wire protocol, but only Go is authoritative
for persisted behavior. The new opt-in does not alter existing web callers.
