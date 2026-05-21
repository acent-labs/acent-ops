const RESULT_CONTRACT_VERSION = "m2.paperclip_async.result.v1";
const RESULT_MARKER_PREFIX = "<!-- acent-flow:paperclip-result";

type PaperclipRunStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
type PaperclipAsyncStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed";
type PaperclipIntent = "triage" | "prepare_reply" | "support_draft";

export interface AcentFlowPaperclipResultQuery {
  runId: string;
  idempotencyKey: string;
  tenantId: string;
  freshdeskDomain: string;
  platform: "freshdesk";
  ticketId: string;
  intent: PaperclipIntent;
}

export interface AcentFlowPaperclipRunInput {
  id: string;
  status: string;
  resultJson?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  errorCode?: string | null;
}

export interface AcentFlowPaperclipAsyncResult {
  contract_version: typeof RESULT_CONTRACT_VERSION;
  workflow_id: string;
  run_id: string;
  tenant_id: string;
  platform: "freshdesk";
  freshdesk_domain: string;
  ticket_id: string;
  intent: PaperclipIntent;
  idempotency_key: string;
  status: PaperclipAsyncStatus;
  support_draft_ko?: string;
  blocker_notes?: string[];
  private_note_body?: string;
  result_marker?: string;
  error_code?: string;
  error_message?: string;
  created_at?: string;
  updated_at: string;
}

export function parseAcentFlowPaperclipResultQuery(query: Record<string, unknown>): AcentFlowPaperclipResultQuery {
  const runId = readQueryString(query.run_id ?? query.runId);
  const idempotencyKey = readQueryString(query.idempotency_key ?? query.idempotencyKey);
  const parsedKey = parseIdempotencyKey(idempotencyKey);
  const tenantId = readQueryString(query.tenant_id ?? query.tenantId) || parsedKey.tenantId;
  const freshdeskDomain = readQueryString(query.freshdesk_domain ?? query.freshdeskDomain);
  const platform = readQueryString(query.platform) || parsedKey.platform;
  const ticketId = readQueryString(query.ticket_id ?? query.ticketId) || parsedKey.ticketId;
  const intent = readQueryString(query.intent) || parsedKey.intent;

  if (!runId) {
    throw new Error("run_id is required");
  }
  if (!idempotencyKey) {
    throw new Error("idempotency_key is required");
  }
  if (!tenantId) {
    throw new Error("tenant_id is required");
  }
  if (platform !== "freshdesk") {
    throw new Error("platform must be freshdesk");
  }
  if (!freshdeskDomain) {
    throw new Error("freshdesk_domain is required");
  }
  if (!ticketId || !/^\d+$/.test(ticketId)) {
    throw new Error("ticket_id must be a numeric Freshdesk ticket id");
  }
  if (!isPaperclipIntent(intent)) {
    throw new Error("intent is invalid");
  }

  return {
    runId,
    idempotencyKey,
    tenantId,
    freshdeskDomain,
    platform: "freshdesk",
    ticketId,
    intent,
  };
}

export function buildAcentFlowPaperclipAsyncResult(
  run: AcentFlowPaperclipRunInput,
  query: AcentFlowPaperclipResultQuery,
  workflowId: string,
): AcentFlowPaperclipAsyncResult {
  const resultJson = asRecord(run.resultJson);
  const existing = pickExistingM2Result(resultJson);
  if (existing) {
    return {
      ...existing,
      workflow_id: String(existing.workflow_id || workflowId),
      run_id: String(existing.run_id || query.runId),
    } as AcentFlowPaperclipAsyncResult;
  }

  const status = mapRunStatus(run.status);
  const draft = pickDraftText(resultJson);
  const resultMarker = buildResultMarker({
    idempotencyKey: query.idempotencyKey,
    workflowId,
  });
  const base: AcentFlowPaperclipAsyncResult = {
    contract_version: RESULT_CONTRACT_VERSION,
    workflow_id: workflowId,
    run_id: query.runId,
    tenant_id: query.tenantId,
    platform: "freshdesk" as const,
    freshdesk_domain: query.freshdeskDomain,
    ticket_id: query.ticketId,
    intent: query.intent,
    idempotency_key: query.idempotencyKey,
    status,
    created_at: toIsoString(run.createdAt),
    updated_at: toIsoString(run.updatedAt ?? run.finishedAt) ?? new Date().toISOString(),
  };

  if (status === "completed") {
    if (!draft) {
      return {
        ...base,
        status: "failed",
        error_code: "PAPERCLIP_RESULT_EMPTY",
        error_message: "Paperclip run completed without a support_draft_ko/summary/message field for M2 wrapping.",
      };
    }
    return {
      ...base,
      support_draft_ko: draft,
      result_marker: resultMarker,
      private_note_body: `${resultMarker}\n\n${draft}`,
    };
  }

  if (status === "failed") {
    const errorMessage = readText(resultJson?.error) ?? readText(resultJson?.message);
    return {
      ...base,
      error_code: run.errorCode || "PAPERCLIP_RUN_FAILED",
      error_message: errorMessage || "Paperclip run did not complete successfully.",
      blocker_notes: [errorMessage || "Paperclip run did not complete successfully."],
    };
  }

  return base;
}

function pickExistingM2Result(resultJson: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!resultJson) return null;
  const nested = asRecord(resultJson.paperclip_async_result) ?? asRecord(resultJson.result);
  const candidate = nested ?? resultJson;
  return candidate.contract_version === RESULT_CONTRACT_VERSION ? candidate : null;
}

function parseIdempotencyKey(idempotencyKey: string | null): {
  tenantId: string;
  platform: string;
  ticketId: string;
  intent: string;
} {
  const parts = String(idempotencyKey || "").split(":");
  if (parts.length !== 6 || parts[0] !== "paperclip-async" || parts[1] !== "v1") {
    return { tenantId: "", platform: "", ticketId: "", intent: "" };
  }
  return {
    tenantId: parts[2] ?? "",
    platform: parts[3] ?? "",
    ticketId: parts[4] ?? "",
    intent: parts[5] ?? "",
  };
}

function isPaperclipIntent(value: string): value is PaperclipIntent {
  return value === "triage" || value === "prepare_reply" || value === "support_draft";
}

function mapRunStatus(status: string): PaperclipAsyncStatus {
  const normalized = String(status || "").toLowerCase() as PaperclipRunStatus;
  if (normalized === "queued") return "queued";
  if (normalized === "running") return "running";
  if (normalized === "succeeded") return "completed";
  if (normalized === "cancelled" || normalized === "failed" || normalized === "timed_out") return "failed";
  return "running";
}

function pickDraftText(resultJson: Record<string, unknown> | null): string | undefined {
  const value =
    readText(resultJson?.support_draft_ko)
    ?? readText(resultJson?.summary)
    ?? readText(resultJson?.message);
  return value ? value.slice(0, 18_000) : undefined;
}

function buildResultMarker(input: { idempotencyKey: string; workflowId: string }): string {
  return `${RESULT_MARKER_PREFIX} idempotency_key=${normalizeMarkerValue(input.idempotencyKey)} workflow_id=${normalizeMarkerValue(input.workflowId)} -->`;
}

function normalizeMarkerValue(value: string): string {
  return String(value || "").trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
}

function readQueryString(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
