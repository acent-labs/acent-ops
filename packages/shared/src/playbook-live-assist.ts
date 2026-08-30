export type PlaybookEntryStatus = "draft" | "approved" | "retired";
export type PlaybookPiiClass = "none" | "low" | "medium" | "high";

export interface PlaybookSource {
  refId: string;
  type: "faq" | "macro" | "policy" | "ticket_sample" | "internal_doc";
  title: string;
  urlOrPath?: string;
  quote: string;
}

export interface PlaybookEntry {
  id: string;
  title: string;
  intent: {
    name: string;
    description: string;
    examples: string[];
  };
  applicability: {
    keywords: string[];
    languages: string[];
  };
  approvedAnswer: {
    body: string;
    tone: "formal" | "friendly" | "concise";
    lastReviewedAt: string;
    reviewedBy: string;
  };
  sources: PlaybookSource[];
  forbidden: {
    phrases: string[];
    reasons: Record<string, string>;
  };
  escalation: {
    triggers: string[];
    routeTo: string;
    sla: string;
  };
  confidenceFloor: number;
  piiClass: PlaybookPiiClass;
  status: PlaybookEntryStatus;
  owner: string;
  tags: string[];
}

export interface PlaybookSourceDocument {
  id: string;
  title: string;
  kind: PlaybookSource["type"];
  body: string;
  urlOrPath?: string;
  tags?: string[];
  reviewedBy?: string;
  lastReviewedAt?: string;
}

export interface FreshdeskTicketContext {
  id: string;
  subject: string;
  description: string;
  priority?: number;
  tags?: string[];
  requesterHash?: string;
}

export interface LiveAssistDraftModelInput {
  ticket: FreshdeskTicketContext;
  entry: PlaybookEntry;
}

export interface LiveAssistDraftModel {
  generate(input: LiveAssistDraftModelInput): Promise<string> | string;
}

export interface LiveAssistPipelineOptions {
  model?: LiveAssistDraftModel;
  maxResults?: number;
}

export interface Citation {
  refId: string;
  title: string;
  urlOrPath?: string;
  quote: string;
}

export interface LiveAssistDraft {
  ticketId: string;
  entryId: string;
  draft: string;
  citations: Citation[];
  confidence: number;
  visibility: "private_note" | "draft_reply";
  blocked: false;
}

export interface LiveAssistBlockedDraft {
  ticketId: string;
  entryId: string;
  attemptedDraft: string;
  blocked: true;
  violations: Array<{
    phrase: string;
    reason: string;
  }>;
  citations: Citation[];
}

export type LiveAssistResult = LiveAssistDraft | LiveAssistBlockedDraft;

const DEFAULT_REVIEWER = "automation-developer";
const DEFAULT_REVIEWED_AT = "2026-06-03";

export function buildPlaybookEntriesFromSourceDocuments(
  documents: readonly PlaybookSourceDocument[],
): PlaybookEntry[] {
  return documents.map((document) => {
    const sections = parseKeyValueSections(document.body);
    const intentName = slugify(sections.intent ?? document.title);
    const approvedAnswer = sections.answer ?? sections.approved_answer ?? document.body.trim();
    const forbiddenPhrases = parseList(sections.forbidden);
    const escalationTriggers = parseList(sections.escalation);
    const keywords = Array.from(
      new Set([
        ...parseList(sections.keywords),
        ...tokenize(document.title),
        ...tokenize(sections.intent ?? ""),
      ]),
    ).slice(0, 12);

    return {
      id: document.id,
      title: document.title,
      intent: {
        name: intentName,
        description: sections.intent ?? document.title,
        examples: parseList(sections.examples),
      },
      applicability: {
        keywords,
        languages: parseList(sections.languages, ["ko"]),
      },
      approvedAnswer: {
        body: approvedAnswer,
        tone: parseTone(sections.tone),
        lastReviewedAt: document.lastReviewedAt ?? DEFAULT_REVIEWED_AT,
        reviewedBy: document.reviewedBy ?? DEFAULT_REVIEWER,
      },
      sources: [
        {
          refId: document.id,
          type: document.kind,
          title: document.title,
          urlOrPath: document.urlOrPath,
          quote: firstSentence(approvedAnswer),
        },
      ],
      forbidden: {
        phrases: forbiddenPhrases,
        reasons: Object.fromEntries(
          forbiddenPhrases.map((phrase) => [phrase, `Forbidden by source document ${document.id}.`]),
        ),
      },
      escalation: {
        triggers: escalationTriggers,
        routeTo: sections.route_to ?? "human-reviewer",
        sla: sections.sla ?? "1 business day",
      },
      confidenceFloor: parseConfidence(sections.confidence_floor),
      piiClass: parsePiiClass(sections.pii_class),
      status: "approved",
      owner: sections.owner ?? "product",
      tags: document.tags ?? parseList(sections.tags),
    };
  });
}

