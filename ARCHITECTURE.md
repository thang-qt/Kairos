# Architecture

## Purpose

This document defines the initial backend architecture for Kairos as a multi-user chat application backed by Go `net/http` and SQLite.

The goals are:

- keep the server simple and boring
- support multi-user auth from day one
- allow both admin-provided provider credentials and user BYOK providers
- enforce policy from environment variables instead of an admin dashboard
- preserve the frontend's existing chat model, including branching, streaming, and optimistic UI

## Decisions

### Chosen Defaults

- Backend framework: Go standard library `net/http`
- Database: SQLite
- Auth: cookie-based server sessions
- Password hashing: `argon2id`
- Admin configuration: environment variables only
- Admin UI: none
- User provider credentials: stored in SQLite and encrypted at rest
- Admin provider credentials: env-backed and read-only at runtime
- Title generation: disabled by default

### Why Session Cookies Instead Of JWT

Kairos is a first-party web app, not a public API platform. Session cookies are the better fit because they:

- simplify login and logout flows
- simplify revocation and forced sign-out
- avoid token parsing and rotation complexity
- keep auth state fully server-controlled
- work naturally with browser requests from the frontend

JWT should only be added later if Kairos needs external clients or cross-domain stateless auth.

## Architecture Overview

Kairos backend is split into five concerns:

1. Auth
2. Chat data
3. Provider configuration
4. Policy resolution
5. Streaming runs

### Auth

Responsible for:

- sign up, if enabled
- login and logout
- session cookie issuance and validation
- current user lookup

### Chat Data

Responsible for:

- listing conversations for the authenticated user
- loading history for one conversation
- creating new conversations
- sending messages
- branch creation by fork, edit, and delete-user-turn flows
- title updates

### Provider Configuration

Responsible for:

- exposing env-backed system providers
- storing user-provided providers
- merging both into one effective provider/model view
- selecting provider/model for chat and title generation

### Policy Resolution

Responsible for:

- reading env
- deciding which product features are enabled
- deciding what is user-overridable
- exposing effective capabilities to the frontend

### Streaming Runs

Responsible for:

- creating run records
- streaming assistant progress events to the frontend
- finalizing assistant messages in persistent storage

## Tenancy Model

Kairos is multi-user from the start.

Rules:

- every conversation belongs to one user
- every message belongs to a conversation
- every run belongs to a conversation and user
- every user-owned provider belongs to one user
- no user can read or mutate another user's chat or provider settings

Session and message routes must always be scoped by the authenticated user, even when the URL contains a valid session identifier.

## Admin Model

There is no admin dashboard in v1.

Admin is treated as deployment-time configuration, not an interactive app role. The backend may still mark users with `role = admin`, but runtime product control comes from env, not from in-app admin screens.

This means:

- signup policy is controlled by env
- default providers are controlled by env
- model policy is controlled by env
- title generation defaults are controlled by env
- user override permissions are controlled by env

## Auth Design

### Login Model

Supported auth in v1:

- email + password

Not included in v1:

- OAuth
- magic links
- password reset UI
- multi-factor auth

### Auth Tables

#### `users`

- `id`
- `email`
- `password_hash`
- `role`
- `created_at`
- `updated_at`
- `disabled_at` nullable

#### `auth_sessions`

- `id`
- `user_id`
- `token_hash`
- `created_at`
- `expires_at`
- `last_seen_at`
- `ip_address` nullable
- `user_agent` nullable

### Cookie Model

- cookie contains an opaque session token
- server stores only the token hash
- cookie flags:
  - `HttpOnly`
  - `SameSite=Lax`
  - `Secure` in production

### Bootstrap Admin

Optional env-based bootstrap:

