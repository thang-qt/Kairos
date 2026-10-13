# Remote MCP servers

Kairos connects to user-managed remote MCP servers using Streamable HTTP. Add connections in **Settings → MCP Servers**, select anonymous or bearer authentication, test the connection, and enable individual discovered tools. Discovery is cached; refresh explicitly to update it. Rediscovery preserves tool choices, while removed tools become unavailable. Editing an endpoint invalidates its cached tools.

## GitHub setup

Select the GitHub read-only preset (`https://api.githubcopilot.com/mcp/readonly`) or standard preset (`https://api.githubcopilot.com/mcp/`). Create a personal access token at https://github.com/settings/personal-access-tokens with only the repositories and permissions needed for your selected tools. Organization policies, repository access, and SSO authorization can further restrict access. Paste the token, save, test, then enable tools. GitHub uses the same client as custom servers; there is no special GitHub executor or OAuth flow.

Stored tokens cannot be read back. Replace a token by editing its connection. Production bearer storage requires an explicitly configured `PROVIDER_SECRET_KEY` of at least 32 characters; protect and back up this key with the database. Losing or changing it makes existing encrypted credentials unreadable. Development uses the existing development encryption configuration.

## Runtime and approvals

A unified registry combines existing built-in tools with enabled, user-owned MCP tools. Stable 64-character aliases map back to server IDs and original tool names. Both Chat Completions and Responses feed the same agent loop, tool checkpoints, lease fencing, cancellation, and stable assistant turn.

Every remote call requires approval, including tools annotated read-only. Server annotations are untrusted. Chat shows the server, tool, and immutable arguments before execution. Approval is bound to the user, server revision, tool/schema, run, lease, call ID, and exact arguments; the backend consumes it once. Configuration changes, revoked permissions, expired leases, changed conversation revisions, and cancellation invalidate execution. Approval waits expire after three minutes; the whole tool operation is bounded to four minutes. Waiting occupies one of the existing bounded runtime worker slots.

Tool progress and normalized results appear in the existing assistant turn. Canceling sends best-effort MCP cancellation and releases the session. Cancellation cannot undo an external side effect. Crashed or interrupted running attempts are not automatically replayed. Explicit retries can repeat effects and require new approvals. MCP tools are unavailable in stateless throwaway chats because their approvals require a durable run.

## Security and deployment

Migration `0025_remote_mcp.sql` adds user-owned connections, encrypted bearer credentials, cached tools/permissions, and durable approval records. The deployment remains one Go binary and SQLite. The official `github.com/modelcontextprotocol/go-sdk` v1.8.0 requires Go 1.25; the existing Nix Go 1.25 builder is retained and its dependency hash updated.

Only HTTPS endpoints are accepted. URL credentials, queries, fragments, local hostnames, private/loopback/link-local/metadata addresses, and non-public DNS answers are rejected. Every request resolves and validates DNS again, pins the selected public IP, and verifies TLS against the original hostname. The environment proxy remains in use. Redirects and cross-origin requests are rejected; bearer credentials are attached only to the configured endpoint. Remote errors are replaced with safe messages, and known credential forms are scrubbed from remote metadata, progress, and results. Connection sessions close after discovery/calls and on cancellation; tool calls are never retried automatically.

Limits include 16 servers per user, 256 discovered tools per server, 16 discovery pages, 124 enabled remote tools per user, 64 KiB tool schemas and call arguments, bounded schema depth with local references only, 2 MiB transport responses/events, 256 KiB normalized results, and 30-second discovery timeouts. Disabling a tool cancels active operations for its server. Cached discovery does not continuously monitor upstream authorization; each new call reconnects and rechecks local permissions, and upstream failures are reported.

Remote descriptions and outputs remain untrusted model inputs. Approval controls authorization but cannot make an untrusted server's implementation honest. Use trusted servers and review arguments. There is no OAuth, stdio, executable installation, resource/prompt browsing, sampling, elicitation, or separate MCP agent runtime.

## Validation

- `pnpm check`: passed, 75 tests across 20 files, including settings CRUD/token submission/tool toggles, errors, approvals, and exclusion of sensitive mutations from persisted browser cache.
- `pnpm backend:check`: passed.
- `go test -race ./internal/server`: passed (143.409 seconds).
- Deterministic SDK integration covers anonymous and bearer connections, paginated discovery, duplicate tool names across servers, both provider protocols and multiple tool rounds, exact single-use approvals, progress/cancellation, ownership, SSRF/redirect/DNS rebinding, secret redaction, and interrupted execution.
- A subprocess crash test kills the executing runtime after a remote side effect and verifies that lease recovery preserves checkpoints, invalidates the old approval, and does not replay the call.

- `pnpm build` and `go build -o /tmp/kairosd-mcp ./cmd/kairosd`: passed; frontend assets are embedded in the standalone executable.
- Built-application HTTP smoke test: passed signup, MCP create/list/discover/enable/delete, bearer credential nonexposure, private-address rejection, embedded frontend, streamed Chat Completions, idempotent session creation, canonical history, and SSE reconciliation.
- Live anonymous `https://mcp.deepwiki.com/mcp`: discovery and approved `read_wiki_structure` for `modelcontextprotocol/go-sdk` passed through production DNS pinning, TLS, and the inherited proxy. The built application persisted the exact approval, executed the tool, continued the provider request, and retained assistant/tool-result/assistant steps in one stable turn. The model side of this smoke test was a deterministic local provider.

Authenticated live GitHub verification has not been performed; bearer authentication and GitHub configuration use deterministic MCP fixtures and frontend tests. Nix dependency hashing is updated, but a full Nix build is not available in this workspace.