export async function runLiveAssistPipeline(
  ticket: FreshdeskTicketContext,
  playbook: readonly PlaybookEntry[],
  options: LiveAssistPipelineOptions = {},
): Promise<LiveAssistResult> {
  const [entry] = retrievePlaybookEntries(ticket, playbook, options.maxResults ?? 1);
  if (!entry) {
    throw new Error(`No approved playbook entry matched ticket ${ticket.id}`);
  }

  const model = options.model ?? deterministicDraftModel;
  const attemptedDraft = await model.generate({ ticket, entry });
  const citations = entry.sources.map((source) => ({
    refId: source.refId,
    title: source.title,
    urlOrPath: source.urlOrPath,
    quote: source.quote,
  }));
  const violations = findForbiddenViolations(attemptedDraft, entry);

  if (violations.length > 0) {
    return {
      ticketId: ticket.id,
      entryId: entry.id,
      attemptedDraft,
      blocked: true,
      violations,
      citations,
    };
  }

  return {
    ticketId: ticket.id,
    entryId: entry.id,
    draft: attemptedDraft,
    citations,
    confidence: entry.confidenceFloor,
    visibility: "private_note",
    blocked: false,
  };
}

export function retrievePlaybookEntries(
  ticket: FreshdeskTicketContext,
  playbook: readonly PlaybookEntry[],
  maxResults = 3,
): PlaybookEntry[] {
  const haystack = normalizeText(
    [ticket.subject, ticket.description, ...(ticket.tags ?? [])].join(" "),
  );

  return playbook
    .filter((entry) => entry.status === "approved")
    .map((entry) => ({
      entry,
      score: entry.applicability.keywords.reduce((score, keyword) => {
        const normalizedKeyword = normalizeText(keyword);
        return normalizedKeyword && haystack.includes(normalizedKeyword) ? score + 1 : score;
      }, 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ entry }) => entry);
}

export function findForbiddenViolations(
  draft: string,
  entry: PlaybookEntry,
): LiveAssistBlockedDraft["violations"] {
  const normalizedDraft = normalizeText(draft);
  return entry.forbidden.phrases
    .filter((phrase) => normalizedDraft.includes(normalizeText(phrase)))
    .map((phrase) => ({
      phrase,
      reason: entry.forbidden.reasons[phrase] ?? "Forbidden phrase matched this playbook entry.",
    }));
}

const deterministicDraftModel: LiveAssistDraftModel = {
  generate({ entry }) {
    return `${entry.approvedAnswer.body}\n\n근거: ${entry.sources.map((source) => source.refId).join(", ")}`;
  },
};

function parseKeyValueSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match) {
      currentKey = match[1].toLowerCase();
      sections[currentKey] = match[2].trim();
      continue;
    }
    if (currentKey && line.trim()) {
      sections[currentKey] = `${sections[currentKey]}\n${line.trim()}`.trim();
    }
  }

  return sections;
}

function parseList(value: string | undefined, fallback: string[] = []): string[] {
  if (!value) return fallback;
  return value
    .split(/\n|,/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function parseTone(value: string | undefined): PlaybookEntry["approvedAnswer"]["tone"] {
  if (value === "friendly" || value === "concise") return value;
  return "formal";
}

function parsePiiClass(value: string | undefined): PlaybookPiiClass {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "none";
}

function parseConfidence(value: string | undefined): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return 0.8;
}

function firstSentence(value: string): string {
  return value.split(/[.!?。]\s/)[0]?.trim() || value.trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function slugify(value: string): string {
  const slug = tokenize(value).join("-").toLowerCase();
  return slug || "playbook-entry";
}
