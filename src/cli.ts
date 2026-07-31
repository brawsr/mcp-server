#!/usr/bin/env node

import { BrawsrClient } from "@brawsr/sdk";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBrawsrMcpServer } from "./server.js";

async function main(): Promise<void> {
  const apiKey = process.env.BRAWSR_API_KEY;
  const baseUrl = process.env.BRAWSR_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error("BRAWSR_API_KEY and BRAWSR_BASE_URL are required");
  }
  const rawTimeout = process.env.BRAWSR_MCP_TIMEOUT_MS;
  const defaultTimeoutMs =
    rawTimeout === undefined ? 30_000 : Number(rawTimeout);
  const server = createBrawsrMcpServer({
    client: new BrawsrClient({ apiKey, baseUrl }),
    defaultTimeoutMs,
  });
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1024 * 1024,
  });
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await server.connect(transport);
  process.stderr.write(
    `${JSON.stringify({ level: "info", event: "mcp_server_ready" })}\n`,
  );
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "mcp_server_failed" })}\n`,
  );
  process.exitCode = 1;
});
