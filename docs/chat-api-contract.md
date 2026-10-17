# Chat API contract for clients

The Go backend owns model selection, generation configuration, validation, permissions, execution, and durable conversation state. A client renders backend state, submits user intent, and maintains temporary drafts and optimistic UI. The same authenticated API serves web and future native clients. No TypeScript package is required to implement the protocol.

## Minimal persisted conversation

1. `POST /api/sessions` with `{}` creates an empty conversation. The response includes `friendlyId`, `sessionKey`, `revision`, and canonical `settings`.
2. `POST /api/sessions/{friendlyId}/messages` with `{"message":"Hello","idempotencyKey":"<unique command key>","expectedRevision":0}` accepts a turn. Generation settings can all be omitted.
3. Subscribe to `GET /api/sessions/{friendlyId}/events` to render the canonical assistant turn. Acceptance means durable queueing, not successful generation.

`POST /api/sessions` can also include `message`, attachments, and an idempotency key to create and start a conversation atomically. `GET /api/sessions/{friendlyId}` returns conversation metadata and settings; `GET /api/sessions/{friendlyId}/history` returns complete canonical history. Authentication and ownership checks apply to every endpoint.

## Generation configuration

For existing conversations, omitted request fields inherit the conversation's settings. For new conversations and ephemeral generation, the backend starts from the user's default chat settings and applies the selected model's saved preset when one exists. `GET /api/me/chat-settings` returns `{settings: {defaultSettings, modelOverrides}}`; clients should use this for settings controls instead of maintaining domain defaults independently.

Requests may contain a `settings` object representing a user's draft. On a normal send, edit, or ephemeral request, this replaces the settings base for that command only; it does not update the saved conversation. This allows an interaction to submit its latest draft without racing a settings save. On creation, `settings` is persisted as the new conversation's settings. Supplied settings objects are replacements over built-in defaults, not patches over previous settings.

Top-level request overrides take precedence over either saved settings or a settings draft:

| Field                    | Omitted                                                          | Explicit value                                                                                       |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `model`                  | Use the settings model, then backend model fallback if necessary | Nonempty: resolve this target; empty string: select automatically from account/server model defaults |
| `systemPrompt`           | Use the settings prompt                                          | Empty string clears the user prompt; surrounding whitespace is trimmed                               |
| `webSearch`, `mathTools` | Use the settings flags                                           | `false` disables; `true` enables the configured built-in tools                                       |
| `advanced`               | Build options from settings, with model capability normalization | Object replaces all advanced options; `{}` disables all explicit advanced controls                   |

Legacy `advanced: null` also disables explicit advanced controls. Scalar overrides must not be null. Within a raw `advanced` object, absent or null groups leave that group at the provider default. A disabled reasoning control means no reasoning option is sent; `reasoning: {effort: "none"}` is a separate explicit request and must be supported by the model.

Model selection is implemented in Go. Automatic selection uses the account's default model, server default, then available models; an unavailable automatic default falls back to an available model. An unavailable inherited conversation model can fall back automatically. An unavailable explicit target fails. Canonical model references include the provider reference (`system:<provider-id>:<model-id>` or `user:<provider-id>:<model-id>`); clients should retain these references to disambiguate providers. Bare IDs and custom model IDs on a selected/single provider remain supported for compatibility. Model discovery is not an exhaustive allowlist for custom compatible endpoints. Presets can be saved before any provider is configured, but HTTP generation requires a resolvable target.

### Settings normalization and raw overrides

`PATCH /api/sessions/{friendlyId}/settings` accepts `{settings: ...}` and returns the normalized saved settings. The same Go normalization path is used for creation, user default settings, and model presets. Missing fields in a supplied settings object receive built-in defaults. Malformed field types, null settings members, and unknown request fields are rejected. Numeric settings are clamped, and integer controls are floored, matching historical web settings behavior:

