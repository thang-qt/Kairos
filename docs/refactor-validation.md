# Refactor validation

The integrated refactor passed:

- `pnpm check`: formatting, lint, TypeScript and 63 frontend tests across 16 files.
- `pnpm backend:check`: Go formatting, `go vet ./...` and the complete backend suite.
- `pnpm build`: production frontend and service-worker assets.
- `go test -race -timeout 180s ./internal/server`: the complete backend suite, including real process-crash tests (the complete final runtime suite).
- `go build -o /tmp/kairosd-final ./cmd/kairosd`: standalone binary with the rebuilt frontend embedded.

The instrumentation was also checked with a measured deterministic tool-loop test: the local fake-provider run produced its first text in 3 ms from acceptance and completed two tool rounds in 6 ms. These measure local queue/checkpoint overhead, not hosted-model latency. The runtime and protocol regression suites are also checked under the race detector after those additions.

Deterministic regression coverage verifies one canonical turn through multiple tool rounds; cancellation during text, arguments and tools; revision fencing for edit/delete; concurrent edit conflicts; stable retry identity; idempotent send and first-conversation creation; atomic rollback; expired/duplicate ownership; safe bounded timeout retries; no automatic retry after a tool effect; durable snapshot/event replay; delayed provider reasoning summaries; stopped-turn cloning and throwaway cancellation; and migration of historical messages and encrypted provider configuration.

Actual subprocess tests exit without graceful shutdown at three boundaries: queued work, a partial model stream, and immediately after an external tool effect. Queued work recovers; uncertain execution is interrupted with its checkpoint retained. No external effect is automatically repeated.

Both Chat Completions and Responses are exercised against local HTTP servers, including truncated streams that must fail. Completed tool results checkpoint individually before later tools run. The built binary also passed an authenticated HTTP smoke test against a local provider: signup/cookies, embedded frontend serving, real streaming, idempotent creation, canonical history, SSE snapshots and graceful shutdown. A full browser deployment was not used. The hosted Responses runtime check below adds coverage for one live provider/model. React rendering, client contracts/reducers, HTTP integration, the production asset build and embedded-binary tests cover the web integration.

Nix was unavailable. The replacement Go vendor hash was computed from the new vendor tree, and the same NAR hashing method exactly reproduced the previous vendor hash from the baseline source. The frontend dependency lockfile and its Nix hash are unchanged.

The workspace originally exposed an unrelated `/usr/bin/go`, so checks used Go 1.24.13 installed under `/tmp/go`. Temporary pnpm storage and runtime flags were needed for this environment; they introduce no application configuration requirements.

## Hosted Responses runtime validation

The standalone `/tmp/kairosd-final` binary was exercised through authenticated Kairos HTTP APIs against `https://hyper.charm.land/v1/responses`, using the explicit `openai-responses` provider kind and `deepseek-v4.1-flash`. The temporary provider key was supplied only to the test process; it was not committed.

The live check passed:

- Idempotent first-conversation submission returned the same conversation and run IDs without duplicate user/assistant turns.
- Hosted streamed text and reasoning were normalized into the canonical completed assistant turn. The conversation SSE delivered its initial snapshot and journal events with ordered, unique cursors.
- The model called `math_eval` for `12345*6789`; Kairos executed the tool and sent its result into the next hosted model round. The resulting answer was 83,810,205. The model call, tool result and final model response appeared as three ordered steps in one assistant turn.
- Cancellation produced an aborted turn. Explicit retry retained the run and assistant turn identities, and repeating the retry command was idempotent. The retried run was canceled again rather than completing the requested long essay.
- After stopping and restarting the real service with the same SQLite database, history and its cursor were unchanged, and a new SSE connection returned the persisted snapshot.

These checks exercise the runtime and provider integration through the built application, rather than merely sending a direct provider request. They do not add hosted coverage for every provider, force a process crash, or replace the deterministic fencing and crash-recovery tests above.

## Multi-model and Chat Completions validation

A subsequent authenticated runtime matrix used the same hosted Hyper base URL, with four models listed by its `/models` endpoint. Every model was exercised with both `openai-responses` (Responses) and `openai` (Chat Completions), using explicit low reasoning effort and bounded output sizes.

| Model                 | Responses | Chat Completions | Thinking in basic turn |
| --------------------- | --------- | ---------------- | ---------------------- |
| `deepseek-v4.1-flash` | Pass      | Pass             | Both protocols         |
| `qwen3.8-flash`       | Pass      | Pass             | Both protocols         |
| `glm-5.3-flash`       | Pass      | Pass             | Both protocols         |
| `gpt-oss-120b`        | Pass      | Pass             | Both protocols         |

All eight model/protocol combinations passed idempotent first-conversation creation, basic arithmetic, SSE snapshot/history agreement, context recall in a subsequent turn, two sequential `math_eval` tool rounds, editing the initial user message to truncate later turns, and HTTP 409 rejection for a stale conversation revision. Each two-tool scenario retained five ordered steps (three model calls and two tool results) inside a single assistant turn, and returned 3,349,087 for `2468*1357 + 11`.

Thinking is present in the canonical turn's `content` as `{type: "thinking", thinking: "..."}`, and is preserved in snapshots. All four models supplied it in the basic arithmetic scenario over both protocols. GLM supplied no thinking in its tool scenario, despite completing both tool rounds successfully; availability depends on what the provider emits. Chat Completions normalizes `reasoning_content` or `reasoning`; Responses normalizes reasoning-summary deltas. This exposes provider-supplied reasoning text, not reasoning the provider does not send.

