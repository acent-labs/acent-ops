import { spawnSync } from "node:child_process";
import type { AdapterModel } from "./types.js";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { readConfigFile } from "../config-file.js";

const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const OPENAI_MODELS_TIMEOUT_MS = 5000;
const CODEX_MODELS_CACHE_TTL_MS = 60_000;
const CODEX_MODELS_TIMEOUT_MS = 5000;
const CODEX_MODELS_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

type CodexModelsCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  hasError: boolean;
};

let cached: { cacheKey: string; expiresAt: number; models: AdapterModel[] } | null = null;

function fingerprint(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-6)}`;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function mergedWithFallback(models: AdapterModel[]): AdapterModel[] {
  return dedupeModels([
    ...models,
    ...codexFallbackModels,
  ]).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

function resolveCodexCommand(): string {
  const envCommand = process.env.PAPERCLIP_CODEX_COMMAND?.trim();
  return envCommand || "codex";
}

function defaultCodexModelsRunner(): CodexModelsCommandResult {
  const result = spawnSync(resolveCodexCommand(), ["debug", "models"], {
    encoding: "utf8",
    timeout: CODEX_MODELS_TIMEOUT_MS,
    maxBuffer: CODEX_MODELS_MAX_BUFFER_BYTES,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    hasError: Boolean(result.error),
  };
}

let codexModelsRunner: () => CodexModelsCommandResult = defaultCodexModelsRunner;

export function parseCodexDebugModelsOutput(stdout: string): AdapterModel[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  let rawModels: unknown[] = [];
  if (Array.isArray(parsed)) {
    rawModels = parsed;
  } else if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { models?: unknown }).models)) {
    rawModels = (parsed as { models: unknown[] }).models;
  }
  const models: AdapterModel[] = [];
  for (const item of rawModels) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const visibility = typeof record.visibility === "string" ? record.visibility.trim().toLowerCase() : "";
    if (visibility === "hide") continue;

    const rawId = typeof record.slug === "string"
      ? record.slug
      : typeof record.id === "string"
        ? record.id
        : typeof record.model === "string"
          ? record.model
          : "";
    const id = rawId.trim();
    if (!id) continue;
    const displayName = typeof record.display_name === "string" ? record.display_name.trim() : "";
    models.push({ id, label: displayName || id });
  }

  return dedupeModels(models);
}

function fetchCodexCliModels(): AdapterModel[] {
  const result = codexModelsRunner();
  if (result.hasError && !result.stdout.trim() && !result.stderr.trim()) {
    return [];
  }
  if ((result.status ?? 1) !== 0) {
    return [];
  }
  return parseCodexDebugModelsOutput(result.stdout);
}

function resolveOpenAiApiKey(): string | null {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  const config = readConfigFile();
  if (config?.llm?.provider !== "openai") return null;
  const configKey = config.llm.apiKey?.trim();
  return configKey && configKey.length > 0 ? configKey : null;
}

async function fetchOpenAiModels(apiKey: string): Promise<AdapterModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: unknown };
    const data = Array.isArray(payload.data) ? payload.data : [];
    const models: AdapterModel[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || id.trim().length === 0) continue;
      models.push({ id, label: id });
    }
    return dedupeModels(models);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCodexModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const forceRefresh = options?.forceRefresh === true;
  const command = resolveCodexCommand();
  const apiKey = resolveOpenAiApiKey();
  const fallback = dedupeModels(codexFallbackModels);
  const now = Date.now();
  const keyFingerprint = apiKey ? fingerprint(apiKey) : "no-openai-key";
  const cacheKey = `${command}:${keyFingerprint}`;
  if (!forceRefresh && cached && cached.cacheKey === cacheKey && cached.expiresAt > now) {
    return cached.models;
  }

  const cliModels = fetchCodexCliModels();
  if (cliModels.length > 0) {
    const models = mergedWithFallback(cliModels);
    cached = {
      cacheKey,
      expiresAt: now + CODEX_MODELS_CACHE_TTL_MS,
      models,
    };
    return models;
  }

  if (!apiKey) return fallback;

  const fetched = await fetchOpenAiModels(apiKey);
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = {
      cacheKey,
      expiresAt: now + CODEX_MODELS_CACHE_TTL_MS,
      models: merged,
    };
    return merged;
  }

  if (cached && cached.cacheKey === cacheKey && cached.models.length > 0) {
    return cached.models;
  }

  return fallback;
}

export async function listCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels();
}

export async function refreshCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels({ forceRefresh: true });
}

export function resetCodexModelsCacheForTests() {
  cached = null;
  codexModelsRunner = defaultCodexModelsRunner;
}

export function setCodexModelsRunnerForTests(runner: (() => CodexModelsCommandResult) | null) {
  codexModelsRunner = runner ?? defaultCodexModelsRunner;
}
