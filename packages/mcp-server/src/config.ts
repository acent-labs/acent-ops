export interface PaperclipMcpConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string | null;
  agentId: string | null;
  runId: string | null;
  accessMode: PaperclipMcpAccessMode;
  apiRequestTimeoutMs: number;
  enableApiRequestTool: boolean;
}

export type PaperclipMcpAccessMode = "read_only" | "read_write";

export interface PaperclipMcpHttpConfig {
  host: string;
  port: number;
  path: string;
  bearerToken: string | null;
  allowUnauthenticated: boolean;
  maxConcurrentRequests: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  maxRequestBodyBytes: number;
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseAccessMode(value: string | undefined): PaperclipMcpAccessMode {
  const normalized = nonEmpty(value);
  if (!normalized) return "read_write";
  if (normalized === "read_only" || normalized === "read_write") return normalized;
  throw new Error("PAPERCLIP_MCP_ACCESS_MODE must be read_only or read_write");
}

function parsePort(value: string | undefined): number {
  const raw = nonEmpty(value);
  if (!raw) return 8787;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("PAPERCLIP_MCP_HTTP_PORT must be a valid TCP port");
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  const raw = nonEmpty(value);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = nonEmpty(value);
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("Boolean env values must be true or false");
}

function normalizeHttpPath(value: string | undefined): string {
  const raw = nonEmpty(value) ?? "/mcp";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return stripTrailingSlash(prefixed) || "/mcp";
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function normalizeApiUrl(apiUrl: string): string {
  const trimmed = stripTrailingSlash(apiUrl.trim());
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaperclipMcpConfig {
  const apiUrl = nonEmpty(env.PAPERCLIP_API_URL);
  if (!apiUrl) {
    throw new Error("Missing PAPERCLIP_API_URL");
  }
  const apiKey = nonEmpty(env.PAPERCLIP_API_KEY);
  if (!apiKey) {
    throw new Error("Missing PAPERCLIP_API_KEY");
  }

  return {
    apiUrl: normalizeApiUrl(apiUrl),
    apiKey,
    companyId: nonEmpty(env.PAPERCLIP_COMPANY_ID),
    agentId: nonEmpty(env.PAPERCLIP_AGENT_ID),
    runId: nonEmpty(env.PAPERCLIP_RUN_ID),
    accessMode: parseAccessMode(env.PAPERCLIP_MCP_ACCESS_MODE),
    apiRequestTimeoutMs: parsePositiveInt(env.PAPERCLIP_MCP_API_TIMEOUT_MS, 5_000, "PAPERCLIP_MCP_API_TIMEOUT_MS"),
    enableApiRequestTool: parseBoolean(env.PAPERCLIP_MCP_ENABLE_API_REQUEST_TOOL, false),
  };
}

export function readHttpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaperclipMcpHttpConfig {
  const host = nonEmpty(env.PAPERCLIP_MCP_HTTP_HOST) ?? "127.0.0.1";
  const bearerToken = nonEmpty(env.PAPERCLIP_MCP_BEARER_TOKEN);
  const allowUnauthenticated = env.PAPERCLIP_MCP_ALLOW_UNAUTHENTICATED_HTTP === "true";

  if (!bearerToken && !allowUnauthenticated && !isLoopbackHost(host)) {
    throw new Error(
      "PAPERCLIP_MCP_BEARER_TOKEN is required when binding HTTP MCP to a non-loopback host. " +
        "Set PAPERCLIP_MCP_ALLOW_UNAUTHENTICATED_HTTP=true only behind another trusted auth layer.",
    );
  }

  return {
    host,
    port: parsePort(env.PAPERCLIP_MCP_HTTP_PORT),
    path: normalizeHttpPath(env.PAPERCLIP_MCP_HTTP_PATH),
    bearerToken,
    allowUnauthenticated,
    maxConcurrentRequests: parsePositiveInt(
      env.PAPERCLIP_MCP_MAX_CONCURRENT_REQUESTS,
      4,
      "PAPERCLIP_MCP_MAX_CONCURRENT_REQUESTS",
    ),
    rateLimitWindowMs: parsePositiveInt(
      env.PAPERCLIP_MCP_RATE_LIMIT_WINDOW_MS,
      60_000,
      "PAPERCLIP_MCP_RATE_LIMIT_WINDOW_MS",
    ),
    rateLimitMaxRequests: parsePositiveInt(
      env.PAPERCLIP_MCP_RATE_LIMIT_MAX_REQUESTS,
      60,
      "PAPERCLIP_MCP_RATE_LIMIT_MAX_REQUESTS",
    ),
    maxRequestBodyBytes: parsePositiveInt(
      env.PAPERCLIP_MCP_MAX_REQUEST_BODY_BYTES,
      1_048_576,
      "PAPERCLIP_MCP_MAX_REQUEST_BODY_BYTES",
    ),
  };
}
