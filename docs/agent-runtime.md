# Conversation and agent runtime

Kairos remains one Go process, one SQLite database and an embedded React frontend. There are no new services or environment variables.

## Domain and storage

`ConversationService` owns the canonical history. Each accepted command persists a user turn and queues an assistant response with one stable `assistantTurnId`. `AgentRuntime` orchestrates provider calls and tools. The assistant turn contains ordered `steps` and content blocks; its ID stays the same during streaming, cancellation, interruption and explicit retry. Provider model rounds are internal execution steps.

`chat_messages` retains completed provider transcripts. `chat_run_steps` checkpoints individual steps. `chat_runs.turn_json` is the visible projection of those checkpoints. The projection and corresponding `chat_events` record commit in the same short transaction. Transactions never span network or tool execution. Historical run/round lineage is projected into the same turn shape; standalone legacy messages remain readable.

## Lifecycle and scheduling

`queued → preparing → running → completed | error | aborted | interrupted`

An accepted command inserts its job in the same transaction as its user turn. Creating a conversation with its first message also inserts the conversation and a user-scoped creation idempotency key in that transaction, so retrying creation cannot create a second conversation. SQLite enforces one active run per conversation. The queue wakes immediately on submission and polls every 100 ms as a fallback. Each process runs at most four executions. Ownership is a random lease token with a 30-second expiry, renewed every 10 seconds. Every checkpoint and completion verifies the token, unexpired lease, current conversation revision and active status.

Cancellation commits `aborted` and clears ownership before requesting context cancellation. Completed runs remain completed. Edits and deletions increment the conversation revision, invalidate obsolete runs, truncate the canonical suffix and journal reconciliation atomically. Edit also inserts regeneration and its job in that transaction. Concurrent commands can supply `expectedRevision`; stale commands return HTTP 409. Mutation acknowledgements return the committed revision, authoritative updated user turn and explicit removed/revoked identities, fencing older events already in flight. Backend fencing works even for a provider or tool slow to observe cancellation.

The execution deadline is ten minutes. Graceful shutdown cancels workers and fences their writes, checkpoints `interrupted`, and waits at most five seconds for worker shutdown. HTTP/SSE request streams share the runtime shutdown signal. The daemon stops the runtime before draining HTTP connections. Cancellation controls are fenced by attempt token so an old retry cannot unregister the new attempt. Queued jobs survive shutdown. On restart, queued jobs run; expired active leases become interrupted. A process killed during streaming or tools retains its last committed partial checkpoint. Recovery never automatically repeats uncertain tools or pretends a stream resumed at its previous token.

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
- `POST /api/sessions/{friendlyId}/stop`: terminal cancellation of active or queued work.
- `POST /api/sessions/{friendlyId}/runs/{runId}/retry`: `{idempotencyKey, expectedRevision?}`; explicit replacement of the latest failed/stopped response.
- `GET /api/sessions/{friendlyId}/events`: SSE with an initial authoritative `snapshot`, then ordered durable events. `Last-Event-ID` resumes the journal. Events include `cursor`, `sessionKey`, `revision`, `turnId`, `runId`, `state`, and a full replacement `message`. States are `user`, `delta`, `final`, `aborted`, `error`, `reconcile`, `title`, or transient `heartbeat`.

SSE flushes immediately, disables proxy buffering and sends heartbeats every 15 seconds. Checkpoints batch token updates at 50-ms intervals; first progress and tool boundaries are immediate. Full turn replacements make replay idempotent. A snapshot includes its durable cursor; the web client rejects older cursors and revisions. Accepted user turns are journaled so every connected client sees them, including before assistant text arrives.

## Providers and deployment

`openai` is the default provider kind and uses Chat Completions. Compatible endpoints use a configurable base URL. `openai-responses` explicitly selects Responses; it is never inferred from a URL. Responses normalizes text, function calls/results, available reasoning summaries, usage and errors into the same agent contracts. No provider SDK types cross into conversation/HTTP contracts.

Migration 0020 adds revisions, leases, jobs, checkpoints and the event journal without deleting existing conversations. Pre-refactor active runs become interrupted. Migration 0022 adds creation-command idempotency. Migration 0021 converts saved OpenRouter providers to `openai` while preserving base URLs, encrypted credentials and provider IDs. Legacy system `openrouter` configuration is normalized to its original endpoint. New environment and Nix defaults use `openai`. The Go vendor hash is updated after dependency removal; its NAR calculation was validated by reproducing the previous locked vendor hash. The dedicated OpenRouter SDK/adapter, Hermes observer and in-memory replay broker are removed.

Build the frontend with `pnpm build` before building Go; Go embeds `internal/server/static`. Back up the SQLite database using SQLite's backup facilities before upgrading. Startup applies migrations automatically. An older binary cannot understand the new runtime or changed turn response fields, so deploy backend and bundled frontend together.

Timing logs identify acceptance, worker claim/queue delay, model resolution, provider request, first provider event, first text from acceptance, tool duration and completion. Inspect queue delay separately from provider latency. Explicit model resolution uses cached/configured metadata instead of synchronously listing models on every generation.

## Validation and practical limits

Tests use deterministic providers/tools, local HTTP protocol servers, expired persisted leases and real child processes terminated without graceful shutdown. Coverage includes atomic edits/deletes, cancelled tool arguments and tool execution, stale ownership, idempotency, explicit and bounded retries, snapshot/replay, stopped-turn clones, delayed reasoning, legacy migration, and queued/model/tool crash boundaries. Run `pnpm check`, `pnpm backend:check`, `pnpm build`, and `go test -race ./internal/server`.

The event journal currently has no automatic retention policy and can grow during long conversations. Full snapshot checkpoints favor simple replay over storage efficiency. Operators should monitor database size; no unrequested history deletion occurs. Current tools do not offer external transactional idempotency; explicit retries can repeat prior side effects. Live hosted provider accounts are not required by the deterministic test suite. A complete Nix build was unavailable in the implementation environment; the vendor hash and single-binary Go build were validated independently.

Optional AI title generation remains a best-effort task. Title writes are revision-fenced and commit their metadata event atomically; losing only that optional title request on process termination does not affect the durable assistant run.
