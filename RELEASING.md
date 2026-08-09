# Releasing

Releases are verified and published from GitHub Actions. After the one-time npm
bootstrap, npm and the official MCP Registry both use short-lived OIDC
credentials. Do not add an npm token or MCP Registry token to the repository.

## One-time npm bootstrap

npm requires a package to exist before a trusted publisher can be configured.
An owner of the `@brawsr` npm scope must publish `@brawsr/mcp-server@0.1.0` once
from the clean, verified release commit using interactive npm authentication.

Then configure the npm trusted publisher with these exact values:

- GitHub owner: `brawsr`
- Repository: `mcp-server`
- Workflow: `publish.yml`
- Environment: `npm`
- Allowed action: `npm publish`

Require two-factor authentication and disallow bypass-2FA tokens for package
publishing access.

## Subsequent releases

1. Update `package.json`, `package-lock.json`, `src/version.ts`, and
   `server.json` together.
2. Run the complete verification suite with the pinned Node/npm toolchain.
3. Create a non-prerelease GitHub release whose tag is exactly `v<version>` and
   whose target commit is on `main`.

The release workflow publishes the npm artifact first and then publishes its
matching `server.json` metadata to the official MCP Registry as
`io.github.brawsr/brawsr`.
