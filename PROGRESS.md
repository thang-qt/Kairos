# Progress

## Current Focus

Build Kairos out from the locked backend architecture by landing vertical slices in order, with auth, persisted sessions/history, provider/model management, and a simplified provider-backed chat send/stream pipeline now in place.

## Status

- In Progress

## Completed This Step

- Completed:
  Move conversation pin state into the backend with a `chat_sessions.is_pinned` migration, authenticated pin API, and frontend mutations that no longer rely on local-only storage.
- Completed:
  Land the backend-owned branching slice with real fork, edit, and delete session/message endpoints backed by SQLite session/message cloning instead of mock-only branch state.
- Completed:
  Switch the authenticated HTTP chat backend off the mock branch path so fork/edit/delete actions now use backend routes with mock fallback only for missing local-only sessions.
- Completed:
  Add backend coverage for fork, delete-branch, and edit-and-regenerate flows, and harden assistant message ordering so fast provider runs still persist after the triggering user turn.
- Completed:
  Refactor the backend chat run execution flow so assistant replies have a stable message identity during streaming instead of relying on frontend-side heuristic reconciliation.
- Completed:
  Simplify frontend chat stream and history merging to reconcile streamed assistant messages by message id and run id instead of time/text guesses.
- Completed:
  Add end-to-end stop support for active chat generation with a backend stop endpoint, frontend composer stop action, and persisted partial assistant output on abort.
- Completed:
  Add a generic chat backend interface and persisted mock frontend backend for conversations, history, send, rename, delete, and streaming updates.
- Completed:
  Refactor the chat hooks and screen to consume the backend interface instead of `/api/*` routes and the OpenClaw gateway.
- Completed:
  Remove the leftover OpenClaw-only routes/server code and clean up generic chat copy in the UI.
- Completed:
  Draft the backend architecture in `ARCHITECTURE.md` for a multi-user Go `net/http` + SQLite app with cookie-based auth, env-driven policy, one env-backed system provider, user BYOK providers, pluggable provider drivers, and SSE streaming.
- Completed:
  Resolve the initial backend policy decisions: use session cookies instead of JWT, hide signup UI when disabled, use `friendly_id` for frontend routes and API-facing identifiers, hit upstream for model sync by default, auto-run title generation after the first assistant response when enabled, and defer provider-specific tuning out of v1.
- Completed:
  Decide to build the database incrementally with feature-driven migrations instead of creating the full final schema up front.
- Completed:
  Land the first backend vertical slice with a Go `net/http` service, SQLite migration bootstrap, cookie-based auth, app capabilities, optional env-based admin bootstrap, and Nix shell support for Go and SQLite tooling.
- Completed:
  Add the frontend auth/app shell for the first slice: `/auth`, capability-aware signup hiding, session gating on chat routes, and logout from the existing settings dialog while leaving chat data on the mock backend.
- Completed:
  Land the second backend vertical slice with incremental `user_preferences`, `chat_sessions`, and `chat_messages` migrations plus authenticated session list, create, rename, delete, and history endpoints.
- Completed:
  Add a hybrid HTTP chat backend adapter that hydrates the existing mock runtime from real backend sessions/history so authenticated users can use persisted conversations without rewriting the current send/stream UI yet.
- Completed:
  Add backend tests for authenticated session persistence, user scoping, rename/delete behavior, and history loading.
- Completed:
  Reorder the backend slice plan to land real message send and SSE streaming before provider/model work, so persisted conversations no longer lose their message history on refresh.
- Completed:
  Land the third backend vertical slice with incremental `chat_runs` migration, persisted user and assistant messages, server-owned placeholder run generation, and SSE events for active conversations.
- Completed:
  Switch the authenticated HTTP chat backend off the mock send/subscribe path so message sends and stream updates now come from the Go backend while fork/edit/delete remain on the mock runtime for now.
- Completed:
  Add backend tests for real send persistence, streamed finalization, and stream user scoping, and harden SQLite startup with a busy timeout plus a single open connection.
- Completed:
  Land the provider/model slice with env-backed single system provider resolution, encrypted user BYOK provider storage, capability-aware provider and preference APIs, and backend-driven model discovery with static fallback behavior.
- Completed:
  Replace the hardcoded frontend model picker with `/api/models` data, resolve per-conversation model selection against backend defaults, and add a minimal provider management panel in the existing settings dialog.
- Completed:
  Replace the placeholder chat runtime with provider-backed generation so authenticated message sends now resolve a real enabled provider/model pair, stream provider deltas over the existing SSE contract, and persist the final assistant response from that provider runtime.
- Completed:
  Add backend coverage for provider-backed streaming with a fake driver and remove the fake frontend/server `kairos-*` model fallback so chats only send when a real provider model is available.

## Next Task

Start the title generation slice.

Scope of the next slice:

- Generate and persist conversation titles after the first assistant response when auto-title behavior is enabled.
- Decide how title generation interacts with forked conversations so branch labels remain predictable.
- Keep title updates backend-owned so the frontend only consumes session metadata refreshes.

Planned slice order after the provider-backed runtime slice:

- Streaming UX cleanup
- Title generation

Current branch feature work:

- Completed:
  Add inline fork navigation at branch points so sibling branches can be switched from the message flow while keeping forks as separate conversations under the hood.
- Completed:
  Add a desktop-only conversation navigator on the right side of the chat scroll area so long threads can jump between user turns without opening the sidebar.
- Completed:
  Add user-turn edit and delete actions that create a new branch instead of mutating the current branch. Editing regenerates immediately from the edited turn; deleting truncates at that point in a new branch and leaves the user to continue intentionally.
- Completed:
  Rework the right pane into icon-only options, config, and branches tabs; move conversation export into options; and make each assistant response retain its own model label so changing the selected model only affects future turns.
- Completed:
  Split global display settings from conversation-scoped generation settings so the settings dialog remains the single place for app-wide toggles, while the right pane holds per-conversation model and generation controls like thinking level, temperature, top-p, and max output.

## Planned Follow-Up

- Add a visible stopped/aborted state for partial assistant replies so cancelled generations are distinct from completed ones.
- Consider moving from session-wide SSE to run-scoped streaming with explicit idempotency if the current stream contract remains hard to evolve.
- Continue schema work incrementally by feature migration instead of front-loading unused tables.
