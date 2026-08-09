# brawsr MCP server

The authenticated local MCP bridge for brawsr browser sessions, checkpoints,
rewind, and fork. It uses the official packaged `@brawsr/sdk`; it does not
duplicate API models, poll orchestration, or browser/CDP behavior.

The v0.1 transport is local stdio and requires Node.js 22+.

## Install and configure

MCP clients spawn the server locally. Pin the package version in client
configuration so an MCP client restart cannot silently select a newer release:

```json
{
  "mcpServers": {
    "brawsr": {
      "command": "npx",
      "args": ["-y", "@brawsr/mcp-server@0.1.0"],
      "env": {
        "BRAWSR_API_KEY": "your-brawsr-api-key"
      }
    }
  }
}
```

The npm package includes the official `@brawsr/sdk`; no second package install
is required. `BRAWSR_API_KEY` is the only required environment variable. The
production endpoint `https://api.brawsr.io` is built in.

For local development or another deployment, `BRAWSR_BASE_URL` may explicitly
override that endpoint. `BRAWSR_MCP_TIMEOUT_MS` optionally changes the default
bounded operation wait from 30 seconds and accepts an integer from 1 through 300000.

The API key is never a tool argument or result. Standard output is reserved for
MCP protocol messages. Redacted lifecycle diagnostics use standard error. A
direct shell launch uses the same executable:

```bash
BRAWSR_API_KEY=... npx -y @brawsr/mcp-server@0.1.0
```

## Tools

- `brawsr_create_session`, `brawsr_list_sessions`, `brawsr_get_session`,
  `brawsr_update_session_label`, `brawsr_close_session`
- `brawsr_close_sessions`
- `brawsr_create_checkpoint`, `brawsr_get_checkpoint`,
  `brawsr_list_checkpoints`, `brawsr_delete_checkpoint`
- `brawsr_list_rewindable_checkpoints`, `brawsr_list_session_activity`,
  `brawsr_get_session_lineage`
- `brawsr_rewind`, `brawsr_fork`
- `brawsr_get_operation`, `brawsr_wait_operation`

Session creation accepts an optional `display_label`. The same label can be
changed or cleared with one `brawsr_update_session_label` call. Session lists
are newest-first, bounded, and may include retained closed or expired sessions.
`brawsr_get_session` includes a CDP URL only while the session is attachable.

`brawsr_list_checkpoints` is capture history: it can include deleted captures
for audit and dashboard views. Use `brawsr_list_rewindable_checkpoints` when
choosing a valid rewind or fork target. Lineage returns one session, its
optional parent fork edge, and one bounded page of direct children; callers can
follow child session IDs to browse a nested fork tree. Pagination cursors are
opaque and may be passed back unchanged.

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

Release archives are built reproducibly with the pinned Node 24 and npm 11.5.1
toolchain. CI also exercises the server and its real MCP client boundary on
Node 22 and Node 24. npm hosts the executable package; the official MCP Registry
hosts discovery metadata for `io.github.brawsr/brawsr`.
