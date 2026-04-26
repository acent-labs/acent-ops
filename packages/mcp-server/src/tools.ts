import { z } from "zod";
import {
  addIssueCommentSchema,
  checkoutIssueSchema,
  createApprovalSchema,
  createIssueSchema,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  updateIssueSchema,
  upsertIssueDocumentSchema,
  linkIssueApprovalSchema,
} from "@paperclipai/shared";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { PaperclipApiClient } from "./client.js";
import type { PaperclipMcpAccessMode } from "./config.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  access: "read" | "write";
  annotations: ToolAnnotations;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

interface ToolOptions {
  access?: "read" | "write";
  annotations?: ToolAnnotations;
}

export interface CreateToolDefinitionsOptions {
  accessMode?: PaperclipMcpAccessMode;
  enableApiRequestTool?: boolean;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
  options: ToolOptions = {},
): ToolDefinition {
  const access = options.access ?? "read";
  return {
    name,
    description,
    schema,
    access,
    annotations: options.annotations ?? {
      readOnlyHint: access === "read",
      destructiveHint: false,
      idempotentHint: access === "read",
      openWorldHint: true,
    },
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

function parseOptionalJson(raw: string | undefined | null): unknown {
  if (!raw || raw.trim().length === 0) return undefined;
  return JSON.parse(raw);
}

const companyIdOptional = z.string().uuid().optional();
const agentIdOptional = z.string().uuid().optional();
const issueIdSchema = z.string().min(1);
const projectIdSchema = z.string().min(1);
const goalIdSchema = z.string().uuid();
const approvalIdSchema = z.string().uuid();
const documentKeySchema = z.string().trim().min(1).max(64);
const issueStatusSchema = z.enum(ISSUE_STATUSES);
const issuePrioritySchema = z.enum(ISSUE_PRIORITIES);

const listIssuesSchema = z.object({
  companyId: companyIdOptional,
  status: z.string().optional(),
  priority: issuePrioritySchema.optional(),
  projectId: z.string().uuid().optional(),
  assigneeAgentId: z.string().uuid().optional(),
  participantAgentId: z.string().uuid().optional(),
  assigneeUserId: z.string().optional(),
  touchedByUserId: z.string().optional(),
  inboxArchivedByUserId: z.string().optional(),
  unreadForUserId: z.string().optional(),
  labelId: z.string().uuid().optional(),
  executionWorkspaceId: z.string().uuid().optional(),
  originKind: z.string().optional(),
  originId: z.string().optional(),
  includeRoutineExecutions: z.boolean().optional(),
  excludeRoutineExecutions: z.boolean().optional(),
  q: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const listCommentsSchema = z.object({
  issueId: issueIdSchema,
  after: z.string().uuid().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const upsertDocumentToolSchema = z.object({
  issueId: issueIdSchema,
  key: documentKeySchema,
  title: z.string().trim().max(200).nullable().optional(),
  format: z.enum(["markdown"]).default("markdown"),
  body: z.string().max(524288),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  baseRevisionId: z.string().uuid().nullable().optional(),
});

const createIssueToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createIssueSchema);

const updateIssueToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(updateIssueSchema);

const checkoutIssueToolSchema = z.object({
  issueId: issueIdSchema,
  agentId: agentIdOptional,
  expectedStatuses: checkoutIssueSchema.shape.expectedStatuses.optional(),
});

const addCommentToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(addIssueCommentSchema);

const approvalDecisionSchema = z.object({
  approvalId: approvalIdSchema,
  action: z.enum(["approve", "reject", "requestRevision", "resubmit"]),
  decisionNote: z.string().optional(),
  payloadJson: z.string().optional(),
});

const createApprovalToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createApprovalSchema);

const apiRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1),
  jsonBody: z.string().optional(),
});

const taskIdToolSchema = z.object({
  taskId: issueIdSchema.describe("Paperclip issue UUID or identifier such as PAP-1234"),
});

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return [];
}

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function compactTaskItem(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const item = value as Record<string, unknown>;
  return {
    id: item.id,
    identifier: item.identifier,
    title: item.title,
    status: item.status,
    priority: item.priority,
    assigneeAgentId: item.assigneeAgentId,
    assigneeUserId: item.assigneeUserId,
    projectId: item.projectId,
    goalId: item.goalId,
    updatedAt: item.updatedAt,
    url: item.url,
  };
}

