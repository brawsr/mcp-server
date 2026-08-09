import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(new URL("../server.json", import.meta.url), "utf8"),
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const versionSource = readFileSync(
  new URL("../src/version.ts", import.meta.url),
  "utf8",
);
const sourceVersion = versionSource.match(
  /MCP_SERVER_VERSION\s*=\s*"([^"]+)"/,
)?.[1];

assert.equal(
  process.env.GITHUB_REPOSITORY,
  "brawsr/mcp-server",
  "release must run from brawsr/mcp-server",
);
assert.equal(
  process.env.GITHUB_EVENT_NAME,
  "release",
  "release must be triggered by a GitHub release",
);
assert.equal(process.env.GITHUB_REF_TYPE, "tag", "release must run from a tag");
assert.equal(
  process.env.GITHUB_REF_NAME,
  `v${packageJson.version}`,
  "release tag must exactly match package.json version",
);
assert.notEqual(packageJson.private, true, "package must be publishable");
assert.equal(packageJson.name, "@brawsr/mcp-server");
assert.equal(packageJson.mcpName, "io.github.brawsr/brawsr");
assert.equal(packageJson.version, sourceVersion);
assert.equal(packageJson.version, manifest.version);
assert.equal(packageJson.mcpName, manifest.name);
assert.equal(packageJson.dependencies?.["@brawsr/sdk"], "0.1.0");
assert.equal(packageJson.publishConfig?.access, "public");
assert.equal(
  packageJson.publishConfig?.registry,
  "https://registry.npmjs.org/",
);
assert.equal(
  packageJson.repository?.url,
  "git+https://github.com/brawsr/mcp-server.git",
);
assert.doesNotMatch(
  readme,
  /private pre-release|not yet published|registry publication remains/i,
  "release README still contains private or unpublished wording",
);
