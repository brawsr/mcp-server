# Releasing

Releases are verified and published from GitHub Actions. npm and the official
MCP Registry both use short-lived OIDC credentials. Do not add an npm token or
MCP Registry token to the repository, and do not publish releases manually.

## Publishing infrastructure

`@brawsr/mcp-server` is a public npm package. Its trusted publisher uses these
exact values:

- GitHub organization: `brawsr`
- Repository: `mcp-server`
- Workflow: `publish.yml`
- Environment: `npm`
- Allowed action: `npm publish`

Package publishing requires two-factor authentication and disallows bypass-2FA
tokens. The matching official MCP Registry server is
`io.github.brawsr/brawsr`.

## Release

1. Update `package.json`, `package-lock.json`, `src/version.ts`, and
   `server.json` together.
2. Run the complete verification suite with the pinned Node/npm toolchain.
3. Create a non-prerelease GitHub release whose tag is exactly `v<version>` and
   whose target commit is on `main`.

The release workflow publishes the npm artifact first and then publishes its
matching `server.json` metadata to the official MCP Registry as
`io.github.brawsr/brawsr`.
