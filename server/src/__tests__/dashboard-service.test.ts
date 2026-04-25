import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  issueWorkProducts,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { dashboardService } from "../services/dashboard.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dashboard service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("dashboardService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-dashboard-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueWorkProducts);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("counts only deliverables attached to visible issues", async () => {
    const companyId = randomUUID();
    const visibleIssueId = randomUUID();
    const hiddenIssueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Dashboard Co",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });

    await db.insert(issues).values([
      {
        id: visibleIssueId,
        companyId,
        title: "Visible review issue",
        status: "in_progress",
        priority: "medium",
        identifier: "DASH-1",
      },
      {
        id: hiddenIssueId,
        companyId,
        title: "Hidden publish issue",
        status: "in_progress",
        priority: "medium",
        identifier: "DASH-2",
        hiddenAt: new Date("2026-04-22T07:35:00.000Z"),
      },
    ]);

    await db.insert(issueWorkProducts).values([
      {
        companyId,
        issueId: visibleIssueId,
        type: "document",
        provider: "paperclip",
        title: "Visible review packet",
        status: "open",
        reviewState: "needs_board_review",
        metadata: { deliverableKind: "action_evidence" },
      },
      {
        companyId,
        issueId: hiddenIssueId,
        type: "document",
        provider: "paperclip",
        title: "Hidden publish packet",
        status: "queued_for_publish",
        reviewState: "approved",
        metadata: { deliverableKind: "action_evidence" },
      },
    ]);

    const summary = await dashboardService(db).summary(companyId);

    expect(summary.tasks.inProgress).toBe(1);
    expect(summary.tasks.open).toBe(1);
    expect(summary.deliverables.needsReview).toBe(1);
    expect(summary.deliverables.publishQueue).toBe(0);
    expect(summary.deliverables.openClawEvidence).toBe(1);
  });
});