The frontend renders these parts through the existing Thinking component when `showReasoningBlocks` is enabled (the default). Its default collapse mode is `expanded-while-thinking`: open during streaming, collapsed afterward, with manual expansion available. This was confirmed by inspecting the component and preference defaults; this hosted validation did not run an interactive browser.

Additional lifecycle checks with `deepseek-v4.1-flash` passed through both protocols:

- A live SSE `delta` carried nonempty thinking while the run was still in progress, before its final event.
- Disconnecting the SSE subscriber left generation running. Reconnecting with `Last-Event-ID` delivered the current snapshot and ordered, unique journal events after that cursor, through the run's final event.
- Editing a user message after the old run emitted content invalidated that run, removed its assistant turn, and completed the replacement without resurrecting the removed turn.
- Canceling after observed streamed content produced an aborted turn. Explicit retry completed successfully under the same run ID and assistant turn ID, without duplicating the turn.
- Graceful service restart retained canonical conversation messages in SQLite.

An unknown-model probe revealed a hosted protocol difference: Hyper Responses accepted `nonexistent-model` and completed with reported model `deepseek-v4.1-flash`; Hyper Chat Completions rejected the same ID with HTTP 404 (`model not found`). Kairos persisted the latter failure as an error turn. Kairos intentionally permits uncatalogued model IDs when a single provider is configured and resolves them in its worker, so callers must inspect the returned model rather than assume the Responses endpoint validates the requested ID. The initial test expected a synchronous rejection; that expectation was corrected after inspecting the runtime's asynchronous resolution and observing the actual terminal outcomes.

The matrix and lifecycle checks used isolated temporary SQLite databases and authenticated application API requests against the built binary. No runtime source changes were required, and the temporary key file was removed afterward.

## models.dev sync validation

The catalog-enrichment change passed `pnpm check` (63 tests), `pnpm backend:check`, the catalog regression tests under `go test -race`, the production frontend build, and a rebuilt standalone Go binary. Focused tests cover endpoint-specific pricing/limits, explicit canonical IDs, ambiguous collisions, unmatched dated/context variants, provider/custom metadata precedence, user overrides, SQLite catalog recovery, refresh TTL, invalid catalog rejection, and stale-catalog retention/backoff during an HTTP outage.

The rebuilt binary then passed authenticated live `/api/models/sync` checks against Hyper and the public models.dev catalog. Hyper returned 21 models; all 21 matched the Hyper catalog provider. Samples included DeepSeek V4.1 Flash, Qwen3.8 Flash, GLM 5.3 Flash and GPT OSS 120B, with catalog names, context/output limits, reasoning/tool capabilities and pricing retained in `catalogMetadata`. A manual DeepSeek name/context override survived another sync and a real service restart. A hosted Responses chat completed afterward with that overridden display name while retaining the original provider model ID. The temporary provider key file was removed.

See [Synced model metadata](models-dev.md) for matching, precedence and catalog cache behavior. Catalog metadata is descriptive and does not automatically alter generation options.

## Runtime review and control validation

The six pasted review findings were addressed together with the requested UI and provider controls. The final change passed `pnpm check` (70 tests across 18 files), `pnpm backend:check`, the full backend race suite (128.824 seconds), focused race tests for the final provider-toggle adjustment, `pnpm build`, and a rebuilt standalone binary.

Regression coverage verifies ordinary append revisions reject another client's stale edit/delete without truncating newer turns; idempotent sends retain their revision; a snapshot skips 1,000 superseded journal records; a delayed Stop for an older run cannot abort the newer run; Responses HTTP 429/500/503 failures receive bounded retries and HTTP 400 does not; and shutdown paused after claim but before registration leaves work queued and recoverable. The running state now begins immediately before the provider call, rather than merely when model resolution succeeds.

Streaming journals use compact path operations with appended string suffixes. A stress test generated 500 checkpoints with 60 KB of text plus a 256 KiB tool output: journal payloads totaled 918,229 bytes, the final snapshot was 382,597 bytes, and SQLite occupied 1,994,752 bytes. Measured p95 checkpoint write time was 39.8 ms in this environment. This is a burst test of storage/checkpoint overhead, not hosted provider latency. SSE patches are tested against cursor duplication and reconstructed turns; snapshots remain authoritative. Token checkpoint frequency is bounded to ten per second, with immediate first progress and tool boundaries.

The frontend hides routine lifecycle labels, retains actionable stopped/error states, and restores an expandable work summary that collapses after completion with the persisted tool duration. Responses is an editable toggle on an existing OpenAI-compatible provider; it preserves the provider identity, encrypted secret and custom model configuration. Migration 0024 converts existing Responses-kind providers to that toggle; legacy system configuration remains compatible.

Reasoning controls use the selected model's catalog effort levels instead of hardcoded low/medium/high. Both adapters preserve none/minimal/low/medium/high/xhigh/max on the wire. Exact endpoint metadata rejects unsupported explicit levels before a provider request. The UI distinguishes leaving effort unset (provider default) from explicitly selecting `none` when offered. It does not present an effort override for models that only advertise provider-specific toggles or token budgets.

Authenticated live Hyper checks through the rebuilt binary switched one user provider between Chat Completions and Responses. Both protocols accepted DeepSeek V4.1 Flash low/xhigh and Qwen3.8 Flash none/high. Qwen none returned zero thinking text; high returned thinking. Live compact SSE patches reconstructed the exact canonical saved turns in all eight cases. The temporary key file was removed. These tests confirm requested values reach the hosted API and demonstrate the none/high behavior; they do not establish a quantitative relationship between effort and reasoning length.
