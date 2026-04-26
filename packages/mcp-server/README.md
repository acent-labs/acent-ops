# Paperclip MCP Server

Model Context Protocol server for Paperclip.

This package is a thin MCP wrapper over the existing Paperclip REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PAPERCLIP_API_URL` - Paperclip base URL, for example `http://localhost:3100`
- `PAPERCLIP_API_KEY` - bearer token used for `/api` requests
- `PAPERCLIP_COMPANY_ID` - optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` - optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` - optional run id forwarded on mutating requests
- `PAPERCLIP_MCP_ACCESS_MODE` - `read_only` or `read_write` (default:
  `read_write` for backwards compatibility)
- `PAPERCLIP_MCP_API_TIMEOUT_MS` - timeout for each Paperclip API request,
  default `5000`
- `PAPERCLIP_MCP_ENABLE_API_REQUEST_TOOL` - set to `true` only when the generic
  `/api` escape hatch should be exposed, default `false`

For HTTP transport:

- `PAPERCLIP_MCP_HTTP_HOST` - bind host, default `127.0.0.1`
- `PAPERCLIP_MCP_HTTP_PORT` - bind port, default `8787`
- `PAPERCLIP_MCP_HTTP_PATH` - MCP endpoint path, default `/mcp`
- `PAPERCLIP_MCP_BEARER_TOKEN` - optional bearer token for HTTP clients
- `PAPERCLIP_MCP_ALLOW_UNAUTHENTICATED_HTTP` - set to `true` only when another
  trusted layer handles access control
- `PAPERCLIP_MCP_MAX_CONCURRENT_REQUESTS` - max in-flight MCP requests,
  default `4`
- `PAPERCLIP_MCP_RATE_LIMIT_WINDOW_MS` - rate-limit window, default `60000`
- `PAPERCLIP_MCP_RATE_LIMIT_MAX_REQUESTS` - max requests per window, default
  `60`
- `PAPERCLIP_MCP_MAX_REQUEST_BODY_BYTES` - max JSON body size, default
  `1048576`

## Usage

Stdio transport:

```sh
npx -y @paperclipai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @paperclipai/mcp-server exec tsx src/stdio.ts
```

Streamable HTTP transport:

```sh
PAPERCLIP_API_URL=http://127.0.0.1:3100 \
PAPERCLIP_API_KEY=<paperclip-agent-api-key> \
PAPERCLIP_COMPANY_ID=<company-id> \
PAPERCLIP_MCP_ACCESS_MODE=read_only \
PAPERCLIP_MCP_HTTP_HOST=127.0.0.1 \
PAPERCLIP_MCP_HTTP_PORT=8787 \
pnpm --filter @paperclipai/mcp-server exec tsx src/http.ts
```

Health check:

```sh
curl http://127.0.0.1:8787/healthz
```

## Running With Paperclip Dev

For local operation, prefer starting the MCP server as a Paperclip dev sidecar:

```sh
PAPERCLIP_MCP_ENABLED=true \
PAPERCLIP_API_KEY=<paperclip-agent-api-key> \
PAPERCLIP_COMPANY_ID=<company-id> \
PAPERCLIP_AGENT_ID=<agent-id> \
pnpm dev
```

When `PAPERCLIP_MCP_ENABLED=true`, `pnpm dev` starts both the Paperclip app and
the MCP HTTP sidecar. `pnpm dev:stop` stops both. Defaults are intentionally
conservative for ChatGPT Agent Builder testing: `read_only`, loopback bind,
two concurrent MCP requests, and a short upstream Paperclip API timeout.

Useful checks:

```sh
pnpm dev:list
curl http://127.0.0.1:3100/api/health
curl http://127.0.0.1:8787/healthz
```

Remote MCP clients should connect to:

```text
https://your-public-mcp-host.example.com/mcp
```

The server itself should run on a host that can reach Paperclip, for example a
Tailscale-joined machine that can call `PAPERCLIP_API_URL`. Do not expose the
Paperclip app directly to ChatGPT; expose only this MCP adapter and keep the
Paperclip API key on the MCP host.

The HTTP transport is intentionally stateless. It does not retain MCP sessions
between requests, and it rejects long or excessive traffic with request timeout,
concurrency, rate-limit, and body-size guards. `/healthz` is a local MCP process
check and does not probe Paperclip or the database.

OpenAI's remote MCP docs describe Streamable HTTP and HTTP/SSE as supported
remote MCP transports. ChatGPT Developer Mode currently supports OAuth or no
authentication for imported remote MCP apps, while the Responses API can pass an
authorization value. If this server is exposed outside a private network, prefer
OAuth or a trusted gateway in front of it rather than unauthenticated access.

## Tool Surface

Read tools:

- `paperclipMe`
- `paperclipInboxLite`
- `paperclipListAgents`
- `paperclipGetAgent`
- `paperclipListIssues`
- `paperclipGetTask`
- `paperclipSearchTasks`
- `paperclipListRecentTasks`
- `paperclipGetIssue`
- `paperclipGetHeartbeatContext`
- `paperclipListComments`
- `paperclipGetComment`
- `paperclipListIssueApprovals`
- `paperclipListDocuments`
- `paperclipGetDocument`
- `paperclipListDocumentRevisions`
- `paperclipListProjects`
- `paperclipGetProject`
- `paperclipListGoals`
- `paperclipGetGoal`
- `paperclipListApprovals`
- `paperclipGetApproval`
- `paperclipGetApprovalIssues`
- `paperclipListApprovalComments`

Write tools:

- `paperclipCreateIssue`
- `paperclipUpdateIssue`
- `paperclipUpdateTaskStatus`
- `paperclipCheckoutIssue`
- `paperclipReleaseIssue`
- `paperclipAddComment`
- `paperclipAddTaskComment`
- `paperclipUpsertIssueDocument`
- `paperclipRestoreIssueDocumentRevision`
- `paperclipCreateApproval`
- `paperclipLinkIssueApproval`
- `paperclipUnlinkIssueApproval`
- `paperclipApprovalDecision`
- `paperclipAddApprovalComment`

Escape hatch:

- `paperclipApiRequest`

`paperclipApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.

When `PAPERCLIP_MCP_ACCESS_MODE=read_only`, write tools and the generic
`paperclipApiRequest` escape hatch are not registered.

In `read_write` mode, dedicated write tools are registered, but
`paperclipApiRequest` remains disabled unless
`PAPERCLIP_MCP_ENABLE_API_REQUEST_TOOL=true`.

## ChatGPT Agent Setup Notes

Use `read_only` first for scheduled or periodic review agents. Move to
`read_write` only after the agent instructions require explicit user approval
before status updates, comments, approvals, or document writes.

Suggested initial policy:

- Read tools can run automatically for triage, status checks, and briefings.
- Write tools require explicit user approval in ChatGPT.
- `paperclipApiRequest` should stay disabled for ChatGPT unless a maintainer is
  actively testing a missing endpoint.

Do not use account-less public tunnels such as `trycloudflare.com` for ongoing
use. They are acceptable only for short smoke tests. For a persistent ChatGPT
app, use a fixed domain with Cloudflare Access, OAuth, or another trusted
gateway in front of this MCP process.
