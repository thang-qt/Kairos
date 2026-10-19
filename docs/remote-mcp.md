# Remote MCP servers

Kairos can use tools from remote MCP servers that support Streamable HTTP.
In **Settings → MCP servers**, add a connection, choose anonymous or bearer-token
authentication, and save it. Kairos tests the connection and discovers its tools.
If discovery fails, the connection stays saved so you can correct it and retry.

Disable individual servers or tools in Settings or the chat sidebar's
**MCP tools** tab. Refresh discovery when a server's available tools change;
your choices are preserved for tools that remain available.

## Connect GitHub

Choose the GitHub read-only preset or the standard preset. Create a
[personal access token](https://github.com/settings/personal-access-tokens)
with only the repository access and permissions needed by your tools, then
paste it into the connection settings. Organization policies and SSO may require
additional authorization.

Saved tokens cannot be read back from Kairos. Edit the connection to replace one.

## Approvals and activity

Remote tools ask for approval by default, including tools described as read-only.
The approval shows the server, tool, arguments, and time remaining. Your typed
message is kept while the approval is displayed.

- **Allow once** permits this invocation.
- **Allow in this chat** permits future invocations of that tool in this chat.
- **Always allow** permits future invocations of that tool across your chats.
- **Deny** rejects the invocation.

Broader permissions also cover different future arguments. Switch a tool to
**Ask first** or use **Reset approvals** to revoke remembered permissions.
Disabling a connection or tool, editing the connection, or changing its tool
schema also invalidates the corresponding grants. Approval requests expire
after three minutes.

Tool progress, arguments, and results appear in the answer's activity panel.
Stopping a run attempts to cancel the remote call, but cannot undo an external
side effect. Interrupted calls are not retried automatically. Before manually
retrying a tool that changes external data, check whether its action already
completed. Remembered permissions also apply to retries.

Remote MCP tools are unavailable in throwaway chats.

## Supported servers and privacy

Only public HTTPS endpoints are supported. Local/private-network servers,
URL credentials, queries, fragments, and redirects are rejected. Kairos does not
install or launch servers, and does not support stdio connections or MCP OAuth.
Use bearer tokens where authentication is required.

Use servers you trust and review tool arguments before approving them. Tool
arguments are sent to the selected remote server, and results become part of
the conversation used by the model. Approval does not guarantee that a remote
server behaves honestly.

For self-hosted deployments, set `PROVIDER_SECRET_KEY` to at least 32 characters
in production and back it up with the database. It encrypts stored MCP and model
provider credentials. Losing or changing the key makes existing credentials
unreadable, so users must enter them again.
