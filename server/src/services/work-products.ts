import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issueWorkProducts, issues, projects } from "@paperclipai/db";
import type { DeliverableListItem, IssueWorkProduct } from "@paperclipai/shared";

type IssueWorkProductRow = typeof issueWorkProducts.$inferSelect;
type DeliverableFilters = {
  status?: string;
  reviewState?: string;
  projectId?: string;
  provider?: string;
  kind?: string;
  channel?: string;
  limit?: number;
  offset?: number;
};

function toIssueWorkProduct(row: IssueWorkProductRow): IssueWorkProduct {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId ?? null,
    issueId: row.issueId,
    executionWorkspaceId: row.executionWorkspaceId ?? null,
    runtimeServiceId: row.runtimeServiceId ?? null,
    type: row.type as IssueWorkProduct["type"],
    provider: row.provider,
    externalId: row.externalId ?? null,
    title: row.title,
    url: row.url ?? null,
    status: row.status,
    reviewState: row.reviewState as IssueWorkProduct["reviewState"],
    isPrimary: row.isPrimary,
    healthStatus: row.healthStatus as IssueWorkProduct["healthStatus"],
    summary: row.summary ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdByRunId: row.createdByRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function workProductService(db: Db) {
  async function listDeliverablesForIssueIds(companyId: string, issueIds: string[], filters: DeliverableFilters = {}) {
    if (issueIds.length === 0) return [];
    const conditions = [
      eq(issueWorkProducts.companyId, companyId),
      inArray(issueWorkProducts.issueId, issueIds),
      isNull(issues.hiddenAt),
    ];
    if (filters.status) conditions.push(eq(issueWorkProducts.status, filters.status));
    if (filters.reviewState) conditions.push(eq(issueWorkProducts.reviewState, filters.reviewState));
    if (filters.projectId) conditions.push(eq(issues.projectId, filters.projectId));
    if (filters.provider) conditions.push(eq(issueWorkProducts.provider, filters.provider));
    if (filters.kind) {
      conditions.push(sql<boolean>`${issueWorkProducts.metadata}->>'deliverableKind' = ${filters.kind}`);
    }
    if (filters.channel) {
      conditions.push(sql<boolean>`${issueWorkProducts.metadata}->>'channel' = ${filters.channel}`);
    }

    const query = db
      .select({
        workProduct: issueWorkProducts,
        issue: {
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          parentId: issues.parentId,
        },
        project: {
          id: projects.id,
          name: projects.name,
        },
        ownerAgent: {
          id: agents.id,
          name: agents.name,
          role: agents.role,
          adapterType: agents.adapterType,
        },
      })
      .from(issueWorkProducts)
      .innerJoin(issues, eq(issueWorkProducts.issueId, issues.id))
      .leftJoin(projects, eq(issues.projectId, projects.id))
      .leftJoin(agents, eq(issues.assigneeAgentId, agents.id))
      .where(and(...conditions))
      .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt));

    const pagedQuery = typeof filters.offset === "number" && filters.offset > 0
      ? query.offset(filters.offset)
      : query;
    const rows = filters.limit ? await pagedQuery.limit(filters.limit) : await pagedQuery;
    return rows.map((row): DeliverableListItem => ({
      workProduct: toIssueWorkProduct(row.workProduct),
      issue: row.issue,
      project: row.project?.id && row.project.name
        ? { id: row.project.id, name: row.project.name }
        : null,
      ownerAgent: row.ownerAgent?.id && row.ownerAgent.name && row.ownerAgent.role && row.ownerAgent.adapterType
        ? {
          id: row.ownerAgent.id,
          name: row.ownerAgent.name,
          role: row.ownerAgent.role,
          adapterType: row.ownerAgent.adapterType,
        }
        : null,
    }));
  }

  async function collectDescendantIssueIds(companyId: string, rootIssueId: string) {
    const ids = [rootIssueId];
    let frontier = [rootIssueId];

    while (frontier.length > 0) {
      const rows = await db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(issues.parentId, frontier),
            isNull(issues.hiddenAt),
          ),
        );
      frontier = rows.map((row) => row.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }

    return ids;
  }

  return {
    listForIssue: async (issueId: string) => {
      const rows = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.issueId, issueId))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt));
      return rows.map(toIssueWorkProduct);
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },

    listForCompanyDeliverables: async (companyId: string, filters: DeliverableFilters = {}) => {
      const conditions = [eq(issues.companyId, companyId), isNull(issues.hiddenAt)];
      if (filters.projectId) conditions.push(eq(issues.projectId, filters.projectId));
      const issueRows = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(...conditions));
      const issueIds = issueRows.map((row) => row.id);
      return listDeliverablesForIssueIds(companyId, issueIds, filters);
    },

    listDeliverablesForIssue: async (
      issueId: string,
      options?: { includeDescendants?: boolean; filters?: DeliverableFilters },
    ) => {
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) return null;
      const issueIds = options?.includeDescendants
        ? await collectDescendantIssueIds(issue.companyId, issue.id)
        : [issue.id];
      return listDeliverablesForIssueIds(issue.companyId, issueIds, options?.filters ?? {});
    },

    createForIssue: async (issueId: string, companyId: string, data: Omit<typeof issueWorkProducts.$inferInsert, "issueId" | "companyId">) => {
      const row = await db.transaction(async (tx) => {
        if (data.isPrimary) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, companyId),
                eq(issueWorkProducts.issueId, issueId),
                eq(issueWorkProducts.type, data.type),
              ),
            );
        }
        return await tx
          .insert(issueWorkProducts)
          .values({
            ...data,
            companyId,
            issueId,
          })
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    update: async (id: string, patch: Partial<typeof issueWorkProducts.$inferInsert>) => {
      const row = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(issueWorkProducts)
          .where(eq(issueWorkProducts.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        if (patch.isPrimary === true) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, existing.companyId),
                eq(issueWorkProducts.issueId, existing.issueId),
                eq(issueWorkProducts.type, existing.type),
              ),
            );
        }

        return await tx
          .update(issueWorkProducts)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(issueWorkProducts.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    remove: async (id: string) => {
      const row = await db
        .delete(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },
  };
}

export { toIssueWorkProduct };
