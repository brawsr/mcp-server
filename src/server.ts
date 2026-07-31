import {
  BrawsrApiError,
  BrawsrOperationError,
  BrawsrTransportError,
  BrawsrWaitCancelledError,
  BrawsrWaitTimeoutError,
  type BrawsrClient,
} from "@brawsr/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export type BrawsrSdk = Pick<
  BrawsrClient,
  | "createSession"
  | "getSession"
  | "closeSession"
  | "closeSessions"
  | "createCheckpoint"
  | "getCheckpoint"
  | "listCheckpoints"
  | "deleteCheckpoint"
  | "rewind"
  | "fork"
  | "getOperation"
  | "waitOperation"
>;

export interface BrawsrMcpServerOptions {
  readonly client: BrawsrSdk;
  readonly defaultTimeoutMs?: number;
}

const identifier = z.string().min(1).max(128);
const timeoutMs = z.number().int().min(1).max(300_000).optional();
const idempotencyKey = z.string().min(16).max(128).optional();
const resultSchema = z.object({ result: z.unknown() });
const selectorShape = {
  checkpoint_id: identifier.optional(),
  label: z.string().min(1).max(128).optional(),
};
const hasOneSelector = (value: {
  checkpoint_id?: string;
  label?: string;
}): boolean =>
  Number(value.checkpoint_id !== undefined) +
    Number(value.label !== undefined) ===
  1;

export function createBrawsrMcpServer(
  options: BrawsrMcpServerOptions,
): McpServer {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(defaultTimeoutMs) ||
    defaultTimeoutMs < 1 ||
    defaultTimeoutMs > 300_000
  ) {
    throw new Error("defaultTimeoutMs must be an integer between 1 and 300000");
  }
  const server = new McpServer({ name: "brawsr", version: "0.1.0" });
  const client = options.client;

  server.registerTool(
    "brawsr_create_session",
    {
      description:
        "Create one browser session. Session closure remains explicit.",
      inputSchema: z
        .object({
          ttl_seconds: z.number().int().positive().optional(),
          mem_mib: z.number().int().positive().optional(),
        })
        .strict(),
      outputSchema: resultSchema,
    },
    async ({ ttl_seconds, mem_mib }) =>
      invoke(() =>
        client.createSession({ ttlSeconds: ttl_seconds, memMib: mem_mib }),
      ),
  );

  server.registerTool(
    "brawsr_get_session",
    {
      description: "Get the public state of one browser session.",
      inputSchema: z.object({ session_id: identifier }).strict(),
      outputSchema: resultSchema,
    },
    async ({ session_id }) => invoke(() => client.getSession(session_id)),
  );

  server.registerTool(
    "brawsr_close_session",
    {
      description:
        "Explicitly close one browser session. The operation is idempotent.",
      inputSchema: z.object({ session_id: identifier }).strict(),
      outputSchema: resultSchema,
    },
    async ({ session_id }) =>
      invoke(async () => {
        await client.closeSession(session_id);
        return { session_id, closed: true };
      }),
  );

  server.registerTool(
    "brawsr_close_sessions",
    {
      description:
        "Explicitly close multiple sessions with bounded concurrency. Returns every ordered outcome and never infers winners or losers.",
      inputSchema: z
        .object({
          session_ids: z.array(identifier).min(1).max(100),
          concurrency: z.number().int().min(1).max(32).optional(),
        })
        .strict(),
      outputSchema: resultSchema,
    },
    async ({ session_ids, concurrency }) =>
      invoke(async () => {
        const outcomes = await client.closeSessions(session_ids, {
          concurrency,
        });
        return outcomes.map((outcome) =>
          outcome.ok
            ? { session_id: outcome.sessionId, ok: true }
            : {
                session_id: outcome.sessionId,
                ok: false,
                ...safeError(outcome.error),
              },
        );
      }),
  );

  server.registerTool(
    "brawsr_create_checkpoint",
    {
      description:
        "Create a browser checkpoint and wait to a bounded terminal result. Explicit mode trusts the caller's safe-point assertion.",
      inputSchema: z
        .object({
          session_id: identifier,
          label: z.string().min(1).max(128).optional(),
          ttl_seconds: z.number().int().positive().optional(),
          idempotency_key: idempotencyKey,
          timeout_ms: timeoutMs,
        })
        .strict(),
      outputSchema: resultSchema,
    },
    async ({ session_id, label, ttl_seconds, idempotency_key, timeout_ms }) =>
      invoke(() =>
        client.createCheckpoint(session_id, {
          label,
          ttlSeconds: ttl_seconds,
          idempotencyKey: idempotency_key,
          timeoutMs: timeout_ms ?? defaultTimeoutMs,
          mode: "explicit",
        }),
      ),
  );

  server.registerTool(
    "brawsr_get_checkpoint",
    {
      description: "Get one checkpoint by immutable checkpoint ID.",
      inputSchema: z.object({ checkpoint_id: identifier }).strict(),
      outputSchema: resultSchema,
    },
    async ({ checkpoint_id }) =>
      invoke(() => client.getCheckpoint(checkpoint_id)),
  );

  server.registerTool(
    "brawsr_list_checkpoints",
    {
      description: "List one bounded page of checkpoints for a session.",
      inputSchema: z
        .object({
          session_id: identifier,
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().min(1).max(4096).optional(),
          lifecycle: z.string().min(1).max(64).optional(),
          durability: z.string().min(1).max(64).optional(),
        })
        .strict(),
      outputSchema: resultSchema,
    },
    async ({ session_id, limit, cursor, lifecycle, durability }) =>
      invoke(() =>
        client.listCheckpoints(session_id, {
          limit,
          cursor,
          lifecycle,
          durability,
        }),
      ),
  );

  server.registerTool(
    "brawsr_delete_checkpoint",
    {
      description:
        "Delete one checkpoint and wait if the server admits asynchronous cleanup.",
      inputSchema: z
        .object({ checkpoint_id: identifier, timeout_ms: timeoutMs })
        .strict(),
      outputSchema: resultSchema,
    },
    async ({ checkpoint_id, timeout_ms }) =>
      invoke(async () => {
        await client.deleteCheckpoint(checkpoint_id, {
          timeoutMs: timeout_ms ?? defaultTimeoutMs,
        });
        return { checkpoint_id, deleted: true };
      }),
  );

  server.registerTool(
    "brawsr_rewind",
    {
      description:
        "Rewind browser state and wait to a bounded terminal result. This does not undo server-side website effects; discard stale browser/CDP handles and reconnect.",
      inputSchema: z
        .object({
          ...selectorShape,
          session_id: identifier,
          idempotency_key: idempotencyKey,
          timeout_ms: timeoutMs,
        })
        .strict()
        .refine(hasOneSelector, {
          message: "exactly one of checkpoint_id or label is required",
        }),
      outputSchema: resultSchema,
    },
    async ({ session_id, checkpoint_id, label, idempotency_key, timeout_ms }) =>
      invoke(() =>
        client.rewind(session_id, checkpoint_id ?? label!, {
          idempotencyKey: idempotency_key,
          timeoutMs: timeout_ms ?? defaultTimeoutMs,
        }),
      ),
  );

  server.registerTool(
    "brawsr_fork",
    {
      description:
        "Fork one checkpoint into ordered peer sessions and wait for the complete set. Children are independent peers, not winners/losers; cleanup is explicit and there is no browser-state merge.",
      inputSchema: z
        .object({
          ...selectorShape,
          session_id: identifier,
          n: z.number().int().min(1).max(10),
          ttl_seconds: z.number().int().positive().optional(),
          idempotency_key: idempotencyKey,
          timeout_ms: timeoutMs,
        })
        .strict()
        .refine(hasOneSelector, {
          message: "exactly one of checkpoint_id or label is required",
        }),
      outputSchema: resultSchema,
    },
    async ({
      session_id,
      checkpoint_id,
      label,
      n,
      ttl_seconds,
      idempotency_key,
      timeout_ms,
    }) =>
      invoke(() =>
        client.fork(session_id, checkpoint_id ?? label!, {
          n,
          ttlSeconds: ttl_seconds,
          idempotencyKey: idempotency_key,
          timeoutMs: timeout_ms ?? defaultTimeoutMs,
        }),
      ),
  );

  server.registerTool(
    "brawsr_get_operation",
    {
      description: "Get a durable operation for cross-process recovery.",
      inputSchema: z.object({ operation_id: identifier }).strict(),
      outputSchema: resultSchema,
    },
    async ({ operation_id }) => invoke(() => client.getOperation(operation_id)),
  );

  server.registerTool(
    "brawsr_wait_operation",
    {
      description:
        "Resume bounded waiting for a durable operation. A local timeout never cancels server work.",
      inputSchema: z
        .object({ operation_id: identifier, timeout_ms: timeoutMs })
        .strict(),
      outputSchema: resultSchema,
    },
    async ({ operation_id, timeout_ms }) =>
      invoke(() =>
        client.waitOperation(operation_id, {
          timeoutMs: timeout_ms ?? defaultTimeoutMs,
        }),
      ),
  );

  return server;
}