- `BOOTSTRAP_ADMIN=true`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`

If bootstrap is enabled and the admin user does not exist, the server creates it on startup.

## Provider Architecture

Kairos supports two provider ownership modes:

- system providers
- user providers

### System Providers

System providers are defined by environment variables.

Properties:

- read-only in the app
- not deletable by users
- not editable by users
- may be hidden, optional, required, or locked by env

Use cases:

- shared admin API key
- deployment-wide default provider
- locked-down hosted mode where BYOK is disabled

V1 supports exactly one system provider.

That keeps the initial policy surface, default-provider behavior, and model resolution simpler while leaving room to expand to multiple system providers later.

### User Providers

User providers are created by authenticated users.

Properties:

- stored in SQLite
- API keys encrypted at rest
- users can add more than one provider
- users can enable or disable them
- users may choose one as default if policy allows

Use cases:

- BYOK OpenAI-compatible endpoints
- multiple provider accounts per user
- custom provider routing for specific models

### Provider Abstraction

Provider integrations must be pluggable.

The application core should not encode provider-specific logic directly into chat services, title generation, model sync, or request validation. Instead, provider behavior should sit behind a small provider driver interface and a provider registry.

Required design rules:

- adding a provider should not require changing chat business logic
- removing a provider should not require schema redesign
- provider-specific request mapping should stay inside the provider driver
- model listing should be provider-driver owned
- streaming translation should be provider-driver owned

Recommended server shape:

- provider registry
- provider driver interface
- provider configuration resolver
- provider client factory

Example conceptual interface:

```go
type ProviderDriver interface {
    Kind() string
    ValidateConfig(config ProviderConfig) error
    ListModels(ctx context.Context, client ProviderClient) ([]ModelDescriptor, error)
    StartChatRun(ctx context.Context, client ProviderClient, request ChatRunRequest) (ChatRunStream, error)
    GenerateTitle(ctx context.Context, client ProviderClient, request TitleGenerationRequest) (string, error)
}
```

The exact Go API can change during implementation, but the architecture should preserve this separation.

### Initial Provider Scope

V1 supports one provider kind only:

- OpenAI-compatible

Implementation target:

- use the official OpenAI Go library
- support OpenAI-compatible base URLs
- support system and user providers using the same adapter

This means Kairos should treat "OpenAI-compatible" as the first provider driver, not as a hardcoded one-off path.

### Provider Kind

Every provider record should include a provider kind, even in v1.

Initial supported value:

- `openai_compatible`

That keeps future providers possible without reshaping the full provider system.

### Effective Provider Set

The frontend should never reason directly from raw env.

Instead, the backend resolves an effective provider set per request:

- visible system providers
- visible user providers
- policy flags describing what the user can change

This effective provider set is what the frontend should render.

## Configuration Model

The backend must separate these concepts:

- default
- allowed
- required
- locked

They are not interchangeable.

Example:

- a system provider can be enabled by default
- user may be allowed to disable it
- or it may be required
- or it may be locked on and not user-overridable

This separation prevents inconsistent policy behavior.

## Environment Variables

These names are the proposed initial contract. The implementation can adjust naming later, but the behavior should remain the same.

### Server

- `APP_ENV`
- `APP_BASE_URL`
- `APP_LISTEN_ADDR`
- `APP_COOKIE_SECURE`
- `APP_SESSION_TTL_HOURS`
- `APP_ENCRYPTION_KEY`

### Auth

- `AUTH_ENABLED`
- `ALLOW_SIGNUP`
- `ALLOW_PASSWORD_LOGIN`
- `BOOTSTRAP_ADMIN`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_PASSWORD_HASH`

### Provider Policy

- `ENABLE_SYSTEM_PROVIDERS`
- `ENABLE_USER_PROVIDERS`
- `ALLOWED_PROVIDER_KINDS`
- `ALLOW_USER_DISABLE_SYSTEM_PROVIDERS`
- `ALLOW_USER_CUSTOM_BASE_URL`
- `ALLOW_USER_CUSTOM_MODELS`
- `ALLOW_USER_MODEL_SELECTION`
- `ALLOW_USER_MODEL_SYNC`
- `REQUIRE_SYSTEM_PROVIDER`
- `REQUIRE_USER_PROVIDER`
- `LOCK_DEFAULT_PROVIDER_SELECTION`
- `LOCK_DEFAULT_MODEL_SELECTION`

### Title Generation

- `TITLE_GENERATION_ENABLED`
- `TITLE_GENERATION_DEFAULT_MODE`
- `TITLE_GENERATION_ALLOW_USER_OVERRIDE`
- `TITLE_GENERATION_ALLOW_CURRENT_CHAT_MODEL`
- `TITLE_GENERATION_ALLOW_DEDICATED_MODEL`
- `TITLE_GENERATION_DEFAULT_PROVIDER_ID`
- `TITLE_GENERATION_DEFAULT_MODEL_ID`
- `AUTO_TITLE_ON_FIRST_ASSISTANT_RESPONSE`

### Chat Limits

- `ALLOW_ATTACHMENTS`
- `MAX_ATTACHMENTS_PER_MESSAGE`
- `MAX_ATTACHMENT_BYTES`
- `ALLOW_CONVERSATION_FORKING`
- `ALLOW_BRANCH_EDIT`
- `ALLOW_BRANCH_DELETE`
- `MAX_SESSIONS_PER_USER`
- `MAX_MESSAGES_PER_SESSION`

### Rate Limits

- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_AUTH_PER_15_MIN`
- `RATE_LIMIT_CHAT_PER_MINUTE`

### System Providers

V1 supports a single system provider definition:

- `SYSTEM_PROVIDER_1_ID`
- `SYSTEM_PROVIDER_1_KIND`
- `SYSTEM_PROVIDER_1_LABEL`
- `SYSTEM_PROVIDER_1_BASE_URL`
- `SYSTEM_PROVIDER_1_API_KEY`
- `SYSTEM_PROVIDER_1_ENABLED`
- `SYSTEM_PROVIDER_1_DEFAULT`
- `SYSTEM_PROVIDER_1_ALLOW_DISABLE`
- `SYSTEM_PROVIDER_1_MODEL_SYNC`
- `SYSTEM_PROVIDER_1_MODELS`

`SYSTEM_PROVIDER_N_MODELS` can be a comma-separated list for bootstrapped model visibility when live model sync is unavailable or disabled.

In v1, `SYSTEM_PROVIDER_N_KIND` must be `openai_compatible`.

## Effective Capabilities API

The frontend needs resolved capability flags, not raw environment variables.

Recommended response shape:

```json
{
  "auth": {
    "signupEnabled": false,
    "passwordLoginEnabled": true
  },
  "providers": {
    "systemProvidersEnabled": true,
    "userProvidersEnabled": true,
    "canDisableSystemProviders": true,
    "canAddCustomBaseUrl": true,
    "canAddCustomModels": true,
    "canSyncModels": true,
    "mustKeepAtLeastOneSystemProvider": false,
    "mustProvideAtLeastOneUserProvider": false
  },
  "models": {
    "canSelectModel": true,
    "defaultModelLocked": false
  },
  "titleGeneration": {
    "enabled": false,
    "canOverride": true,
    "canUseCurrentChatModel": true,
    "canUseDedicatedModel": true,
    "autoTitleOnFirstAssistantResponse": false
  },
  "chat": {
    "attachmentsEnabled": true,
    "maxAttachmentsPerMessage": 5,
    "maxAttachmentBytes": 5242880,
    "forkingEnabled": true,
    "branchEditEnabled": true,
    "branchDeleteEnabled": true
  }
}
```

## User Preference Model

User preferences must exist separately from deployment policy.

If policy permits user override, the user can change preference values. If policy does not permit override, the backend returns the policy value as effective state and rejects conflicting writes.

### User Preferences Table

#### `user_preferences`

- `user_id`
- `use_system_providers`
- `default_provider_ref`
- `default_model_id`
- `title_generation_mode`
- `title_generation_provider_ref` nullable
- `title_generation_model_id` nullable
- `auto_generate_titles`
- `updated_at`

`default_provider_ref` should support both ownership modes using a stable string format such as:

- `system:openai-default`
- `user:123e4567`

## Model Model

Kairos needs two model concepts:

- visible model catalog
- selected model reference

### Visible Model Catalog

The backend resolves the visible catalog from:

- static system provider models from env
- synced system provider models, if enabled
- user-defined custom models, if allowed
- synced user provider models, if enabled

The frontend should treat the catalog as data from the backend, not as a hardcoded list.

The current mock model list in the frontend is temporary and should be replaced by a backend-driven model list.

### Selected Model Reference

For chat completion, the selected model should be stored per conversation or per message run request, depending on behavior.

Current frontend behavior is conversation-scoped settings with per-message assistant model labels retained in history. The backend should preserve that behavior.

## Provider Data Model

Provider records should be generic enough to support multiple provider kinds later, while keeping v1 implementation restricted to OpenAI-compatible behavior.

### Tables

#### `user_providers`

- `id`
- `user_id`
- `kind`
- `label`
- `base_url`
- `api_key_encrypted`
- `is_enabled`
- `is_default`
- `supports_model_sync`
- `created_at`
- `updated_at`

`kind` initially supports:

- `openai_compatible`

System providers do not need a database table in v1 if they remain env-backed. They can be materialized as synthetic provider records in API responses and internal resolution.

### Provider Reference

Provider references should remain stable across ownership modes:

- `system:<provider-id>`
- `user:<provider-id>`

### Provider Config Resolution

When a request needs a provider client, the backend resolves:

1. provider reference
2. ownership mode
3. provider kind
4. base URL
5. API key source
6. driver from registry

The driver is then responsible for constructing a runtime client for that provider kind.

### OpenAI-Compatible Driver

The first concrete driver uses the OpenAI Go library with configurable base URL support.

Responsibilities:

- validate API key and base URL presence
- map Kairos chat messages into the OpenAI-compatible request format
- stream partial assistant output into Kairos `ChatEvent` updates
- list models from the upstream provider by default when sync is enabled
- run title generation requests with the same provider path

The rest of the application should depend only on the provider driver abstraction, not on OpenAI-specific request types.

## Title Generation

Title generation is optional and disabled by default.

### Supported Modes

- `disabled`
- `current_chat_model`
- `dedicated_model`

### Behavior

- default fallback title remains first-user-message truncation
- generated title is best-effort and asynchronous
- title generation must never block chat completion
- if generation fails, the fallback title remains
- when auto-title is enabled, title generation runs after the first assistant response for a conversation

### Policy

Env controls:

- whether title generation exists at all
- whether users can override the default mode
- whether users may use the current chat model
- whether users may use a dedicated model
- whether the app auto-generates titles after the first assistant reply

### Dedicated Title Model

If `dedicated_model` mode is selected, the backend resolves:

- provider reference
- model id

If either is invalid under current policy, the backend falls back to the env default or rejects the write depending on the endpoint.

## Chat Data Model

The backend must preserve the existing frontend chat behavior:

- conversations have a stable storage key and a route-friendly id
- messages are stored as structured content, not plain text only
- forking creates a new conversation branch
- editing a user message creates a new branch and regenerates
- deleting a user message creates a new branch truncated at the target point

### Tables

#### `chat_sessions`

- `id`
- `user_id`
- `friendly_id`
- `title` nullable
- `derived_title` nullable
- `label` nullable
- `updated_at`
- `last_message_id` nullable
- `total_tokens` nullable
- `context_tokens` nullable
- `parent_session_id` nullable
- `fork_point_message_id` nullable
- `fork_depth` nullable
- `created_at`

#### `chat_messages`

- `id`
- `session_id`
- `role`
- `content_json`
- `model` nullable
- `model_name` nullable
- `model_description` nullable
- `tool_call_id` nullable
- `tool_name` nullable
- `details_json` nullable
- `is_error`
- `client_id` nullable
- `created_at`

#### `chat_runs`

- `id`
- `user_id`
- `session_id`
- `provider_ref`
- `model_id`
- `kind`
- `status`
- `request_json`
- `error_text` nullable
- `started_at`
- `finished_at` nullable

`kind` initially supports:

- `chat`
- `title_generation`

## Streaming Design

The current frontend already expects streaming deltas and finals.

For Go `net/http`, the simplest fit is Server-Sent Events.

### Recommendation

Use SSE for v1:

- one-way server-to-browser stream is sufficient
- simpler than WebSocket
- easier to implement with standard library
- aligns with the current event model

### Event Shape

Keep the event payload aligned with the existing frontend `ChatEvent` shape:

- `runId`
- `sessionKey`
- `friendlyId`
- `state`
- `message`

Supported states:

- `delta`
- `final`
- `error`
- `aborted`

## API Surface

The frontend already uses an internal `ChatBackend` contract. The HTTP adapter should preserve those semantics.

### Auth Endpoints

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### Capability And Settings Endpoints

- `GET /api/app/capabilities`
- `GET /api/me/preferences`
- `PATCH /api/me/preferences`

### Provider Endpoints

- `GET /api/providers`
- `POST /api/providers`
- `PATCH /api/providers/:providerId`
- `DELETE /api/providers/:providerId`
- `POST /api/providers/:providerId/models/sync`

Rules:

- system providers are returned from `GET /api/providers`
- writes apply only to user-owned providers
- deleting or mutating a system provider returns an authorization or policy error
- v1 only accepts providers with kind `openai_compatible`

### Model Endpoints

- `GET /api/models`

### Chat Endpoints

- `GET /api/status`
- `GET /api/sessions`
- `POST /api/sessions`
- `PATCH /api/sessions/:sessionId`
- `DELETE /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/history`
- `POST /api/sessions/:sessionId/messages`
- `POST /api/sessions/:sessionId/forks`
- `POST /api/sessions/:sessionId/messages/:messageId/edit`
- `POST /api/sessions/:sessionId/messages/:messageId/delete`
- `GET /api/runs/:runId/events`

### Session Identifier Rule

`friendlyId` is the route-safe public conversation identifier already used by the frontend for URLs such as `/chat/:sessionKey`.

Recommended identifier model:

- internal `id`: stable database primary key used for joins and internal lookups
- public `friendly_id`: route-safe public identifier used by the frontend and external API payloads

This means:

- URLs should use `friendly_id`
- frontend fetches should use `friendly_id`
- database relations should use internal `id`
- the backend resolves `friendly_id` to internal `id` inside the repository/service layer

The preferred long-term direction is:

- route by `friendlyId`
- fetch by `friendlyId`
- store by stable internal `id`

## Policy Resolution Rules

The backend should resolve policy in this order:

1. env policy
2. system provider definitions from env
3. user preferences, if allowed
4. per-conversation settings
5. per-request explicit choices

Policy always wins over user preference.

Examples:

- if `ENABLE_USER_PROVIDERS=false`, user provider creation is rejected
- if `ALLOWED_PROVIDER_KINDS=openai_compatible`, all other provider kinds are rejected
- if `ALLOW_USER_DISABLE_SYSTEM_PROVIDERS=false`, preference writes cannot disable them
- if `LOCK_DEFAULT_MODEL_SELECTION=true`, user-selected default model is ignored or rejected
- if `TITLE_GENERATION_ENABLED=false`, all title generation preferences resolve to `disabled`

### Model Sync Rule

Model sync should hit the upstream provider by default when sync is enabled.

Exception:

- if BYOK is disabled and the deployment provides an explicit admin-defined allowlist of models, the backend may use that configured allowlist instead of upstream discovery

This means the default behavior is live model discovery, with env-controlled static allowlists as an intentional locked-down deployment mode.

### Provider Tuning Rule

Provider-specific request tuning should be deferred out of v1.

V1 should support only the minimum provider configuration needed for correctness:

- provider kind
- label
- base URL
- API key
- enabled state
- model sync flag
- optional static model allowlist

Do not add provider-specific tuning fields such as custom headers, temperature policy transforms, retry profiles, or request-body overrides in the first cut.

## Error Handling

The backend should distinguish:

- authentication errors
- authorization errors
- policy violations
- validation errors
- not found
- provider upstream failures

Recommended JSON envelope:

```json
{
  "error": {
    "code": "policy_violation",
    "message": "User-managed providers are disabled by server policy."
  }
}
```

## Security Notes

- never store raw session tokens
- never store user provider API keys unencrypted
- never expose admin env API keys to the client
- rate-limit auth endpoints
- rate-limit chat generation endpoints
- validate attachment size and content type before persistence
- log policy denials and auth failures

`APP_ENCRYPTION_KEY` should be required when user provider storage is enabled.

## Frontend Integration Plan

The current frontend uses a mock backend contract in `src/lib/chat-backend`.

Next frontend steps:

1. add an HTTP backend implementation alongside the mock backend
2. add auth methods to the frontend backend abstraction
3. replace hardcoded mock models with `GET /api/models`
4. fetch `GET /api/app/capabilities` on app boot
5. gate provider and title-generation UI based on capabilities
6. keep the mock backend available for local UI-only work

### New Frontend Contract Areas

The current `ChatBackend` type only covers chat operations. It should be extended or complemented with:

- auth client methods
- provider settings methods
- model catalog methods
- app capability methods
- user preference methods

## Initial Implementation Order

1. configuration loader and policy resolver
2. provider registry and `openai_compatible` driver
3. SQLite schema and migrations
4. auth session middleware
5. user and auth endpoints
6. provider and capability endpoints
7. chat session and history endpoints
8. send message and run streaming
9. branch edit, delete, and fork endpoints
10. title generation

## Migration Strategy

Database work should be incremental and feature-driven.

Do not try to build the entire final schema up front before feature slices exist. That usually creates unused tables, premature coupling, and expensive rewrites when product rules change.

Recommended approach:

- add only the tables required for the next vertical slice
- create a migration per feature boundary
- keep migrations forward-only
- expand schema when a new capability is about to be implemented

Recommended early sequence:

1. auth tables
2. user preferences table
3. provider tables
4. chat session and message tables
5. run tables
6. later feature-specific expansions such as audits or usage records

## Open Questions

These are the remaining choices to confirm before implementation:

- none blocking the first implementation slice

Resolved decisions already locked above:

- chat routes and frontend-facing APIs use `friendly_id`, while the database uses internal `id`
- model sync hits upstream by default when enabled
- admin-defined model allowlists are the exception for locked-down deployments
- v1 supports exactly one system provider
- provider-specific tuning is deferred out of v1
- title generation auto-runs after the first assistant response when enabled
- disabled signup should hide signup UI

### Signup UI Rule

If signup is disabled by policy:

- the frontend should hide signup UI
- the backend should still be safe if the endpoint is called directly
- `POST /api/auth/signup` should return a policy error when disabled

Hiding the UI is a product decision. Rejecting the request server-side is still required for correctness.

## Non-Goals For V1

- admin dashboard
- provider usage billing
- team workspaces
- OAuth sign-in
- password reset flows
- JWT-based public API auth
