# Progress

## Current Focus

Build Kairos out from the locked backend architecture by landing vertical slices in order, starting with auth and app capabilities.

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

## Next Task

Start the second backend vertical slice: authenticated sessions and history.

Scope of the next slice:
- Add incremental migrations for `user_preferences`, `chat_sessions`, and `chat_messages`.
- Implement authenticated `GET /api/sessions`, `POST /api/sessions`, and `GET /api/sessions/:friendlyId/history`.
- Return the same session/history shapes the current frontend mock adapter already exposes.
- Add a selectable HTTP chat backend adapter for sessions and history while keeping mock send/stream behavior in place until the later chat-run slice.

Planned slice order after the sessions/history slice:
- Provider registry plus `openai_compatible` provider driver and provider settings endpoints
- Real model catalog loading from backend
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

After the sessions/history slice lands:
- Move hardcoded model data out of the frontend and behind backend-driven provider/model APIs.
- Continue schema work incrementally by feature migration instead of front-loading unused tables.
