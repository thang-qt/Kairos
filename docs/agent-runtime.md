# Conversation and agent runtime

Kairos is one Go process, one SQLite database and an embedded React frontend, with no additional services. A small transactional queue in SQLite (stable run IDs, expiring ownership tokens, one active run per conversation) replaces a separate queue service such as River, and reuses the existing modernc driver rather than adding a second persistence stack.

## Domain and storage

`ConversationService` owns the canonical history. Each accepted command persists a user turn and queues an assistant response with one stable `assistantTurnId`. `AgentRuntime` orchestrates provider calls and tools. The assistant turn contains ordered `steps` and content blocks; its ID stays the same during streaming, cancellation, interruption and explicit retry. Provider model rounds are internal execution steps.

`chat_messages` retains completed provider transcripts. `chat_run_steps` checkpoints individual steps. `chat_runs.turn_json` is the visible projection of those checkpoints. The projection and corresponding `chat_events` record commit in the same short transaction. Transactions never span network or tool execution. Historical run/round lineage is projected into the same turn shape; standalone legacy messages remain readable.

Image content supports both legacy `{type: "base64", media_type, data}` sources
and stored `{type: "asset", media_type, assetId}` sources. `chat_assets` records
ownership, storage backend, object key, MIME type, and byte size. New uploads and
imports use `ASSET_STORAGE` (`inline`, `local`, or `s3`); existing references keep
their backend. Object writes finish before message transactions open. Accepted
jobs use the persisted user message and do not duplicate attachment bytes in
`chat_runs.request_json`.