| Setting                                                 | Default       | Canonical range                                                          |
| ------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `model`, `systemPrompt`                                 | Empty strings | Trimmed strings                                                          |
| `webSearch`, `mathTools`                                | `true`        | Boolean                                                                  |
| `advanced.reasoning`                                    | `false`       | Boolean                                                                  |
| `advanced.reasoningEffort`                              | `medium`      | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`               |
| `advanced.sampling`                                     | `false`       | Boolean                                                                  |
| `advanced.temperature`                                  | `0.7`         | 0–2                                                                      |
| `advanced.topP`                                         | `1`           | 0–1                                                                      |
| `advanced.topK`                                         | `0`           | Integer 0–1000                                                           |
| `advanced.penalties`                                    | `false`       | Boolean                                                                  |
| `advanced.frequencyPenalty`, `advanced.presencePenalty` | `0`           | −2–2                                                                     |
| `advanced.maxTokens`                                    | `false`       | Boolean                                                                  |
| `advanced.maxTokensValue`                               | `4096`        | Integer 1–200000, limited further by authoritative model output metadata |

Unknown saved reasoning efforts normalize to `medium`. Model-specific settings select a supported effort (requested, then `medium`, then `low`, then the first supported effort), or omit reasoning when effort control is unavailable. Explicit raw `advanced` overrides are validated rather than clamped: out-of-range numbers and unsupported reasoning efforts fail with HTTP 400 before a run is accepted. Provider-matched model metadata also enforces advertised output-token limits and temperature support; fallback catalog matches do not establish hard numeric limits. Derived settings omit unsupported temperature. Neither supported OpenAI protocol transmits `topK`; Responses also omits penalties. These preferences remain saved, while effective options reflect the protocol actually used.

Legacy saved settings are decoded over defaults, tolerate unknown historical fields, and receive numeric normalization when read. No migration rewrites old conversations. Valid saved preferences retain their meaning. Model availability and capabilities are rechecked at execution; a provider removed after acceptance can cause an accepted run to fail rather than switch to a different target.

### Accepted configuration and retries

Send/create/edit acknowledgements include `effectiveConfiguration`:

```json
{
  "model": "user:provider-id:model-id",
  "systemPrompt": "Be concise",
  "webSearch": false,
  "mathTools": true,
  "advanced": null
}
```

The same object is included on the canonical assistant turn in history, snapshots, and stream updates, and on ephemeral turns after configuration resolution. `advanced` is null when no explicit options are selected; nested option fields may be null. The prompt here is the normalized user prompt; the backend also adds its runtime identity/time context before provider execution.

The accepted configuration is stored with the run. Changing preferences or conversation settings affects later commands, not that run. Idempotent command replay returns the original accepted configuration. Explicit retry reuses the original captured request, model, and options; it does not resolve current conversation defaults again. Historical runs accepted before this field existed can omit it. A legacy request with an empty model retains deferred selection and can resolve current account model defaults on retry; newly accepted HTTP commands always capture a resolved model. Internal legacy queue callers retain their historical deferred provider-resolution errors; HTTP clients receive configuration errors before acceptance.

An edit starts a new run using current saved settings or supplied overrides. A retry replaces the same visible assistant turn using its original request. Retry can repeat external tool effects and always requires a new idempotency key for a new retry attempt.

## Commands, revisions, and permissions

- Every persisted conversation has a backend revision. Send/edit/delete/retry commands can supply `expectedRevision` (delete uses `?revision=N`). A stale revision or conflicting active run returns HTTP 409. Reload backend state before issuing a new command.
- Use a unique `idempotencyKey` per logical send/create. Reuse the exact key and payload when retrying an uncertain network response. A key identifies an accepted command; submitting different content with that key does not replace it. Creation keys are scoped to the user; send keys are scoped to the user and conversation. Idempotent replay is checked before current revision validation.
- A successful send returns HTTP 200; creation returns HTTP 201. Acknowledgements carry `revision`, `runId`, `sessionKey`, `friendlyId`, `userTurnId`, `assistantTurnId`, and optionally `userTurn`, `clientId`, `effectiveConfiguration`, and command changes. Edit/delete responses can contain `invalidatedRunIds` and `removedTurnIds`; use these instead of guessing which turns survive.
- Active run statuses are `queued`, `preparing`, and `running`. Terminal statuses include `completed`, `error`, `aborted`, and `interrupted`. Use backend `activeRunIds` and turn status for reconciliation. Never resume an interrupted tool execution automatically.
- `POST /api/sessions/{friendlyId}/stop` with `{runId}` targets that run only. A delayed stop cannot stop a newer run.
- `POST /api/sessions/{friendlyId}/runs/{runId}/retry` accepts `{idempotencyKey, expectedRevision?}`. Render retry controls from backend `canRetry`. The backend independently checks eligibility, source-turn existence, and whether a newer turn prevents replacement.
- Unknown request fields and malformed JSON are rejected. Invalid configuration returns HTTP 400; missing conversations return HTTP 404. Accepted generation failures arrive through canonical run state and the event stream.

## Event stream and recovery

`GET /api/sessions/{friendlyId}/events` first emits a `reconcile` event with an authoritative `snapshot`. The snapshot contains `messages`, `revision`, `cursor`, `activeRunIds`, and `pendingMcpApprovals`. Replace the corresponding client projection with it. The snapshot state and cursor come from a consistent database transaction; subscribers register before loading it so concurrent commits cannot be missed.

Subsequent durable events are ordered by `cursor`. Event states include `user`, `delta`, `final`, `error`, `aborted`, `reconcile`, `title`, and `mcp-approval`. An event can carry a complete replacement `message` (one canonical turn), a `turnPatch`, or product-specific state. Apply patches only to the identified `turnId`:

- `set`: set the value at a string-segment `path`.
- `append`: append a string suffix at the path.
- `remove`: remove the value at the path.

Discard events older than the current revision and events whose cursor has already been applied. On an unknown patch target, reconnect or fetch authoritative history instead of inventing a turn. A higher revision can invalidate existing projections; use command changes and reconcile from the server. Event IDs support reconnects, but every connection receives a current snapshot: clients must not depend on retaining the complete historical event log. Older-revision events are pruned by the backend. `heartbeat` is transient and does not change domain state.

A client can optimistically show a pending user turn and local busy indicators, then reconcile using `clientId`, returned turn IDs, revisions, and authoritative events. Optimistic state never grants execution permission.

## MCP approvals

Approvals are backend-owned. A `mcp-approval` stream event carries `mcpApproval` with an ID, run ID, server/tool names, exact arguments, state, and expiration. Only `pending` requires a prompt. Other states remove that prompt. Reconnect snapshots restore pending approvals; clients do not poll to discover them.

Submit `POST /api/mcp/approvals/{approvalId}` with `decision: "approved"` or `"denied"`. Approval scopes are `once` (default), `chat`, and `tool` (always allow this tool across chats). Denial uses `once`. The backend validates ownership, run lease/revision, expiry, enabled tool/server state, exact schema, and server configuration. Grants are bound to the tool schema and server revision and are rechecked before execution. The decision and durable stream event commit together. Matching pending calls can resolve after a new grant; automatically allowed calls execute without an approval browser round trip.

## Message phases and ephemeral conversations

Text parts can contain `phase: "commentary" | "final_answer"` and `phaseSource: "provider" | "derived"`. Prefer these explicit fields. The backend derives final phases at successful round completion. Until then, an unphased provider stream cannot be classified reliably because a later tool call can change its role. Clients may keep a provisional presentation for that text and compatibility heuristics for old unphased history; those heuristics must not affect execution or persisted content. See [message phases](message-phases.md).

`POST /api/ephemeral/messages` accepts `history`, `message`, optional `settings`, and the same generation overrides. The client intentionally owns this throwaway history. Go runs the complete shared agent/tool loop and streams canonical events without creating conversation/run/message records. Android sends its local history; it does not implement provider execution, tool orchestration, or approval rules. Remote MCP tools are unavailable for these stateless chats because they cannot host durable approvals. See [runtime architecture](agent-runtime.md).

## Export

Fetch complete authoritative history before formatting an export. A client cache can contain partial streaming content, unloaded turns, or optimistic items and is not an export source of truth. The web single and bulk exporters both fetch server history; formatting and file download remain presentation responsibilities. An export during generation represents the committed snapshot at fetch time, not future output. Ephemeral history is the explicit client-owned exception.