function filterByPriority(items: unknown[], priority: string | undefined): unknown[] {
  if (!priority) return items;
  return items.filter((item) => readStringField(item, "priority") === priority);
}

function filterByUpdatedSince(items: unknown[], sinceHours: number | undefined): unknown[] {
  if (!sinceHours) return items;
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  return items.filter((item) => {
    const updatedAt = readStringField(item, "updatedAt");
    if (!updatedAt) return false;
    const timestamp = Date.parse(updatedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function buildIssueListPath(companyId: string, input: Record<string, unknown>, ignoredKeys: string[] = []): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (key === "companyId" || ignoredKeys.includes(key) || value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return `/companies/${companyId}/issues${qs ? `?${qs}` : ""}`;
}

export function createToolDefinitions(
  client: PaperclipApiClient,
  options: CreateToolDefinitionsOptions = {},
): ToolDefinition[] {
  const tools = [
    makeTool(
      "paperclipMe",
      "Get the current authenticated Paperclip actor details",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me"),
    ),
    makeTool(
      "paperclipInboxLite",
      "Get the current authenticated agent inbox-lite assignment list",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me/inbox-lite"),
    ),
    makeTool(
      "paperclipListAgents",
      "List agents in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/agents`),
    ),
    makeTool(
      "paperclipGetAgent",
      "Get a single agent by id",
      z.object({ agentId: z.string().min(1), companyId: companyIdOptional }),
      async ({ agentId, companyId }) => {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}${qs}`);
      },
    ),
    makeTool(
      "paperclipListIssues",
      "List issues for a company with optional filters",
      listIssuesSchema,
      async (input) => {
        const companyId = client.resolveCompanyId(input.companyId);
        const result = await client.requestJson("GET", buildIssueListPath(companyId, input, ["priority"]));
        if (!input.priority) return result;
        const items = filterByPriority(extractItems(result), input.priority);
        return Array.isArray(result) ? items : { ...(result as Record<string, unknown>), items };
      },
    ),
    makeTool(
      "paperclipGetTask",
      "Get one Paperclip task. In Paperclip, tasks are issues.",
      taskIdToolSchema.extend({
        latestCommentsLimit: z.number().int().positive().max(20).optional().default(5),
      }),
      async ({ taskId, latestCommentsLimit }) => {
        const [task, latestComments] = await Promise.all([
          client.requestJson("GET", `/issues/${encodeURIComponent(taskId)}`),
          client.requestJson(
            "GET",
            `/issues/${encodeURIComponent(taskId)}/comments?order=desc&limit=${latestCommentsLimit}`,
          ),
        ]);
        return { task, latestComments };
      },
    ),
    makeTool(
      "paperclipSearchTasks",
      "Search Paperclip tasks with common human-facing filters",
      z.object({
        companyId: companyIdOptional,
        query: z.string().optional(),
        status: issueStatusSchema.optional(),
        assigneeAgentId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        priority: issuePrioritySchema.optional(),
        limit: z.number().int().positive().max(100).optional().default(20),
      }),
      async ({ companyId, query, status, assigneeAgentId, projectId, priority, limit }) => {
        const resolvedCompanyId = client.resolveCompanyId(companyId);
        const result = await client.requestJson(
          "GET",
          buildIssueListPath(resolvedCompanyId, {
            q: query,
            status,
            assigneeAgentId,
            projectId,
            limit,
          }),
        );
        const items = filterByPriority(extractItems(result), priority)
          .slice(0, limit)
          .map(compactTaskItem);
        return { items };
      },
    ),
    makeTool(
      "paperclipListRecentTasks",
      "List recently updated Paperclip tasks",
      z.object({
        companyId: companyIdOptional,
        projectId: z.string().uuid().optional(),
        sinceHours: z.number().int().positive().max(24 * 30).optional().default(24),
        limit: z.number().int().positive().max(100).optional().default(20),
      }),
      async ({ companyId, projectId, sinceHours, limit }) => {
        const resolvedCompanyId = client.resolveCompanyId(companyId);
        const result = await client.requestJson(
          "GET",
          buildIssueListPath(resolvedCompanyId, {
            projectId,
            limit: Math.max(limit * 2, limit),
          }),
        );
        const items = filterByUpdatedSince(extractItems(result), sinceHours)
          .slice(0, limit)
          .map(compactTaskItem);
        return { items };
      },
    ),
    makeTool(
      "paperclipGetIssue",
      "Get a single issue by UUID or identifier",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}`),
    ),
    makeTool(
      "paperclipGetHeartbeatContext",
      "Get compact heartbeat context for an issue",
      z.object({ issueId: issueIdSchema, wakeCommentId: z.string().uuid().optional() }),
      async ({ issueId, wakeCommentId }) => {
        const qs = wakeCommentId ? `?wakeCommentId=${encodeURIComponent(wakeCommentId)}` : "";
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/heartbeat-context${qs}`);
      },
    ),
    makeTool(
      "paperclipListComments",
      "List issue comments with incremental options",
      listCommentsSchema,
      async ({ issueId, after, order, limit }) => {
        const params = new URLSearchParams();
        if (after) params.set("after", after);
        if (order) params.set("order", order);
        if (limit) params.set("limit", String(limit));
        const qs = params.toString();
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "paperclipGetComment",
      "Get a specific issue comment by id",
      z.object({ issueId: issueIdSchema, commentId: z.string().uuid() }),
      async ({ issueId, commentId }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(commentId)}`),
    ),
    makeTool(
      "paperclipListIssueApprovals",
      "List approvals linked to an issue",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/approvals`),
    ),
    makeTool(
      "paperclipListDocuments",
      "List issue documents",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents`),
    ),
    makeTool(
      "paperclipGetDocument",
      "Get one issue document by key",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`),
    ),
    makeTool(
      "paperclipListDocumentRevisions",
      "List revisions for an issue document",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson(
          "GET",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions`,
        ),
    ),
    makeTool(
      "paperclipListProjects",
      "List projects in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/projects`),
    ),
    makeTool(
      "paperclipGetProject",
      "Get a project by id or company-scoped short reference",
      z.object({ projectId: projectIdSchema, companyId: companyIdOptional }),
      async ({ projectId, companyId }) => {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
        return client.requestJson("GET", `/projects/${encodeURIComponent(projectId)}${qs}`);
      },
    ),
    makeTool(
      "paperclipListGoals",
      "List goals in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/goals`),
    ),
    makeTool(
      "paperclipGetGoal",
      "Get a goal by id",
      z.object({ goalId: goalIdSchema }),
      async ({ goalId }) => client.requestJson("GET", `/goals/${encodeURIComponent(goalId)}`),
    ),
    makeTool(
      "paperclipListApprovals",
      "List approvals in a company",
      z.object({ companyId: companyIdOptional, status: z.string().optional() }),
      async ({ companyId, status }) => {
        const qs = status ? `?status=${encodeURIComponent(status)}` : "";
        return client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/approvals${qs}`);
      },
    ),
    makeTool(
      "paperclipCreateApproval",
      "Create a board approval request, optionally linked to one or more issues",
      createApprovalToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId(companyId)}/approvals`, {
          body,
        }),
      { access: "write" },
    ),
    makeTool(
      "paperclipGetApproval",
      "Get an approval by id",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}`),
    ),
    makeTool(
      "paperclipGetApprovalIssues",
      "List issues linked to an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/issues`),
    ),
    makeTool(
      "paperclipListApprovalComments",
      "List comments for an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/comments`),
    ),
    makeTool(
      "paperclipCreateIssue",
      "Create a new issue",
      createIssueToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId(companyId)}/issues`, { body }),
      { access: "write" },
    ),
    makeTool(
      "paperclipUpdateIssue",
      "Patch an issue, optionally including a comment",
      updateIssueToolSchema,
      async ({ issueId, ...body }) =>
        client.requestJson("PATCH", `/issues/${encodeURIComponent(issueId)}`, { body }),
      { access: "write" },
    ),
    makeTool(
      "paperclipUpdateTaskStatus",
      "Update a Paperclip task status. In Paperclip, tasks are issues.",
      taskIdToolSchema.extend({
        status: issueStatusSchema,
        comment: z.string().min(1).optional(),
      }),
      async ({ taskId, status, comment }) => {
        const previous = await client.requestJson("GET", `/issues/${encodeURIComponent(taskId)}`);
        const updated = await client.requestJson("PATCH", `/issues/${encodeURIComponent(taskId)}`, {
          body: { status, comment },
        });
        return {
          success: true,
          taskId,
          oldStatus: readStringField(previous, "status"),
          newStatus: status,
          updated,
        };
      },
      { access: "write" },
    ),
    makeTool(
      "paperclipCheckoutIssue",
      "Checkout an issue for an agent",
      checkoutIssueToolSchema,
      async ({ issueId, agentId, expectedStatuses }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/checkout`, {
          body: {
            agentId: client.resolveAgentId(agentId),
            expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"],
          },
        }),
      { access: "write" },
    ),
    makeTool(
      "paperclipReleaseIssue",
      "Release an issue checkout",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/release`, { body: {} }),
      { access: "write" },
    ),
    makeTool(
      "paperclipAddComment",
      "Add a comment to an issue",
      addCommentToolSchema,
      async ({ issueId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/comments`, { body }),
      { access: "write" },
    ),
    makeTool(
      "paperclipAddTaskComment",
      "Add a comment to a Paperclip task. In Paperclip, tasks are issues.",
      taskIdToolSchema.extend({
        comment: z.string().min(1),
      }),
      async ({ taskId, comment }) => {
        const created = await client.requestJson("POST", `/issues/${encodeURIComponent(taskId)}/comments`, {
          body: { body: comment },
        });
        return { success: true, taskId, comment: created };
      },
      { access: "write" },
    ),
    makeTool(
      "paperclipUpsertIssueDocument",
      "Create or update an issue document",
      upsertDocumentToolSchema,
      async ({ issueId, key, ...body }) =>
        client.requestJson(
          "PUT",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`,
          { body },
        ),
      { access: "write" },
    ),
    makeTool(
      "paperclipRestoreIssueDocumentRevision",
      "Restore a prior revision of an issue document",
      z.object({
        issueId: issueIdSchema,
        key: documentKeySchema,
        revisionId: z.string().uuid(),
      }),
      async ({ issueId, key, revisionId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          { body: {} },
        ),
      { access: "write" },
    ),
    makeTool(
      "paperclipLinkIssueApproval",
      "Link an approval to an issue",
      z.object({ issueId: issueIdSchema }).merge(linkIssueApprovalSchema),
      async ({ issueId, approvalId }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/approvals`, {
          body: { approvalId },
        }),
      { access: "write" },
    ),
    makeTool(
      "paperclipUnlinkIssueApproval",
      "Unlink an approval from an issue",
      z.object({ issueId: issueIdSchema, approvalId: approvalIdSchema }),
      async ({ issueId, approvalId }) =>
        client.requestJson(
          "DELETE",
          `/issues/${encodeURIComponent(issueId)}/approvals/${encodeURIComponent(approvalId)}`,
        ),
      { access: "write" },
    ),
    makeTool(
      "paperclipApprovalDecision",
      "Approve, reject, request revision, or resubmit an approval",
      approvalDecisionSchema,
      async ({ approvalId, action, decisionNote, payloadJson }) => {
        const path =
          action === "approve"
            ? `/approvals/${encodeURIComponent(approvalId)}/approve`
            : action === "reject"
              ? `/approvals/${encodeURIComponent(approvalId)}/reject`
              : action === "requestRevision"
                ? `/approvals/${encodeURIComponent(approvalId)}/request-revision`
                : `/approvals/${encodeURIComponent(approvalId)}/resubmit`;

        const body =
          action === "resubmit"
            ? { payload: parseOptionalJson(payloadJson) ?? {} }
            : { decisionNote };

        return client.requestJson("POST", path, { body });
      },
      { access: "write" },
    ),
    makeTool(
      "paperclipAddApprovalComment",
      "Add a comment to an approval",
      z.object({ approvalId: approvalIdSchema, body: z.string().min(1) }),
      async ({ approvalId, body }) =>
        client.requestJson("POST", `/approvals/${encodeURIComponent(approvalId)}/comments`, {
          body: { body },
        }),
      { access: "write" },
    ),
    makeTool(
      "paperclipApiRequest",
      "Make a JSON request to an existing Paperclip /api endpoint for unsupported operations",
      apiRequestSchema,
      async ({ method, path, jsonBody }) => {
        if (!path.startsWith("/") || path.includes("..")) {
          throw new Error("path must start with / and be relative to /api, and must not contain '..'");
        }
        return client.requestJson(method, path, {
          body: parseOptionalJson(jsonBody),
        });
      },
      {
        access: "write",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
    ),
  ];

  return tools.filter((tool) => {
    if (options.accessMode === "read_only" && tool.access !== "read") return false;
    if (tool.name === "paperclipApiRequest" && options.enableApiRequestTool !== true) return false;
    return true;
  });
}
