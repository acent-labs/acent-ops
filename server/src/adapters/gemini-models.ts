import type { AdapterModel } from "./types.js";
import { models as geminiFallbackModels } from "@paperclipai/adapter-gemini-local";

const GEMINI_MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS_TIMEOUT_MS = 5000;
const GEMINI_MODELS_CACHE_TTL_MS = 60_000;

let cached: { keyFingerprint: string; expiresAt: number; models: AdapterModel[] } | null = null;

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
    ...geminiFallbackModels,
    ...models,
  ]);
}

function resolveGeminiApiKey(): string | null {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) return geminiKey;

  const googleKey = process.env.GOOGLE_API_KEY?.trim();
  return googleKey && googleKey.length > 0 ? googleKey : null;
}

function parseGeminiModelId(name: unknown, baseModelId: unknown): string | null {
  const raw = typeof baseModelId === "string" && baseModelId.trim()
    ? baseModelId.trim()
    : typeof name === "string" && name.startsWith("models/")
      ? name.slice("models/".length).trim()
      : "";
  if (!raw || !raw.startsWith("gemini-")) return null;
  return raw;
}

async function fetchGeminiModels(apiKey: string): Promise<AdapterModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_MODELS_TIMEOUT_MS);
  try {
    const url = new URL(GEMINI_MODELS_ENDPOINT);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "1000");

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];

    const payload = (await response.json()) as { models?: unknown };
    const data = Array.isArray(payload.models) ? payload.models : [];
    const models: AdapterModel[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as {
        name?: unknown;
        baseModelId?: unknown;
        displayName?: unknown;
        supportedGenerationMethods?: unknown;
      };
      const methods = Array.isArray(rec.supportedGenerationMethods)
        ? rec.supportedGenerationMethods
        : [];
      if (!methods.includes("generateContent")) continue;
      const id = parseGeminiModelId(rec.name, rec.baseModelId);
      if (!id) continue;
      const label = typeof rec.displayName === "string" && rec.displayName.trim()
        ? rec.displayName.trim()
        : id;
      models.push({ id, label });
    }
    return dedupeModels(models);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadGeminiModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const forceRefresh = options?.forceRefresh === true;
  const apiKey = resolveGeminiApiKey();
  const fallback = dedupeModels(geminiFallbackModels);
  if (!apiKey) return fallback;

  const now = Date.now();
  const keyFingerprint = fingerprint(apiKey);
  if (!forceRefresh && cached && cached.keyFingerprint === keyFingerprint && cached.expiresAt > now) {
    return cached.models;
  }

  const fetched = await fetchGeminiModels(apiKey);
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = {
      keyFingerprint,
      expiresAt: now + GEMINI_MODELS_CACHE_TTL_MS,
      models: merged,
    };
    return merged;
  }

  if (cached && cached.keyFingerprint === keyFingerprint && cached.models.length > 0) {
    return cached.models;
  }

  return fallback;
}

export async function listGeminiModels(): Promise<AdapterModel[]> {
  return loadGeminiModels();
}

export async function refreshGeminiModels(): Promise<AdapterModel[]> {
  return loadGeminiModels({ forceRefresh: true });
}

export function resetGeminiModelsCacheForTests() {
  cached = null;
}
