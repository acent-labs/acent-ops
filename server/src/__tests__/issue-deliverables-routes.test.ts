import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
  addComment: vi.fn(),
  create: vi.fn(),
}));

const mockWorkProductService = vi.hoisted(() => ({
  listForCompanyDeliverables: vi.fn(),
  listDeliverablesForIssue: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockQueueIssueAssignmentWakeup = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentWakeup: mockQueueIssueAssignmentWakeup,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(async () => true),
    hasPermission: vi.fn(async () => true),
  }),
  agentService: () => mockAgentService,
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(async () => ({})),
  }),
  executionWorkspaceService: () => ({
    getById: vi.fn(),
  }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
    getRun: vi.fn(async () => null),
    getActiveRunForAgent: vi.fn(async () => null),
    cancelRun: vi.fn(async () => null),
  }),
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => mockWorkProductService,
}));

async function createApp() {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

const sourceIssue = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "company-1",
  identifier: "PAP-179",
  title: "Create AI narrative",
  status: "todo",
  priority: "medium",
  projectId: "22222222-2222-4222-8222-222222222222",
  goalId: null,
  parentId: null,
  assigneeAgentId: null,
  assigneeUserId: null,
};

const workProduct = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  companyId: "company-1",
  projectId: "22222222-2222-4222-8222-222222222222",
  issueId: sourceIssue.id,
  executionWorkspaceId: null,
  runtimeServiceId: null,
  type: "document",
  provider: "paperclip",
  externalId: null,
  title: "AI narrative briefing",
  url: null,
  status: "ready_for_review",
  reviewState: "needs_board_review",
  isPrimary: true,
  healthStatus: "unknown",
  summary: null,
  metadata: { deliverableKind: "briefing", documentKey: "briefing", sourceSystem: "paperclip" },
  createdByRunId: null,
  createdAt: new Date("2026-04-20T00:00:00.000Z"),
  updatedAt: new Date("2026-04-20T00:00:00.000Z"),
};

describe("issue deliverable routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue(sourceIssue);
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueService.addComment.mockResolvedValue({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      companyId: "company-1",
      issueId: sourceIssue.id,
      body: "Approved",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockWorkProductService.getById.mockResolvedValue(workProduct);
    mockWorkProductService.update.mockResolvedValue({ ...workProduct, status: "approved", reviewState: "approved" });
    mockWorkProductService.listForCompanyDeliverables.mockResolvedValue([]);
    mockWorkProductService.listDeliverablesForIssue.mockResolvedValue([{
      workProduct,
      issue: {
        id: sourceIssue.id,
        identifier: sourceIssue.identifier,
        title: sourceIssue.title,
        status: sourceIssue.status,
        parentId: sourceIssue.parentId,
      },
      project: { id: "22222222-2222-4222-8222-222222222222", name: "Marketing Launch" },
      ownerAgent: null,
    }]);
    mockAgentService.list.mockResolvedValue([]);
  });

  it("lists company deliverables with filters", async () => {
    const app = await createApp();

    await request(app)
      .get("/api/companies/company-1/deliverables?reviewState=needs_board_review&kind=briefing&channel=x&limit=25")
      .expect(200);

    expect(mockWorkProductService.listForCompanyDeliverables).toHaveBeenCalledWith("company-1", {
      status: undefined,
      reviewState: "needs_board_review",
      projectId: undefined,
      provider: undefined,
      kind: "briefing",
      channel: "x",
      limit: 25,
    });
  });

  it("rolls issue deliverables up from descendants", async () => {
    const app = await createApp();

    const res = await request(app)
      .get(`/api/issues/${sourceIssue.id}/deliverables?includeDescendants=true`)
      .expect(200);

    expect(mockWorkProductService.listDeliverablesForIssue).toHaveBeenCalledWith(sourceIssue.id, {
      includeDescendants: true,
      filters: expect.objectContaining({ limit: 100 }),
    });
    expect(res.body[0].workProduct.id).toBe(workProduct.id);
  });

  it("approves a deliverable and records a steering comment", async () => {
    const app = await createApp();

    await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "approve", comment: "Approved for publish queue." })
      .expect(200);

    expect(mockWorkProductService.update).toHaveBeenCalledWith(workProduct.id, {
      status: "approved",
      reviewState: "approved",
    });
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      sourceIssue.id,
      "Approved for publish queue.",
      expect.objectContaining({ userId: "local-board" }),
    );
  });

  it("requires an OpenClaw agent before creating an execution issue", async () => {
    const app = await createApp();

    const res = await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "send_to_openclaw", channel: "x" })
      .expect(422);

    expect(res.body.error).toBe("OpenClaw agent required");
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });
});
