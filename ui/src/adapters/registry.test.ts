import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { UIAdapterModule } from "./types";
import {
  findUIAdapter,
  getUIAdapter,
  listUIAdapters,
  registerUIAdapter,
  unregisterUIAdapter,
} from "./registry";
import { processUIAdapter } from "./process";
import { SchemaConfigFields } from "./schema-config-fields";

const externalUIAdapter: UIAdapterModule = {
  type: "external_test",
  label: "External Test",
  parseStdoutLine: () => [],
  ConfigFields: () => null,
  buildAdapterConfig: () => ({}),
};

describe("ui adapter registry", () => {
  beforeEach(() => {
    unregisterUIAdapter("external_test");
  });

  afterEach(() => {
    unregisterUIAdapter("external_test");
  });

  it("registers adapters for lookup and listing", () => {
    registerUIAdapter(externalUIAdapter);

    expect(findUIAdapter("external_test")).toBe(externalUIAdapter);
    expect(getUIAdapter("external_test")).toBe(externalUIAdapter);
    expect(listUIAdapters().some((adapter) => adapter.type === "external_test")).toBe(true);
  });

  it("falls back to the process parser for unknown types after unregistering", () => {
    registerUIAdapter(externalUIAdapter);

    unregisterUIAdapter("external_test");

    expect(findUIAdapter("external_test")).toBeNull();
    const fallback = getUIAdapter("external_test");
    // Unknown types return a lazy-loading wrapper (for external adapters),
    // not the process adapter directly. The type is preserved.
    expect(fallback.type).toBe("external_test");
    // But it uses the schema-based config fields for external adapter forms.
    expect(fallback.ConfigFields).toBe(SchemaConfigFields);
  });

  it("maps Hermes create form values to the Hermes adapter config contract", () => {
    const hermes = getUIAdapter("hermes_local");

    expect(hermes.type).toBe("hermes_local");
    expect(hermes.buildAdapterConfig({
      adapterType: "hermes_local",
      cwd: "/tmp/work",
      instructionsFilePath: "/tmp/AGENTS.md",
      promptTemplate: "Work the issue.",
      model: "anthropic/claude-sonnet-4",
      thinkingEffort: "high",
      chrome: false,
      dangerouslySkipPermissions: false,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "/opt/bin/hermes",
      args: "",
      extraArgs: "--verbose, --checkpoints",
      envVars: "HERMES_LOG=debug",
      envBindings: {
        OPENROUTER_API_KEY: { type: "secret_ref", secretId: "secret-1" },
      },
      url: "",
      bootstrapPrompt: "",
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
    })).toMatchObject({
      cwd: "/tmp/work",
      hermesCommand: "/opt/bin/hermes",
      instructionsFilePath: "/tmp/AGENTS.md",
      promptTemplate: "Work the issue.",
      model: "anthropic/claude-sonnet-4",
      persistSession: true,
      timeoutSec: 300,
      extraArgs: ["--verbose", "--checkpoints", "--reasoning-effort", "high"],
      env: {
        HERMES_LOG: { type: "plain", value: "debug" },
        OPENROUTER_API_KEY: { type: "secret_ref", secretId: "secret-1" },
      },
    });
  });
});
