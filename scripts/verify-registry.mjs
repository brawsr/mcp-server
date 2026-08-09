import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(new URL("../server.json", import.meta.url), "utf8"),
);

assert.equal(
  manifest.$schema,
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
);
assert.equal(packageJson.mcpName, "io.github.brawsr/brawsr");
assert.equal(manifest.name, packageJson.mcpName);
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.description.length <= 100, true);
assert.deepEqual(manifest.repository, {
  url: "https://github.com/brawsr/mcp-server",
  source: "github",
  id: "1318247747",
});
assert.equal(manifest.packages.length, 1);

const [distribution] = manifest.packages;
assert.equal(distribution.registryType, "npm");
assert.equal(distribution.identifier, packageJson.name);
assert.equal(distribution.version, packageJson.version);
assert.deepEqual(distribution.transport, { type: "stdio" });
assert.deepEqual(
  distribution.environmentVariables.map(
    ({ name, format, isRequired, isSecret }) => ({
      name,
      format,
      isRequired,
      isSecret,
    }),
  ),
  [
    {
      name: "BRAWSR_API_KEY",
      format: "string",
      isRequired: true,
      isSecret: true,
    },
    {
      name: "BRAWSR_BASE_URL",
      format: "string",
      isRequired: false,
      isSecret: false,
    },
    {
      name: "BRAWSR_MCP_TIMEOUT_MS",
      format: "number",
      isRequired: false,
      isSecret: false,
    },
  ],
);

console.log(
  `verified MCP Registry manifest ${manifest.name}@${manifest.version}`,
);
