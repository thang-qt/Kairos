# Progress

## Current Focus

Build Kairos out from the locked backend architecture by landing vertical slices in order, with auth and authenticated session persistence now in place.

## Status

- In Progress

## Completed This Step

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

## Next Task

Start the provider and model-management slice.

Scope of the next slice:

- Add the provider registry abstraction and the first `openai_compatible` driver using the OpenAI Go client.
- Add env-backed single system provider resolution plus user BYOK provider storage and policy gating.
- Implement `GET /api/providers`, `POST /api/providers`, `PATCH /api/providers/:providerId`, `DELETE /api/providers/:providerId`, and `GET /api/models`.
- Resolve model lists from upstream by default, with env-defined allowlists as the locked-down exception.
- Move hardcoded frontend model data behind backend-driven provider/model APIs.

Planned slice order after the provider/model slice:

- Chat send plus SSE streaming
- Branch fork/edit/delete flows
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

After the provider/model slice lands:

- Replace the remaining mock-only send path with backend chat runs and SSE streaming.
- Continue schema work incrementally by feature migration instead of front-loading unused tables.
