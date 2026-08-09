import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.versions.node.split(".")[0] !== "24") {
  throw new Error(
    "reproducible MCP archives must be built with the pinned Node 24 toolchain",
  );
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
assert.equal(packageJson.license, "Apache-2.0");
assert.notEqual(packageJson.private, true);
assert.equal(packageJson.name, "@brawsr/mcp-server");
assert.equal(packageJson.mcpName, "io.github.brawsr/brawsr");
assert.equal(packageJson.dependencies?.["@brawsr/sdk"], "0.1.0");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "brawsr-mcp-package-"));
const npmCommand = "npm";
const environment = {
  ...process.env,
  npm_config_cache: path.join(temporaryRoot, "npm-cache"),
};
assert.equal(
  execFileSync(npmCommand, ["--version"], {
    encoding: "utf8",
    env: environment,
  }).trim(),
  "11.5.1",
  "reproducible MCP archives must be built with the pinned npm 11.5.1 toolchain",
);

function pack(destination) {
  const output = execFileSync(
    npmCommand,
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    { cwd: root, encoding: "utf8", env: environment },
  );
  const metadata = JSON.parse(output)[0];
  return {
    archive: path.join(destination, metadata.filename),
    files: metadata.files.map(({ path: filename }) => filename).sort(),
  };
}

function sha256(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

try {
  const firstDirectory = path.join(temporaryRoot, "first");
  const secondDirectory = path.join(temporaryRoot, "second");
  mkdirSync(firstDirectory);
  mkdirSync(secondDirectory);
  const first = pack(firstDirectory);
  const second = pack(secondDirectory);
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(first.files, [
    "LICENSE",
    "README.md",
    "dist/cli.d.ts",
    "dist/cli.js",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/server.d.ts",
    "dist/server.js",
    "dist/version.d.ts",
    "dist/version.js",
    "package.json",
    "server.json",
  ]);
  assert.equal(
    sha256(first.archive),
    sha256(second.archive),
    "MCP archives are not reproducible",
  );

  const install = path.join(temporaryRoot, "install");
  mkdirSync(install);
  writeFileSync(
    path.join(install, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    npmCommand,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", first.archive],
    { cwd: install, stdio: "pipe", env: environment },
  );
  execFileSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      `import { createBrawsrMcpServer, MCP_SERVER_VERSION } from "@brawsr/mcp-server"; if (!createBrawsrMcpServer || MCP_SERVER_VERSION !== ${JSON.stringify(packageJson.version)}) process.exit(1);`,
    ],
    { cwd: install, stdio: "pipe", env: environment },
  );
  const command = path.join(install, "node_modules/.bin/brawsr-mcp-server");
  const cleanEnvironment = { ...environment };
  delete cleanEnvironment.BRAWSR_API_KEY;
  delete cleanEnvironment.BRAWSR_BASE_URL;
  const failed = spawnSync(command, [], {
    cwd: install,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.deepEqual(JSON.parse(failed.stderr), {
    level: "error",
    event: "mcp_server_failed",
  });
  console.log(`verified reproducible MCP archive ${sha256(first.archive)}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
