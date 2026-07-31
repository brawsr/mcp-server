import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { BrawsrApiError, BrawsrWaitTimeoutError } from "@brawsr/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createBrawsrMcpServer, type BrawsrSdk } from "../src/index.ts";

interface Calls {
  fork: unknown[][];
  closeSessions: unknown[][];
}

function fakeSdk(calls: Calls, timeout = false): BrawsrSdk {
  return {
    async createSession() {
      return {
        id: "sess_1",
        cdpUrl: "wss://api.test/v1/sessions/sess_1/cdp",
        ttlSeconds: 300,
      };
    },
    async getSession(id) {
      return {
        id,
        status: "active",
        createdAt: "2026-07-31T00:00:00Z",
        expiresAt: "2026-07-31T01:00:00Z",
      };
    },
    async closeSession() {},
    async closeSessions(references, options) {
      calls.closeSessions.push([references, options]);
      return Object.freeze([
        Object.freeze({ sessionId: "sess_1", ok: true as const }),
        Object.freeze({
          sessionId: "sess_2",
          ok: false as const,
          error: new BrawsrApiError({
            status: 503,
            code: "worker_unavailable",
            message: "temporarily unavailable",
            requestId: "req_0011223344556677",
            retryable: true,
          }),
        }),
      ]);
    },
    async createCheckpoint() {
      return {
        operationId: "op_1",
        checkpointId: "chk_1",
        safePoint: {
          mode: "explicit" as const,
          callerAsserted: true,
          infrastructureBarriersPassed: true,
          warningCodes: [],
        },
      };
    },
    async getCheckpoint(id) {
      return {
        id,
        sessionId: "sess_1",
        parentId: null,
        operationId: "op_1",
        lifecycle: "live",
        durability: "warm",
        mode: "explicit" as const,
        createdAt: "2026-07-31T00:00:00Z",
      };
    },
    async listCheckpoints() {
      return { items: [] };
    },
    async deleteCheckpoint() {},
    async rewind(sessionId) {
      return {
        operationId: "op_1",
        sessionId,
        checkpointId: "chk_1",
        routingGeneration: 2,
        cdpUrl: `wss://api.test/v1/sessions/${sessionId}/cdp`,
      };
    },
    async fork(...args) {
      calls.fork.push(args);
      if (timeout) {
        throw new BrawsrWaitTimeoutError(undefined, {
          operationId: "op_recover",
          idempotencyKey: "idem_recover_123456",
        });
      }
      return Object.freeze({
        operationId: "op_1",
        sourceSessionId: "sess_source",
        checkpointId: "chk_1",
        status: "succeeded" as const,
        children: Object.freeze([
          Object.freeze({
            branchIndex: 0,
            sessionId: "sess_child",
            cdpUrl: "wss://api.test/v1/sessions/sess_child/cdp",
            expiresAt: "2026-07-31T01:00:00Z",
          }),
        ]),
      });
    },
    async getOperation() {
      return operation("running");
    },
    async waitOperation() {
      return operation("succeeded");
    },
  };
}

function operation(status: string) {
  return {
    id: "op_1",
    kind: "fork",
    status,
    stage: status,
    stageSequence: 1,
    sessionId: "sess_1",
    checkpointId: "chk_1",
    createdAt: "2026-07-31T00:00:00Z",
    updatedAt: "2026-07-31T00:00:01Z",
    completedAt: status === "succeeded" ? "2026-07-31T00:00:01Z" : null,
  };
}