async function invoke(effect: () => unknown | Promise<unknown>) {
  try {
    const result = await effect();
    return toolResult({ result: toJsonValue(result) });
  } catch (error) {
    const structuredContent = { result: safeError(error) };
    return {
      ...toolResult(structuredContent),
      isError: true,
    };
  }
}

function toolResult(structuredContent: { result: unknown }) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function safeError(error: unknown): Record<string, unknown> {
  if (
    error instanceof BrawsrWaitTimeoutError ||
    error instanceof BrawsrWaitCancelledError
  ) {
    return {
      error: {
        code:
          error instanceof BrawsrWaitTimeoutError
            ? "wait_timeout"
            : "wait_cancelled",
        message: error.message,
        operation_id: error.operationId,
        idempotency_key: error.idempotencyKey,
        server_work_continues: true,
      },
    };
  }
  if (error instanceof BrawsrTransportError) {
    return {
      error: {
        code: "transport_outcome_unknown",
        message: error.message,
        operation_id: error.operationId,
        idempotency_key: error.idempotencyKey,
        server_work_may_continue: true,
      },
    };
  }
  if (error instanceof BrawsrApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        request_id: error.requestId,
        operation_id: error.operationId,
        retryable: error.retryable,
        retry_after_ms: error.retryAfterMs,
      },
    };
  }
  if (error instanceof BrawsrOperationError) {
    return {
      error: {
        code: error.operation.error?.code ?? "operation_failed",
        message: error.message,
        operation_id: error.operation.id,
        status: error.operation.status,
        stage: error.operation.stage,
        retryable: error.operation.error?.retryable ?? false,
        request_id: error.operation.error?.requestId,
      },
    };
  }
  return { error: { code: "internal_error", message: "brawsr tool failed" } };
}

function toJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
