import { describe, expect, it } from "vitest";
import { readConfigFromEnv, readHttpConfigFromEnv } from "./config.js";

describe("paperclip MCP config", () => {
  it("uses conservative HTTP safety defaults", () => {
    const config = readHttpConfigFromEnv({
      PAPERCLIP_MCP_HTTP_HOST: "127.0.0.1",
    });

    expect(config.port).toBe(8787);
    expect(config.path).toBe("/mcp");
    expect(config.maxConcurrentRequests).toBe(4);
    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitMaxRequests).toBe(60);
    expect(config.maxRequestBodyBytes).toBe(1_048_576);
  });

  it("requires explicit HTTP auth when binding outside loopback", () => {
    expect(() =>
      readHttpConfigFromEnv({
        PAPERCLIP_MCP_HTTP_HOST: "0.0.0.0",
      }),
    ).toThrow("PAPERCLIP_MCP_BEARER_TOKEN is required");
  });

  it("reads Paperclip API timeout and access mode", () => {
    const config = readConfigFromEnv({
      PAPERCLIP_API_URL: "http://localhost:3100",
      PAPERCLIP_API_KEY: "token",
      PAPERCLIP_MCP_ACCESS_MODE: "read_only",
      PAPERCLIP_MCP_API_TIMEOUT_MS: "2500",
    });

    expect(config.apiUrl).toBe("http://localhost:3100/api");
    expect(config.accessMode).toBe("read_only");
    expect(config.apiRequestTimeoutMs).toBe(2500);
    expect(config.enableApiRequestTool).toBe(false);
  });

  it("can explicitly enable the generic API request tool", () => {
    const config = readConfigFromEnv({
      PAPERCLIP_API_URL: "http://localhost:3100",
      PAPERCLIP_API_KEY: "token",
      PAPERCLIP_MCP_ENABLE_API_REQUEST_TOOL: "true",
    });

    expect(config.enableApiRequestTool).toBe(true);
  });
});