async function connected(timeout = false) {
  const calls: Calls = { fork: [], closeSessions: [] };
  const server = createBrawsrMcpServer({
    client: fakeSdk(calls, timeout),
    defaultTimeoutMs: 12_345,
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { server, client, calls };
}

test("real MCP client sees the exact high-level tool surface", async () => {
  const { server, client } = await connected();
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [
      "brawsr_close_session",
      "brawsr_close_sessions",
      "brawsr_create_checkpoint",
      "brawsr_create_session",
      "brawsr_delete_checkpoint",
      "brawsr_fork",
      "brawsr_get_checkpoint",
      "brawsr_get_operation",
      "brawsr_get_session",
      "brawsr_list_checkpoints",
      "brawsr_rewind",
      "brawsr_wait_operation",
    ]);
    assert.match(
      tools.tools.find(({ name }) => name === "brawsr_fork")!.description!,
      /not winners\/losers/,
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("fork is one MCP call and delegates one terminal SDK call", async () => {
  const { server, client, calls } = await connected();
  try {
    const response = await client.callTool({
      name: "brawsr_fork",
      arguments: {
        session_id: "sess_source",
        label: "before-submit",
        n: 1,
        idempotency_key: "idem_caller_123456",
      },
    });
    assert.equal(response.isError, undefined);
    assert.equal(calls.fork.length, 1);
    assert.deepEqual(calls.fork[0], [
      "sess_source",
      "before-submit",
      {
        n: 1,
        ttlSeconds: undefined,
        idempotencyKey: "idem_caller_123456",
        timeoutMs: 12_345,
      },
    ]);
    assert.equal(
      (response.structuredContent as { result: { children: unknown[] } }).result
        .children.length,
      1,
    );
    assert.doesNotMatch(JSON.stringify(response), /Authorization|api.?key/i);
  } finally {
    await client.close();
    await server.close();
  }
});

test("fork selector schema rejects missing or conflicting selectors before the SDK", async () => {
  const { server, client, calls } = await connected();
  try {
    const missing = await client.callTool({
      name: "brawsr_fork",
      arguments: { session_id: "sess_source", n: 1 },
    });
    const conflicting = await client.callTool({
      name: "brawsr_fork",
      arguments: {
        session_id: "sess_source",
        checkpoint_id: "chk_1",
        label: "x",
        n: 1,
      },
    });
    assert.equal(missing.isError, true);
    assert.equal(conflicting.isError, true);
    assert.equal(calls.fork.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("timeout is structured, recoverable, and states that server work continues", async () => {
  const { server, client } = await connected(true);
  try {
    const response = await client.callTool({
      name: "brawsr_fork",
      arguments: { session_id: "sess_source", checkpoint_id: "chk_1", n: 1 },
    });
    const result = (
      response.structuredContent as {
        result: { error: Record<string, unknown> };
      }
    ).result;
    assert.equal(response.isError, true);
    assert.equal(result.error.operation_id, "op_recover");
    assert.equal(result.error.idempotency_key, "idem_recover_123456");
    assert.equal(result.error.server_work_continues, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("multi-close preserves every ordered partial-failure outcome", async () => {
  const { server, client, calls } = await connected();
  try {
    const response = await client.callTool({
      name: "brawsr_close_sessions",
      arguments: { session_ids: ["sess_1", "sess_2"], concurrency: 2 },
    });
    const result = (
      response.structuredContent as { result: Array<Record<string, unknown>> }
    ).result;
    assert.deepEqual(
      result.map(({ session_id, ok }) => ({ session_id, ok })),
      [
        { session_id: "sess_1", ok: true },
        { session_id: "sess_2", ok: false },
      ],
    );
    assert.equal(
      (result[1]!.error as Record<string, unknown>).code,
      "worker_unavailable",
    );
    assert.equal(calls.closeSessions.length, 1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("real MCP client executes every remaining lifecycle tool", async () => {
  const { server, client } = await connected();
  const calls = [
    ["brawsr_create_session", {}],
    ["brawsr_get_session", { session_id: "sess_1" }],
    ["brawsr_close_session", { session_id: "sess_1" }],
    [
      "brawsr_create_checkpoint",
      { session_id: "sess_1", label: "before-submit" },
    ],
    ["brawsr_get_checkpoint", { checkpoint_id: "chk_1" }],
    ["brawsr_list_checkpoints", { session_id: "sess_1", limit: 10 }],
    ["brawsr_delete_checkpoint", { checkpoint_id: "chk_1" }],
    ["brawsr_rewind", { session_id: "sess_1", checkpoint_id: "chk_1" }],
    ["brawsr_get_operation", { operation_id: "op_1" }],
    ["brawsr_wait_operation", { operation_id: "op_1" }],
  ] as const;
  try {
    for (const [name, args] of calls) {
      const response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, undefined, `${name} unexpectedly failed`);
      assert(
        "result" in
          ((response.structuredContent ?? {}) as Record<string, unknown>),
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("CLI configuration failure writes only a redacted structured stderr event", () => {
  const environment = { ...process.env };
  delete environment.BRAWSR_API_KEY;
  delete environment.BRAWSR_BASE_URL;
  delete environment.BRAWSR_MCP_TIMEOUT_MS;
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), {
    level: "error",
    event: "mcp_server_failed",
  });
});
