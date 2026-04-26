#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { PaperclipApiClient } from "./client.js";
import { createPaperclipMcpServer } from "./index.js";
import {
  readConfigFromEnv,
  readHttpConfigFromEnv,
  type PaperclipMcpConfig,
  type PaperclipMcpHttpConfig,
} from "./config.js";
import { createToolDefinitions } from "./tools.js";

interface RateBucket {
  count: number;
  resetAt: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function writeJsonRpcError(res: ServerResponse, status: number, message: string) {
  writeJson(res, status, {
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  });
}

function isJsonRpcRequest(value: unknown, method: string): value is { id?: unknown; method: string } {
  return !!value && typeof value === "object" && (value as { method?: unknown }).method === method;
}

function createToolsListResult(config: PaperclipMcpConfig) {
  const client = new PaperclipApiClient(config);
  const tools = createToolDefinitions(client, {
    accessMode: config.accessMode,
    enableApiRequestTool: config.enableApiRequestTool,
  });

  return {
    tools: tools.map((tool) => {
      const objectSchema = normalizeObjectSchema(tool.schema.shape);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: objectSchema
          ? toJsonSchemaCompat(objectSchema, { strictUnions: true, pipeStrategy: "input" })
          : { type: "object", properties: {} },
        annotations: tool.annotations,
      };
    }),
  };
}

function sanitizeJsonRpcResponsePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;

  const rec = payload as Record<string, unknown>;
  const result = rec.result;
  if (!result || typeof result !== "object") return payload;

  const resultRec = result as Record<string, unknown>;
  if (!Array.isArray(resultRec.tools)) return payload;

  return {
    ...rec,
    result: {
      ...resultRec,
      tools: resultRec.tools.map((tool) => {
        if (!tool || typeof tool !== "object") return tool;
        const { execution: _execution, ...rest } = tool as Record<string, unknown>;
        return rest;
      }),
    },
  };
}

function installResponseSanitizer(res: ServerResponse) {
  const chunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encodingOrCallback as BufferEncoding | undefined));
      if (typeof encodingOrCallback === "function") encodingOrCallback();
      if (typeof callback === "function") callback();
      return true;
    }
    return originalWrite(chunk as never, encodingOrCallback as never, callback as never);
  }) as typeof res.write;

  res.end = ((chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encodingOrCallback as BufferEncoding | undefined));
    }

    if (chunks.length > 0) {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const sanitized = sanitizeJsonRpcResponsePayload(JSON.parse(raw));
        return originalEnd(JSON.stringify(sanitized), encodingOrCallback as BufferEncoding, callback as () => void);
      } catch {
        for (const buffered of chunks) {
          originalWrite(buffered);
        }
      }
    }
    return originalEnd(undefined, encodingOrCallback as BufferEncoding, callback as () => void);
  }) as typeof res.end;
}

function writeCorsPreflight(res: ServerResponse) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end();
}

function authenticate(req: IncomingMessage, res: ServerResponse, config: PaperclipMcpHttpConfig): boolean {
  if (!config.bearerToken || config.allowUnauthenticated) return true;

  const authorization = headerValue(req.headers.authorization);
  if (authorization === `Bearer ${config.bearerToken}`) return true;

  writeJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="paperclip-mcp"' });
  return false;
}

function requestPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return url.pathname.replace(/\/+$/, "") || "/";
}

function requestIp(req: IncomingMessage): string {
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  return forwarded?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

function checkRateLimit(buckets: Map<string, RateBucket>, key: string, config: PaperclipMcpHttpConfig) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.rateLimitWindowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > config.rateLimitMaxRequests) {
    throw new HttpError(429, "rate_limit_exceeded");
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new HttpError(413, "request_body_too_large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

export async function createHttpServer(
  paperclipConfig: PaperclipMcpConfig = readConfigFromEnv(),
  httpConfig: PaperclipMcpHttpConfig = readHttpConfigFromEnv(),
): Promise<Server> {
  const rateBuckets = new Map<string, RateBucket>();
  let activeRequests = 0;

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        writeCorsPreflight(res);
        return;
      }

      const path = requestPath(req);
      if (path === "/healthz") {
        writeJson(res, 200, {
          status: "ok",
          mode: "stateless",
          activeRequests,
          accessMode: paperclipConfig.accessMode,
        });
        return;
      }
      if (path !== httpConfig.path) {
        writeJson(res, 404, { error: "not_found" });
        return;
      }
      if (req.method !== "POST") {
        writeJsonRpcError(res, 405, "Method not allowed. Stateless MCP only accepts POST.");
        return;
      }
      if (!authenticate(req, res, httpConfig)) return;

      checkRateLimit(rateBuckets, requestIp(req), httpConfig);
      if (activeRequests >= httpConfig.maxConcurrentRequests) {
        writeJsonRpcError(res, 503, "MCP server is busy. Retry shortly.");
        return;
      }

      activeRequests += 1;
      try {
        const body = await readJsonBody(req, httpConfig.maxRequestBodyBytes);
        if (isJsonRpcRequest(body, "tools/list")) {
          writeJson(res, 200, {
            jsonrpc: "2.0",
            id: body.id ?? null,
            result: createToolsListResult(paperclipConfig),
          });
          return;
        }

        installResponseSanitizer(res);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const { server: mcpServer } = createPaperclipMcpServer(paperclipConfig);
        transport.onerror = (error) => {
          console.error("Paperclip MCP HTTP transport error:", error);
        };
        await mcpServer.connect(transport);
        res.on("close", () => {
          void transport.close();
          void mcpServer.close();
        });
        await transport.handleRequest(req, res, body);
      } finally {
        activeRequests -= 1;
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Internal server error";
      console.error("Paperclip MCP HTTP request failed:", error);
      if (!res.headersSent) writeJsonRpcError(res, status, message);
    }
  });

  server.requestTimeout = paperclipConfig.apiRequestTimeoutMs + 5_000;
  server.headersTimeout = server.requestTimeout + 1_000;

  return server;
}

export async function runHttpServer(
  paperclipConfig: PaperclipMcpConfig = readConfigFromEnv(),
  httpConfig: PaperclipMcpHttpConfig = readHttpConfigFromEnv(),
) {
  const server = await createHttpServer(paperclipConfig, httpConfig);
  await new Promise<void>((resolve) => {
    server.listen(httpConfig.port, httpConfig.host, resolve);
  });
  console.error(
    `Paperclip MCP HTTP server listening at http://${httpConfig.host}:${httpConfig.port}${httpConfig.path} ` +
      `(mode=stateless access=${paperclipConfig.accessMode} concurrency=${httpConfig.maxConcurrentRequests})`,
  );
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runHttpServer().catch((error) => {
    console.error("Failed to start Paperclip MCP HTTP server:", error);
    process.exit(1);
  });
}
