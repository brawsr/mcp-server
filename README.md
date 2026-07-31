# brawsr MCP server

The authenticated local MCP bridge for brawsr browser sessions, checkpoints,
rewind, and fork. It uses the official packaged `@brawsr/sdk`; it does not
duplicate API models, poll orchestration, or browser/CDP behavior.

Status: private pre-release. The v0.1 transport is stdio only and requires
Node.js 20+.

## Configure

Install the SDK and server packages, then configure the locally spawned MCP
process with environment variables:

```text
BRAWSR_API_KEY=...
BRAWSR_BASE_URL=https://api.example.com
BRAWSR_MCP_TIMEOUT_MS=30000  # optional, 1..300000
```

The API key is never a tool argument or result. Standard output is reserved for
MCP protocol messages. Redacted lifecycle diagnostics use standard error.

## Tools

- `brawsr_create_session`, `brawsr_get_session`, `brawsr_close_session`
- `brawsr_close_sessions`
- `brawsr_create_checkpoint`, `brawsr_get_checkpoint`,
  `brawsr_list_checkpoints`, `brawsr_delete_checkpoint`
- `brawsr_rewind`, `brawsr_fork`
- `brawsr_get_operation`, `brawsr_wait_operation`

Checkpoint, rewind, and fork are one high-level tool call. The packaged SDK
hides ordinary `202` polling. Rewind returns as soon as its result is CDP-usable;
the operation may finish bounded post-restore work in the background. A timeout
stops only local waiting and returns the operation/idempotency recovery fields;
server work continues.

Fork children are independent peer sessions, not implicit winners or losers.
There is no browser-state merge and no automatic sibling cleanup. Rewind
restores browser/client state, not remote website side effects, and makes old
CDP/browser handles stale. Long-lived WSS/SSE/WebRTC streams may need
application-level reconnection.

CDP URLs are sensitive structured outputs. The MCP server never returns the
Authorization header. Use the ordinary SDK or a supported framework to attach;
the MCP server does not proxy CDP.

Remote Streamable HTTP, OAuth, hosted multi-tenancy, legacy HTTP+SSE, and
resumable MCP sessions are deferred beyond the local v0.1 stdio boundary.

## Development

```bash
npm ci
npm run verify
```

The checked-in SDK tarball is the exact private WP2 package identified in
`DEPENDENCY_PROVENANCE.json`. It contains public consumer code only and is not
a copy of SDK source. Registry publication remains a P3-M5 release gate.