The browser loads stored images through authenticated `/api/assets/{assetId}`
requests. Generation resolves owned asset IDs into base64 image parts before
provider mapping. Ephemeral inputs never grant access to another user's assets.
Edits retain image references, and clones share them. Cleanup runs under the
conversation command mutex after transactions finish and deletes only assets
with no remaining message references. Failed deletions remain available for a
later cleanup attempt. See [image storage configuration](../README.md#image-storage)
for deployment and backup requirements.

## Lifecycle and scheduling

`queued → preparing → running → completed | error | aborted | interrupted`

An accepted command inserts its job in the same transaction as its user turn. Creating a conversation with its first message also inserts the conversation and a user-scoped creation idempotency key in that transaction, so retrying creation cannot create a second conversation. SQLite enforces one active run per conversation. The queue wakes immediately on submission and polls every 100 ms as a fallback. Each process runs at most four executions. Ownership is a random lease token with a 30-second expiry, renewed every 10 seconds. Every checkpoint and completion verifies the token, unexpired lease, current conversation revision and active status.

Cancellation commits `aborted` and clears ownership before requesting context cancellation. Completed runs remain completed. Ordinary sends, edits, deletions and explicit retries advance the conversation revision; streaming checkpoints stay within the accepted revision. Edits and deletions invalidate obsolete runs, truncate the canonical suffix and journal reconciliation atomically. Edit also inserts regeneration and its job in that transaction. Concurrent commands can supply `expectedRevision`; stale commands return HTTP 409. Mutation acknowledgements return the committed revision, authoritative updated user turn and explicit removed/revoked identities, fencing older events already in flight. Backend fencing works even for a provider or tool slow to observe cancellation.

The execution deadline is ten minutes. Graceful shutdown cancels workers and fences their writes, requeues unstarted preparing work, checkpoints started work as `interrupted`, and waits at most five seconds for worker shutdown. HTTP/SSE request streams share the runtime shutdown signal. The daemon stops the runtime before draining HTTP connections. Cancellation controls are fenced by attempt token so an old retry cannot unregister the new attempt. Queued jobs survive shutdown. On restart, queued jobs run; expired preparing claims can be requeued; expired started execution becomes interrupted. A process killed during streaming or tools retains its last committed partial checkpoint. Recovery never automatically repeats uncertain tools or pretends a stream resumed at its previous token.

Automatic provider retries are limited to three attempts, only for timeouts, rate limits or server errors before any observed output and before tools have executed. SDK automatic retries are disabled. Once a provider event or tool effect exists, failure is surfaced rather than replayed. External effects are not exactly once.

Explicit retry of the latest stopped/failed/interrupted response reuses its run and assistant-turn identity, replaces its prior output and steps, and keeps the original user turn. It can repeat tools; the web action says so. A retry command requires its own idempotency key. Older responses and frozen cloned responses cannot be retried; edit the corresponding user turn instead. Snapshots expose `canRetry` so the client can render the supported action. Running assistant turns cannot be cloned.

Throwaway chats intentionally remain stateless and request-bound. They share the same agent loop and canonical turn events, but do not write jobs or history. Aborting their HTTP stream freezes the last received local snapshot; normal persisted conversation outcomes remain backend-authoritative.

## API

The existing session endpoints are retained. Authentication and provider-secret encryption are unchanged.

- `GET /api/sessions/{friendlyId}/history`: `{sessionKey, sessionId, revision, cursor, activeRunIds, messages}`. `messages` contains canonical user and assistant turns. Assistant turns include `id`, `runId`, `status`, `revision`, `content`, `steps`, and optional `error`.
- `POST /api/sessions`: an optional first message is accepted atomically with conversation creation and scheduling. Its `idempotencyKey` is scoped to the user and reuses the original conversation and run.
- `POST /api/sessions/{friendlyId}/messages`: existing message/model/tool options, plus optional `expectedRevision` and `idempotencyKey`. Returns `{runId, sessionKey, revision, userTurnId, assistantTurnId, userTurn, clientId}` immediately after durable acceptance. Edit/delete acknowledgements additionally carry `invalidatedRunIds` and `removedTurnIds` computed by the backend. Matching idempotency keys reuse the accepted command.
- `POST /api/sessions/{friendlyId}/messages/{messageId}/edit`: the same options and optional revision/idempotency key; atomic edit and regeneration.
- `DELETE /api/sessions/{friendlyId}/messages/{messageId}?revision=N`: truncate from a user turn with an optional revision check.
- `POST /api/sessions/{friendlyId}/stop`: `{runId}` targets one queued or active run; delayed requests cannot cancel a different later run. Session-wide cancellation remains a separate internal bulk operation.
- `POST /api/sessions/{friendlyId}/runs/{runId}/retry`: `{idempotencyKey, expectedRevision?}`; explicit replacement of the latest failed/stopped response.
- `GET /api/sessions/{friendlyId}/events`: SSE with an initial authoritative `snapshot`, then ordered durable events. After the snapshot is delivered, replay starts at least at its cursor, so historical events superseded by that snapshot are not transmitted. Events include `cursor`, `sessionKey`, `revision`, `turnId`, `runId`, `state`, and either a full replacement `message` or compact `turnPatch` operations (`set`, `remove`, and string-suffix `append`). States are `user`, `delta`, `final`, `aborted`, `error`, `reconcile`, `title`, or transient `heartbeat`.

SSE flushes immediately, disables proxy buffering and sends heartbeats every 15 seconds. Checkpoints batch token updates at 100-ms intervals; first progress and tool boundaries are immediate. The initial snapshot and final turn establish complete state; compact updates avoid repeatedly storing unchanged text and tool outputs. A snapshot includes its durable cursor; the web client rejects older cursors and revisions. Accepted user turns are journaled so every connected client sees them, including before assistant text arrives.

## Providers and deployment

`openai` is the default provider kind and uses Chat Completions. Compatible endpoints use a configurable base URL. The provider's `useResponsesApi` toggle explicitly selects Responses; it is never inferred from a URL. System providers use `SYSTEM_PROVIDER_1_USE_RESPONSES_API=true`. Existing `openai-responses` configurations remain compatible, and stored user providers migrate to the toggle. Responses normalizes text, function calls/results, available reasoning summaries, usage and errors into the same agent contracts. No provider SDK types cross into conversation/HTTP contracts.

Migration 0020 adds revisions, leases, jobs, checkpoints and the event journal without deleting existing conversations. Pre-refactor active runs become interrupted. Migration 0022 adds creation-command idempotency. Migration 0021 converts saved OpenRouter providers to `openai` while preserving base URLs, encrypted credentials and provider IDs. Legacy system `openrouter` configuration is normalized to its original endpoint. New environment and Nix defaults use `openai`.

Build the frontend with `pnpm build` before building Go; Go embeds `internal/server/static`. Back up the SQLite database using SQLite's backup facilities before upgrading. Startup applies migrations automatically. An older binary cannot understand the new runtime or changed turn response fields, so deploy backend and bundled frontend together.

Timing logs identify acceptance, worker claim/queue delay, model resolution, provider request, first provider event, first text from acceptance, tool duration and completion. Inspect queue delay separately from provider latency. Explicit model resolution uses cached/configured metadata instead of synchronously listing models on every generation.

## Testing and limits

Tests use deterministic providers and tools, local HTTP protocol servers, expired persisted leases and real child processes killed without graceful shutdown, so no hosted provider account is needed. Run `pnpm check`, `pnpm backend:check`, `pnpm build`, and `go test -race ./internal/server`.

The event journal currently has no automatic retention policy and can grow during long conversations. Snapshots stay complete, while compact journal updates avoid quadratic growth from repeatedly storing accumulated output. Operators should monitor database size; no unrequested history deletion occurs. Current tools do not offer external transactional idempotency; explicit retries can repeat prior side effects.

Optional AI title generation remains a best-effort task. Title writes are revision-fenced and commit their metadata event atomically; losing only that optional title request on process termination does not affect the durable assistant run.
