import type {
  AdapterModel,
  AdapterModelProfileDefinition,
  AdapterRuntime,
  AdapterExecutionResult,
  AdapterRuntimeCommandSpec,
  ServerAdapterModule,
} from "./types.js";
import {
  buildSandboxNpmInstallCommand,
  getAdapterSessionManagement,
} from "@paperclipai/adapter-utils";
import {
  execute as acpxExecute,
  testEnvironment as acpxTestEnvironment,
  sessionCodec as acpxSessionCodec,
  getConfigSchema as getAcpxConfigSchema,
  listAcpxSkills,
  syncAcpxSkills,
} from "@paperclipai/adapter-acpx-local/server";
import {
  agentConfigurationDoc as acpxAgentConfigurationDoc,
  models as acpxModels,
} from "@paperclipai/adapter-acpx-local";
import {
  execute as claudeExecute,
  listClaudeSkills,
  syncClaudeSkills,
  listClaudeModels,
  testEnvironment as claudeTestEnvironment,
  sessionCodec as claudeSessionCodec,
  getQuotaWindows as claudeGetQuotaWindows,
} from "@paperclipai/adapter-claude-local/server";
import {
  agentConfigurationDoc as claudeAgentConfigurationDoc,
  models as claudeModels,
  modelProfiles as claudeModelProfiles,
} from "@paperclipai/adapter-claude-local";
import {
  execute as codexExecute,
  listCodexSkills,
  syncCodexSkills,
  testEnvironment as codexTestEnvironment,
  sessionCodec as codexSessionCodec,
  getQuotaWindows as codexGetQuotaWindows,
} from "@paperclipai/adapter-codex-local/server";
import {
  agentConfigurationDoc as codexAgentConfigurationDoc,
  models as codexModels,
  modelProfiles as codexModelProfiles,
} from "@paperclipai/adapter-codex-local";
import {
  execute as cursorExecute,
  listCursorSkills,
  syncCursorSkills,
  testEnvironment as cursorTestEnvironment,
  sessionCodec as cursorSessionCodec,
} from "@paperclipai/adapter-cursor-local/server";
import {
  agentConfigurationDoc as cursorAgentConfigurationDoc,
  models as cursorModels,
  modelProfiles as cursorModelProfiles,
} from "@paperclipai/adapter-cursor-local";
import {
  execute as cursorCloudExecute,
  getConfigSchema as getCursorCloudConfigSchema,
  sessionCodec as cursorCloudSessionCodec,
  testEnvironment as cursorCloudTestEnvironment,
} from "@paperclipai/adapter-cursor-cloud/server";
import { agentConfigurationDoc as cursorCloudAgentConfigurationDoc } from "@paperclipai/adapter-cursor-cloud";
import {
  execute as geminiExecute,
  listGeminiSkills,
  syncGeminiSkills,
  testEnvironment as geminiTestEnvironment,
  sessionCodec as geminiSessionCodec,
} from "@paperclipai/adapter-gemini-local/server";
import {
  agentConfigurationDoc as geminiAgentConfigurationDoc,
  models as geminiModels,
  modelProfiles as geminiModelProfiles,
} from "@paperclipai/adapter-gemini-local";
import {
  execute as openCodeExecute,
  listOpenCodeSkills,
  syncOpenCodeSkills,
  testEnvironment as openCodeTestEnvironment,
  sessionCodec as openCodeSessionCodec,
  listOpenCodeModels,
} from "@paperclipai/adapter-opencode-local/server";
import {
  agentConfigurationDoc as openCodeAgentConfigurationDoc,
  models as openCodeModels,
  modelProfiles as openCodeModelProfiles,
} from "@paperclipai/adapter-opencode-local";
import {
  execute as openclawGatewayExecute,
  testEnvironment as openclawGatewayTestEnvironment,
} from "@paperclipai/adapter-openclaw-gateway/server";
import {
  agentConfigurationDoc as openclawGatewayAgentConfigurationDoc,
  models as openclawGatewayModels,
} from "@paperclipai/adapter-openclaw-gateway";
import { listCodexModels, refreshCodexModels } from "./codex-models.js";
import { listCursorModels } from "./cursor-models.js";
import {
  execute as piExecute,
  listPiSkills,
  syncPiSkills,
  testEnvironment as piTestEnvironment,
  sessionCodec as piSessionCodec,
  listPiModels,
} from "@paperclipai/adapter-pi-local/server";
import {
  agentConfigurationDoc as piAgentConfigurationDoc,
  modelProfiles as piModelProfiles,
} from "@paperclipai/adapter-pi-local";
import {
  execute as hermesExecute,
  testEnvironment as hermesTestEnvironment,
  sessionCodec as hermesSessionCodec,
  listSkills as hermesListSkills,
  syncSkills as hermesSyncSkills,
  detectModel as detectModelFromHermes,
} from "hermes-paperclip-adapter/server";
import {
  agentConfigurationDoc as hermesAgentConfigurationDoc,
  models as hermesModels,
} from "hermes-paperclip-adapter";
import { BUILTIN_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import { buildExternalAdapters } from "./plugin-loader.js";
import { getDisabledAdapterTypes } from "../services/adapter-plugin-store.js";
import { processAdapter } from "./process/index.js";
import { httpAdapter } from "./http/index.js";

function readConfiguredCommand(config: Record<string, unknown>, fallback: string): string {
  const value = typeof config.command === "string" ? config.command.trim() : "";
  return value.length > 0 ? value : fallback;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildNpmRuntimeCommandSpec(
  config: Record<string, unknown>,
  fallbackCommand: string,
  packageName: string,
): AdapterRuntimeCommandSpec {
  const command = readConfiguredCommand(config, fallbackCommand);
  const canSelfInstall = !hasPathSeparator(command) && command === fallbackCommand;
  const installLine = buildSandboxNpmInstallCommand(packageName);
  return {
    command,
    detectCommand: command,
    installCommand: canSelfInstall
      ? `if ! command -v ${shellQuote(command)} >/dev/null 2>&1; then ${installLine}; fi`
      : null,
  };
}

function buildCursorRuntimeCommandSpec(config: Record<string, unknown>): AdapterRuntimeCommandSpec {
  const command = readConfiguredCommand(config, "agent");
  return {
    command,
    detectCommand: command,
    installCommand: null,
  };
}

function normalizeHermesConfig<T extends { config?: unknown; agent?: unknown }>(ctx: T): T {
  const config =
    ctx && typeof ctx === "object" && "config" in ctx && ctx.config && typeof ctx.config === "object"
      ? (ctx.config as Record<string, unknown>)
      : null;
  const agent =
    ctx && typeof ctx === "object" && "agent" in ctx && ctx.agent && typeof ctx.agent === "object"
      ? (ctx.agent as Record<string, unknown>)
      : null;
  const agentAdapterConfig =
    agent?.adapterConfig && typeof agent.adapterConfig === "object"
      ? (agent.adapterConfig as Record<string, unknown>)
      : null;

  const configCommand =
    typeof config?.command === "string" && config.command.length > 0 ? config.command : undefined;
  const agentCommand =
    typeof agentAdapterConfig?.command === "string" && agentAdapterConfig.command.length > 0
      ? agentAdapterConfig.command
      : undefined;

  if (config && !config.hermesCommand && configCommand) {
    config.hermesCommand = configCommand;
  }
  if (agentAdapterConfig && !agentAdapterConfig.hermesCommand && agentCommand) {
    agentAdapterConfig.hermesCommand = agentCommand;
  }

  return ctx;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringRecord(value: unknown): Record<string, string> {
  const source = readObject(value);
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (typeof raw === "string") result[key] = raw;
  }
  return result;
}

function contextString(context: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const direct = readNonEmptyString(context[key]);
    if (direct) return direct;
  }
  return null;
}

function nestedContextString(
  context: Record<string, unknown>,
  parentKey: string,
  ...keys: string[]
): string | null {
  const parent = readObject(context[parentKey]);
  for (const key of keys) {
    const value = readNonEmptyString(parent[key]);
    if (value) return value;
  }
  return null;
}

function buildHermesTaskBody(context: Record<string, unknown>): string {
  const parts: string[] = [];
  const taskMarkdown = readNonEmptyString(context.paperclipTaskMarkdown);
  if (taskMarkdown) parts.push(taskMarkdown);

  const issue = readObject(context.paperclipIssue);
  if (!taskMarkdown && Object.keys(issue).length > 0) {
    const lines = ["Paperclip task context:"];
    const identifier = readNonEmptyString(issue.identifier);
    const title = readNonEmptyString(issue.title);
    const description = readNonEmptyString(issue.description);
    const id = readNonEmptyString(issue.id);
    if (identifier || title) lines.push(`- Issue: ${identifier ?? id ?? "unknown"}${title ? ` - ${title}` : ""}`);
    if (description) lines.push("", "Issue description:", "```text", description, "```");
    parts.push(lines.join("\n"));
  }

  const wakeComment = readObject(context.paperclipWakeComment);
  const wakeLatestComment = readObject(readObject(context.paperclipWake).latestComment);
  const wakeCommentBody = readNonEmptyString(wakeComment.body) ?? readNonEmptyString(wakeLatestComment.body);
  if (wakeCommentBody) {
    parts.push(["Latest wake comment:", "```text", wakeCommentBody, "```"].join("\n"));
  }

  const wake = readObject(context.paperclipWake);
  const comments = Array.isArray(wake.comments) ? wake.comments : [];
  if (!wakeCommentBody && comments.length > 0) {
    const renderedComments = comments
      .map((raw, index) => {
        const comment = readObject(raw);
        const body = readNonEmptyString(comment.body) ?? "";
        const createdAt = readNonEmptyString(comment.createdAt) ?? "unknown time";
        return `${index + 1}. ${createdAt}\n${body}`;
      })
      .filter((entry) => entry.trim().length > 0);
    if (renderedComments.length > 0) {
      parts.push(["Recent wake comments:", ...renderedComments].join("\n\n"));
    }
  }

  const continuation = readObject(readObject(context.paperclipWake).continuationSummary);
  const continuationBody = readNonEmptyString(continuation.body);
  if (continuationBody) {
    parts.push(["Continuation summary:", continuationBody].join("\n\n"));
  }

  return parts.join("\n\n").trim();
}

function buildHermesPromptTemplate(existingPromptTemplate: string | null): string {
  const basePrompt = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

Paperclip operating contract:
- Work on the assigned Paperclip issue first. Do not run a generic inbox sweep when an Issue ID is present.
- Use the API Base shown below for Paperclip calls.
- Use Authorization: Bearer $PAPERCLIP_API_KEY on every Paperclip API request.
- Use X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID on every Paperclip API request that writes or mutates data.
- Never use a board, browser, or local-board session for Paperclip API writes.
- Avoid shell patterns that pipe remote or API output into an interpreter.
- When the issue asks for an external write, perform it if the required credential environment variables or MCP tools are configured. If credentials/tools are missing, mark the issue blocked and name the missing binding.

Your Paperclip identity:
  Agent ID: {{agentId}}
  Company ID: {{companyId}}
  API Base: {{paperclipApiUrl}}
  Run ID: {{runId}}

{{#taskId}}
## Assigned Task

Issue ID: {{taskId}}
Title: {{taskTitle}}

{{taskBody}}

## Required workflow

1. Read the task context above and perform the requested work.
2. If you need more Paperclip context, use:
   curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "{{paperclipApiUrl}}/issues/{{taskId}}/heartbeat-context"
3. For comments or issue updates, include both Authorization and X-Paperclip-Run-Id headers.
4. When the work is complete, post a concise evidence comment and mark the issue done. If the work cannot proceed, mark it blocked with the exact missing owner/action.

## Freshdesk write path

If the task explicitly asks you to add a Freshdesk private note or private memo:
- Preferred path: call the configured MCP tool named freshdesk_add_private_note.
- Pass the Freshdesk ticket id, private note body, and private=true to the MCP tool.
- Do not implement Freshdesk writes inside Paperclip adapter code.
- Do not call Freshdesk REST directly in production by default.
- Direct Freshdesk REST fallback is allowed only when PAPERCLIP_ALLOW_DIRECT_FRESHDESK_REST=true is explicitly present and the MCP tool is unavailable:
  - endpoint: https://$FRESHDESK_DOMAIN/api/v2/tickets/<ticket_id>/notes
  - method: POST
  - auth: curl -u "$FRESHDESK_API_KEY:X"
  - body: {"body":"<memo html/text>","private":true}
- Do not print the API key.
- Record the Freshdesk ticket id, MCP tool name, and MCP/HTTP outcome in the Paperclip issue comment.
- If the MCP tool is unavailable and direct REST fallback is not explicitly enabled, mark the issue blocked instead of pretending the note was written.
{{/taskId}}

{{#commentId}}
## Wake Comment

You were woken by comment {{commentId}}. Address that comment before doing any older work.
{{/commentId}}

{{#noTask}}
## Heartbeat Wake

No assigned task was provided. Check your Paperclip inbox using Authorization, pick one actionable assigned issue, or report that no work is available.
{{/noTask}}`;

  if (!existingPromptTemplate) return basePrompt;
  return `${basePrompt}

## Additional agent instructions

${existingPromptTemplate}`;
}

const paperclipHermesAgentConfigurationDoc = `${hermesAgentConfigurationDoc}

## Paperclip write-capable runtime notes

Paperclip wraps Hermes with a managed heartbeat prompt that injects the assigned issue, wake comment,
run-scoped Paperclip JWT, and safe write instructions.

For Freshdesk private notes, bind the ACENT Flow Freshdesk MCP server to Hermes and use the
freshdesk_add_private_note tool as the preferred write path. Paperclip's Hermes adapter should pass
the task context and tool-use instruction to Hermes; it should not become the Freshdesk writer.

- freshdesk_add_private_note: preferred MCP tool for private-note writes

Direct REST fallback is not a production default. Enable it only with the explicit
PAPERCLIP_ALLOW_DIRECT_FRESHDESK_REST=true environment flag, and only when the MCP tool is
unavailable. If neither the MCP tool nor explicit fallback is available, the agent must mark the
issue blocked instead of claiming the write happened.
`;

function isValidHermesSessionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "from") return false;
  if (/^\d{8}_\d{6}_?$/.test(trimmed)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{10,}$/.test(trimmed);
}

function sanitizeHermesRuntime(runtime: AdapterRuntime): AdapterRuntime {
  const sessionParams = readObject(runtime.sessionParams);
  const sessionId = readNonEmptyString(sessionParams.sessionId) ?? readNonEmptyString(sessionParams.session_id);
  if (!sessionId) return runtime;
  if (isValidHermesSessionId(sessionId)) return runtime;
  return {
    ...runtime,
    sessionId: null,
    sessionParams: null,
    sessionDisplayId: null,
  };
}

function sanitizeHermesResult(result: AdapterExecutionResult): AdapterExecutionResult {
  const sessionParams = readObject(result.sessionParams);
  const sessionId =
    readNonEmptyString(sessionParams.sessionId) ??
    readNonEmptyString(sessionParams.session_id) ??
    readNonEmptyString(result.sessionId);
  if (!sessionId || isValidHermesSessionId(sessionId)) return result;

  const resultJson = readObject(result.resultJson);
  const nextResultJson =
    Object.keys(resultJson).length > 0
      ? {
          ...resultJson,
          session_id: null,
        }
      : result.resultJson;

  return {
    ...result,
    sessionId: null,
    sessionParams: null,
    sessionDisplayId: null,
    resultJson: nextResultJson,
    clearSession: true,
  };
}

function dedupeAdapterModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const result: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ ...model, id });
  }
  return result;
}

function prefixAdapterModelLabels(models: AdapterModel[], provider: "Claude" | "Codex"): AdapterModel[] {
  const prefix = `${provider}: `;
  return models.map((model) => ({
    ...model,
    label: model.label.startsWith(prefix) ? model.label : `${prefix}${model.label}`,
  }));
}

async function listAcpxModels(): Promise<AdapterModel[]> {
  const [claude, codex] = await Promise.all([
    listClaudeModels().catch(() => claudeModels),
    listCodexModels().catch(() => codexModels),
  ]);
  return dedupeAdapterModels([
    ...acpxModels,
    ...prefixAdapterModelLabels(claude, "Claude"),
    ...prefixAdapterModelLabels(codex, "Codex"),
  ]);
}

const claudeLocalAdapter: ServerAdapterModule = {
  type: "claude_local",
  execute: claudeExecute,
  testEnvironment: claudeTestEnvironment,
  listSkills: listClaudeSkills,
  syncSkills: syncClaudeSkills,
  sessionCodec: claudeSessionCodec,
  sessionManagement: getAdapterSessionManagement("claude_local") ?? undefined,
  models: claudeModels,
  modelProfiles: claudeModelProfiles,
  listModels: listClaudeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) =>
    buildNpmRuntimeCommandSpec(config, "claude", "@anthropic-ai/claude-code"),
  agentConfigurationDoc: claudeAgentConfigurationDoc,
  getQuotaWindows: claudeGetQuotaWindows,
};

const acpxLocalAdapter: ServerAdapterModule = {
  type: "acpx_local",
  execute: acpxExecute,
  testEnvironment: acpxTestEnvironment,
  listSkills: listAcpxSkills,
  syncSkills: syncAcpxSkills,
  sessionCodec: acpxSessionCodec,
  sessionManagement: getAdapterSessionManagement("acpx_local") ?? undefined,
  models: dedupeAdapterModels([
    ...prefixAdapterModelLabels(claudeModels, "Claude"),
    ...prefixAdapterModelLabels(codexModels, "Codex"),
  ]),
  listModels: listAcpxModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: acpxAgentConfigurationDoc,
  getConfigSchema: getAcpxConfigSchema,
};

const codexLocalAdapter: ServerAdapterModule = {
  type: "codex_local",
  execute: codexExecute,
  testEnvironment: codexTestEnvironment,
  listSkills: listCodexSkills,
  syncSkills: syncCodexSkills,
  sessionCodec: codexSessionCodec,
  sessionManagement: getAdapterSessionManagement("codex_local") ?? undefined,
  models: codexModels,
  modelProfiles: codexModelProfiles,
  listModels: listCodexModels,
  refreshModels: refreshCodexModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "codex", "@openai/codex"),
  agentConfigurationDoc: codexAgentConfigurationDoc,
  getQuotaWindows: codexGetQuotaWindows,
};

const cursorLocalAdapter: ServerAdapterModule = {
  type: "cursor",
  execute: cursorExecute,
  testEnvironment: cursorTestEnvironment,
  listSkills: listCursorSkills,
  syncSkills: syncCursorSkills,
  sessionCodec: cursorSessionCodec,
  sessionManagement: getAdapterSessionManagement("cursor") ?? undefined,
  models: cursorModels,
  modelProfiles: cursorModelProfiles,
  listModels: listCursorModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: buildCursorRuntimeCommandSpec,
  agentConfigurationDoc: cursorAgentConfigurationDoc,
};

const cursorCloudAdapter: ServerAdapterModule = {
  type: "cursor_cloud",
  execute: cursorCloudExecute,
  testEnvironment: cursorCloudTestEnvironment,
  sessionCodec: cursorCloudSessionCodec,
  sessionManagement: getAdapterSessionManagement("cursor_cloud") ?? undefined,
  models: [],
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: cursorCloudAgentConfigurationDoc,
  getConfigSchema: getCursorCloudConfigSchema,
};

const geminiLocalAdapter: ServerAdapterModule = {
  type: "gemini_local",
  execute: geminiExecute,
  testEnvironment: geminiTestEnvironment,
  listSkills: listGeminiSkills,
  syncSkills: syncGeminiSkills,
  sessionCodec: geminiSessionCodec,
  sessionManagement: getAdapterSessionManagement("gemini_local") ?? undefined,
  models: geminiModels,
  modelProfiles: geminiModelProfiles,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) =>
    buildNpmRuntimeCommandSpec(config, "gemini", "@google/gemini-cli"),
  agentConfigurationDoc: geminiAgentConfigurationDoc,
};

const openclawGatewayAdapter: ServerAdapterModule = {
  type: "openclaw_gateway",
  execute: openclawGatewayExecute,
  testEnvironment: openclawGatewayTestEnvironment,
  models: openclawGatewayModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: openclawGatewayAgentConfigurationDoc,
};

const openCodeLocalAdapter: ServerAdapterModule = {
  type: "opencode_local",
  execute: openCodeExecute,
  testEnvironment: openCodeTestEnvironment,
  listSkills: listOpenCodeSkills,
  syncSkills: syncOpenCodeSkills,
  sessionCodec: openCodeSessionCodec,
  models: openCodeModels,
  modelProfiles: openCodeModelProfiles,
  sessionManagement: getAdapterSessionManagement("opencode_local") ?? undefined,
  listModels: listOpenCodeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "opencode", "opencode-ai"),
  agentConfigurationDoc: openCodeAgentConfigurationDoc,
};

const piLocalAdapter: ServerAdapterModule = {
  type: "pi_local",
  execute: piExecute,
  testEnvironment: piTestEnvironment,
  listSkills: listPiSkills,
  syncSkills: syncPiSkills,
  sessionCodec: piSessionCodec,
  sessionManagement: getAdapterSessionManagement("pi_local") ?? undefined,
  models: [],
  modelProfiles: piModelProfiles,
  listModels: listPiModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) =>
    buildNpmRuntimeCommandSpec(config, "pi", "@mariozechner/pi-coding-agent"),
  agentConfigurationDoc: piAgentConfigurationDoc,
};

// hermes-paperclip-adapter v0.2.0 predates the authToken field; cast is
// intentional until hermes ships a matching AdapterExecutionContext type.
const executeHermesLocal = hermesExecute as unknown as ServerAdapterModule["execute"];

const hermesLocalAdapter: ServerAdapterModule = {
  type: "hermes_local",
  execute: async (ctx) => {
    const normalizedCtx = normalizeHermesConfig(ctx);
    if (!normalizedCtx.authToken) return executeHermesLocal(normalizedCtx);

    const existingConfig = (normalizedCtx.agent.adapterConfig ?? {}) as Record<string, unknown>;
    const existingEnv = readStringRecord(existingConfig.env);
    const explicitApiKey =
      typeof existingEnv.PAPERCLIP_API_KEY === "string" && existingEnv.PAPERCLIP_API_KEY.trim().length > 0;
    const promptTemplate =
      typeof existingConfig.promptTemplate === "string" && existingConfig.promptTemplate.trim().length > 0
        ? existingConfig.promptTemplate
        : null;
    const context = readObject(normalizedCtx.context);
    const paperclipWake = readObject(context.paperclipWake);
    const taskId =
      contextString(context, "taskId", "issueId", "taskKey") ??
      nestedContextString(context, "paperclipIssue", "id") ??
      nestedContextString(paperclipWake, "issue", "id");
    const taskTitle =
      nestedContextString(context, "paperclipIssue", "title") ??
      nestedContextString(paperclipWake, "issue", "title") ??
      contextString(context, "taskTitle", "issueTitle");
    const commentId =
      contextString(context, "wakeCommentId", "commentId") ??
      nestedContextString(context, "paperclipWakeComment", "id") ??
      nestedContextString(paperclipWake, "latestComment", "id");
    const wakeReason =
      contextString(context, "wakeReason", "retryReason") ??
      readNonEmptyString(paperclipWake.reason);
    const taskBody = buildHermesTaskBody(context);
    const wakePayloadJson =
      existingEnv.PAPERCLIP_WAKE_PAYLOAD_JSON ??
      (Object.keys(paperclipWake).length > 0 ? JSON.stringify(paperclipWake) : undefined);

    const patchedConfig: Record<string, unknown> = {
      ...existingConfig,
      ...(taskId ? { taskId } : {}),
      ...(taskTitle ? { taskTitle } : {}),
      ...(taskBody ? { taskBody } : {}),
      ...(commentId ? { commentId } : {}),
      ...(wakeReason ? { wakeReason } : {}),
      promptTemplate: buildHermesPromptTemplate(promptTemplate),
      env: {
        ...existingEnv,
        ...(!explicitApiKey ? { PAPERCLIP_API_KEY: normalizedCtx.authToken } : {}),
        PAPERCLIP_RUN_ID: normalizedCtx.runId,
        ...(taskId ? { PAPERCLIP_TASK_ID: taskId } : {}),
        ...(wakeReason ? { PAPERCLIP_WAKE_REASON: wakeReason } : {}),
        ...(commentId ? { PAPERCLIP_WAKE_COMMENT_ID: commentId } : {}),
        ...(wakePayloadJson ? { PAPERCLIP_WAKE_PAYLOAD_JSON: wakePayloadJson } : {}),
      },
    };

    const patchedCtx = {
      ...normalizedCtx,
      runtime: sanitizeHermesRuntime(normalizedCtx.runtime),
      config: {
        ...normalizedCtx.config,
        ...(taskId ? { taskId } : {}),
        ...(taskTitle ? { taskTitle } : {}),
        ...(taskBody ? { taskBody } : {}),
        ...(commentId ? { commentId } : {}),
        ...(wakeReason ? { wakeReason } : {}),
      },
      agent: {
        ...normalizedCtx.agent,
        adapterConfig: patchedConfig,
      },
    };

    return sanitizeHermesResult(await executeHermesLocal(patchedCtx));
  },
  testEnvironment: (ctx) => hermesTestEnvironment(normalizeHermesConfig(ctx) as never),
  sessionCodec: {
    deserialize(raw) {
      const params = hermesSessionCodec?.deserialize(raw) ?? null;
      const sessionId = readNonEmptyString(readObject(params).sessionId);
      return isValidHermesSessionId(sessionId) ? params : null;
    },
    serialize(params) {
      const serialized = hermesSessionCodec?.serialize(params) ?? null;
      const sessionId = readNonEmptyString(readObject(serialized).sessionId);
      return isValidHermesSessionId(sessionId) ? serialized : null;
    },
    getDisplayId(params) {
      const displayId = hermesSessionCodec?.getDisplayId?.(params) ?? null;
      return isValidHermesSessionId(displayId) ? displayId : null;
    },
  },
  listSkills: hermesListSkills,
  syncSkills: hermesSyncSkills,
  models: hermesModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: paperclipHermesAgentConfigurationDoc,
  detectModel: () => detectModelFromHermes(),
};

const adaptersByType = new Map<string, ServerAdapterModule>();

// For builtin types that are overridden by an external adapter, we keep the
// original builtin so it can be restored when the override is deactivated.
const builtinFallbacks = new Map<string, ServerAdapterModule>();

// Tracks which override types are currently deactivated (paused).  When
// paused, `getServerAdapter()` returns the builtin fallback instead of the
// external.  Persisted across reloads via the same disabled-adapters store.
const pausedOverrides = new Set<string>();

function registerBuiltInAdapters() {
  for (const adapter of [
    acpxLocalAdapter,
    claudeLocalAdapter,
    codexLocalAdapter,
    openCodeLocalAdapter,
    piLocalAdapter,
    cursorCloudAdapter,
    cursorLocalAdapter,
    geminiLocalAdapter,
    openclawGatewayAdapter,
    hermesLocalAdapter,
    processAdapter,
    httpAdapter,
  ]) {
    adaptersByType.set(adapter.type, adapter);
  }
}

registerBuiltInAdapters();

// ---------------------------------------------------------------------------
// Load external adapter plugins (e.g. droid_local)
//
// External adapter packages export createServerAdapter() which returns a
// ServerAdapterModule. When the module provides its own sessionManagement
// it is preserved; otherwise the host falls back to the built-in registry
// lookup (so externals that override a built-in type inherit the builtin's
// policy). This brings init-time registration to at-least-as-good behavior
// as the hot-install path (routes/adapters.ts:179 -> registerServerAdapter):
// both preserve module-provided sessionManagement, and init-time additionally
// applies the registry fallback for externals overriding a built-in type.
// ---------------------------------------------------------------------------

/** Cached sync wrapper — the store is a simple JSON file read, safe to call frequently. */
function getDisabledAdapterTypesFromStore(): string[] {
  return getDisabledAdapterTypes();
}

/**
 * Merge an external adapter module with host-provided session management.
 *
 * Module-provided `sessionManagement` takes precedence. When absent, fall
 * back to the hardcoded registry keyed by adapter type (so externals that
 * override a built-in — same `type` — inherit the builtin's policy). If
 * neither is available, `sessionManagement` remains `undefined`.
 *
 * Used by both the init-time IIFE below (external-adapter load pass on
 * server start) and the hot-install path in `routes/adapters.ts`
 * (`registerWithSessionManagement`), so the two load paths resolve
 * `sessionManagement` identically.
 */
export function resolveExternalAdapterRegistration(
  externalAdapter: ServerAdapterModule,
): ServerAdapterModule {
  return {
    ...externalAdapter,
    sessionManagement:
      externalAdapter.sessionManagement
        ?? getAdapterSessionManagement(externalAdapter.type)
        ?? undefined,
  };
}

/**
 * Load external adapters from the plugin store and hardcoded sources.
 * Called once at module initialization. The promise is exported so that
 * callers (e.g. assertKnownAdapterType, app startup) can await completion
 * and avoid racing against the loading window.
 */
const externalAdaptersReady: Promise<void> = (async () => {
  try {
    const externalAdapters = await buildExternalAdapters();
    for (const externalAdapter of externalAdapters) {
      const overriding = BUILTIN_ADAPTER_TYPES.has(externalAdapter.type);
      if (overriding) {
        console.log(
          `[paperclip] External adapter "${externalAdapter.type}" overrides built-in adapter`,
        );
        // Save the original builtin for later restoration.
        const existing = adaptersByType.get(externalAdapter.type);
        if (existing && !builtinFallbacks.has(externalAdapter.type)) {
          builtinFallbacks.set(externalAdapter.type, existing);
        }
      }
      adaptersByType.set(
        externalAdapter.type,
        resolveExternalAdapterRegistration(externalAdapter),
      );
    }
  } catch (err) {
    console.error("[paperclip] Failed to load external adapters:", err);
  }
})();

/**
 * Await this before validating adapter types to avoid race conditions
 * during server startup. External adapters are loaded asynchronously;
 * calling assertKnownAdapterType before this resolves will reject
 * valid external adapter types.
 */
export function waitForExternalAdapters(): Promise<void> {
  return externalAdaptersReady;
}

export function registerServerAdapter(adapter: ServerAdapterModule): void {
  if (BUILTIN_ADAPTER_TYPES.has(adapter.type) && !builtinFallbacks.has(adapter.type)) {
    const existing = adaptersByType.get(adapter.type);
    if (existing) {
      builtinFallbacks.set(adapter.type, existing);
    }
  }
  adaptersByType.set(adapter.type, adapter);
}

export function unregisterServerAdapter(type: string): void {
  if (type === processAdapter.type || type === httpAdapter.type) return;
  if (builtinFallbacks.has(type)) {
    pausedOverrides.delete(type);
    const fallback = builtinFallbacks.get(type);
    if (fallback) {
      adaptersByType.set(type, fallback);
    }
    return;
  }
  if (BUILTIN_ADAPTER_TYPES.has(type)) {
    return;
  }
  adaptersByType.delete(type);
}

export function requireServerAdapter(type: string): ServerAdapterModule {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) {
    throw new Error(`Unknown adapter type: ${type}`);
  }
  return adapter;
}

export function getServerAdapter(type: string): ServerAdapterModule {
  return findActiveServerAdapter(type) ?? processAdapter;
}

export async function listAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.listModels) {
    const discovered = await adapter.listModels();
    if (discovered.length > 0) return discovered;
  }
  return adapter.models ?? [];
}

export async function refreshAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.refreshModels) {
    const refreshed = await adapter.refreshModels();
    if (refreshed.length > 0) return refreshed;
  }
  if (adapter.listModels) {
    const discovered = await adapter.listModels();
    if (discovered.length > 0) return discovered;
  }
  return adapter.models ?? [];
}

export async function listAdapterModelProfiles(type: string): Promise<AdapterModelProfileDefinition[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.listModelProfiles) {
    const discovered = await adapter.listModelProfiles();
    if (discovered.length > 0) return discovered;
  }
  return adapter.modelProfiles ?? [];
}

export function listServerAdapters(): ServerAdapterModule[] {
  return Array.from(adaptersByType.values());
}

/**
 * List adapters excluding those that are disabled in settings.
 * Used for menus and agent creation flows — disabled adapters remain
 * functional for existing agents but hidden from selection.
 */
export function listEnabledServerAdapters(): ServerAdapterModule[] {
  const disabled = getDisabledAdapterTypesFromStore();
  const disabledSet = disabled.length > 0 ? new Set(disabled) : null;
  return disabledSet
    ? Array.from(adaptersByType.values()).filter((a) => !disabledSet.has(a.type))
    : Array.from(adaptersByType.values());
}

export async function detectAdapterModel(
  type: string,
): Promise<{ model: string; provider: string; source: string; candidates?: string[] } | null> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter?.detectModel) return null;
  const detected = await adapter.detectModel();
  if (!detected) return null;
  return {
    model: detected.model,
    provider: detected.provider,
    source: detected.source,
    ...(detected.candidates?.length ? { candidates: detected.candidates } : {}),
  };
}

// ---------------------------------------------------------------------------
// Override pause / resume
// ---------------------------------------------------------------------------

/**
 * Pause or resume an external override for a builtin adapter type.
 *
 * - `paused = true`  → subsequent calls to `getServerAdapter(type)` return
 *   the builtin fallback instead of the external adapter.  Already-running
 *   agent sessions are unaffected (they hold a reference to the module they
 *   started with).
 *
 * - `paused = false` → the external adapter is active again.
 *
 * Returns `true` if the state actually changed, `false` if the type is not
 * an override or was already in the requested state.
 */
export function setOverridePaused(type: string, paused: boolean): boolean {
  if (!builtinFallbacks.has(type)) return false;
  const wasPaused = pausedOverrides.has(type);
  if (paused && !wasPaused) {
    pausedOverrides.add(type);
    console.log(`[paperclip] Override paused for "${type}" — builtin adapter restored`);
    return true;
  }
  if (!paused && wasPaused) {
    pausedOverrides.delete(type);
    console.log(`[paperclip] Override resumed for "${type}" — external adapter active`);
    return true;
  }
  return false;
}

/** Check whether the external override for a builtin type is currently paused. */
export function isOverridePaused(type: string): boolean {
  return pausedOverrides.has(type);
}

/** Get the set of types whose overrides are currently paused. */
export function getPausedOverrides(): Set<string> {
  return pausedOverrides;
}

export function findServerAdapter(type: string): ServerAdapterModule | null {
  return adaptersByType.get(type) ?? null;
}

export function findActiveServerAdapter(type: string): ServerAdapterModule | null {
  if (pausedOverrides.has(type)) {
    const fallback = builtinFallbacks.get(type);
    if (fallback) return fallback;
  }
  return adaptersByType.get(type) ?? null;
}
