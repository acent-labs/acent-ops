import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  createForIssue: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
}));

const mockDocumentService = vi.hoisted(() => ({
  getIssueDocumentPayload: vi.fn(async () => ({})),
  getIssueDocumentByKey: vi.fn(),
}));

const mockToolDispatcher = vi.hoisted(() => ({
  getTool: vi.fn(),
  executeTool: vi.fn(),
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
  documentService: () => mockDocumentService,
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
  app.use("/api", issueRoutes({} as any, {} as any, {
    getToolDispatcher: () => mockToolDispatcher as any,
  }));
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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

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
    mockWorkProductService.createForIssue.mockResolvedValue({
      ...workProduct,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      type: "preview_url",
      status: "published",
      reviewState: "approved",
      title: "X publish evidence: AI narrative briefing",
      url: "https://x.com/i/web/status/2046425694436249985",
      isPrimary: false,
      metadata: {
        deliverableKind: "action_evidence",
        channel: "x",
        sourceDeliverableId: workProduct.id,
        sourceSystem: "paperclip",
        evidenceUrl: "https://x.com/i/web/status/2046425694436249985",
      },
    });
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
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue({
      key: "briefing",
      body: "ACENT Paperclip에서 X API 포스팅 경로를 테스트합니다.",
    });
    mockToolDispatcher.getTool.mockReturnValue({ name: "x-create-post" });
    mockToolDispatcher.executeTool.mockResolvedValue({
      pluginId: "paperclip-social-reader",
      toolName: "x-create-post",
      result: {
        data: {
          data: {
            id: "2046425694436249985",
            text: "ACENT Paperclip에서 X API 포스팅 경로를 테스트합니다.",
          },
          url: "https://x.com/i/web/status/2046425694436249985",
        },
      },
    });
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
      offset: 0,
    });
  });

  it("passes deliverable offset through for company pagination", async () => {
    const app = await createApp();

    await request(app)
      .get("/api/companies/company-1/deliverables?limit=6&offset=12")
      .expect(200);

    expect(mockWorkProductService.listForCompanyDeliverables).toHaveBeenCalledWith("company-1", {
      status: undefined,
      reviewState: undefined,
      projectId: undefined,
      provider: undefined,
      kind: undefined,
      channel: undefined,
      limit: 6,
      offset: 12,
    });
  });

  it("rolls issue deliverables up from descendants", async () => {
    const app = await createApp();

    const res = await request(app)
      .get(`/api/issues/${sourceIssue.id}/deliverables?includeDescendants=true`)
      .expect(200);

    expect(mockWorkProductService.listDeliverablesForIssue).toHaveBeenCalledWith(sourceIssue.id, {
      includeDescendants: true,
      filters: expect.objectContaining({ limit: 100, offset: 0 }),
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

  it("approves and immediately publishes X deliverables marked for publish review", async () => {
    const app = await createApp();
    mockWorkProductService.getById.mockResolvedValue({
      ...workProduct,
      metadata: {
        deliverableKind: "social_post",
        documentKey: "briefing",
        channel: "x",
        reviewRequest: "publish",
        sourceSystem: "paperclip",
      },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue({
      key: "briefing",
      body: `# ACE-202 X 최종안

### X 최종안 (founder approval -> API publish ready)
모델은 데모를 만들고, 거버넌스는 운영을 만든다. 내가 보기엔 AI 에이전트의 moat는 성능보다 거버넌스에서 생긴다. 배포는 누구나 한다. 승인 게이트, 감사 로그, 권한 경계가 없으면 거기서 멈춘다. 85%가 시도해도 5%만 스케일하는 이유다.

해시태그: #AIAgents #EnterpriseAI

## 메모
- 형식: single tweet
- 본문+해시태그 총 길이: 162자
- 단일 publish candidate만 제출`,
    });
    mockWorkProductService.update.mockResolvedValue({
      ...workProduct,
      status: "published",
      reviewState: "approved",
      url: "https://x.com/i/web/status/2046425694436249985",
      externalId: "2046425694436249985",
      metadata: {
        deliverableKind: "social_post",
        documentKey: "briefing",
        channel: "x",
        reviewRequest: "publish",
        sourceSystem: "paperclip",
        evidenceUrl: "https://x.com/i/web/status/2046425694436249985",
      },
    });

    const res = await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "approve" })
      .expect(200);

    expect(mockToolDispatcher.executeTool).toHaveBeenCalledWith(
      "paperclip-social-reader:x-create-post",
      {
        text: "모델은 데모를 만들고, 거버넌스는 운영을 만든다. 내가 보기엔 AI 에이전트의 moat는 성능보다 거버넌스에서 생긴다. 배포는 누구나 한다. 승인 게이트, 감사 로그, 권한 경계가 없으면 거기서 멈춘다. 85%가 시도해도 5%만 스케일하는 이유다.\n\n#AIAgents #EnterpriseAI",
      },
      expect.objectContaining({
        companyId: "company-1",
        projectId: sourceIssue.projectId,
      }),
    );
    expect(mockWorkProductService.update).toHaveBeenCalledWith(workProduct.id, expect.objectContaining({
      status: "published",
      reviewState: "approved",
      externalId: "2046425694436249985",
      url: "https://x.com/i/web/status/2046425694436249985",
    }));
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      sourceIssue.id,
      "Approved and published deliverable to X via API: https://x.com/i/web/status/2046425694436249985",
      expect.objectContaining({ userId: "local-board" }),
    );
    expect(res.body.workProduct.status).toBe("published");
    expect(res.body.evidenceWorkProduct.metadata.deliverableKind).toBe("action_evidence");
  });

  it("approves and immediately publishes blog deliverables marked for publish review", async () => {
    const app = await createApp();
    vi.stubEnv("PAPERCLIP_BLOG_PUBLISH_URL", "https://www.acent.com/api/blog-studio/paperclip-publish");
    vi.stubEnv("PAPERCLIP_BLOG_PUBLISH_TOKEN", "paperclip-blog-token");
    vi.stubEnv("PAPERCLIP_BLOG_DEFAULT_CATEGORY_SLUG", "ai-trends-models");
    vi.stubEnv("PAPERCLIP_BLOG_PUBLIC_ORIGIN", "https://www.acent.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      post: {
        id: "blog-post-1",
        full_path: "/blog/8211",
      },
      url: "/blog/8211",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    mockWorkProductService.getById.mockResolvedValue({
      ...workProduct,
      metadata: {
        deliverableKind: "report",
        documentKey: "blog-draft",
        channel: "blog",
        reviewRequest: "publish",
        sourceSystem: "paperclip",
      },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue({
      key: "blog-draft",
      body: `# 승인되면 발행되는 블로그

오늘의 핵심은 **승인 게이트**입니다.

- X는 API로 즉시 발행
- LinkedIn은 수동 발행
- Blog는 승인 후 자동 발행`,
    });
    mockWorkProductService.update.mockResolvedValue({
      ...workProduct,
      status: "published",
      reviewState: "approved",
      url: "https://www.acent.com/blog/8211",
      externalId: "blog-post-1",
      metadata: {
        deliverableKind: "report",
        documentKey: "blog-draft",
        channel: "blog",
        reviewRequest: "publish",
        sourceSystem: "paperclip",
        evidenceUrl: "https://www.acent.com/blog/8211",
      },
    });
    mockWorkProductService.createForIssue.mockImplementation(async (_issueId, companyId, input) => ({
      ...workProduct,
      ...input,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      companyId,
      issueId: sourceIssue.id,
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    }));

    const res = await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "approve" })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.acent.com/api/blog-studio/paperclip-publish",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer paperclip-blog-token",
          "content-type": "application/json",
        }),
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      title: "승인되면 발행되는 블로그",
      category_slug: "ai-trends-models",
      content: [
        "<p>오늘의 핵심은 <strong>승인 게이트</strong>입니다.</p>",
        "<ul><li>X는 API로 즉시 발행</li><li>LinkedIn은 수동 발행</li><li>Blog는 승인 후 자동 발행</li></ul>",
      ].join("\n"),
    });
    expect(mockWorkProductService.update).toHaveBeenCalledWith(workProduct.id, expect.objectContaining({
      status: "published",
      reviewState: "approved",
      externalId: "blog-post-1",
      url: "https://www.acent.com/blog/8211",
    }));
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledWith(
      sourceIssue.id,
      "company-1",
      expect.objectContaining({
        title: "Blog publish evidence: AI narrative briefing",
        metadata: expect.objectContaining({
          deliverableKind: "action_evidence",
          channel: "blog",
          sourceDeliverableId: workProduct.id,
          evidenceUrl: "https://www.acent.com/blog/8211",
        }),
      }),
    );
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      sourceIssue.id,
      "Approved and published blog deliverable via API: https://www.acent.com/blog/8211",
      expect.objectContaining({ userId: "local-board" }),
    );
    expect(res.body.workProduct.status).toBe("published");
    expect(res.body.evidenceWorkProduct.metadata.channel).toBe("blog");
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

  it("publishes an X deliverable via API and registers action evidence", async () => {
    const app = await createApp();
    mockWorkProductService.getById.mockResolvedValue({
      ...workProduct,
      status: "queued_for_publish",
      reviewState: "approved",
      metadata: {
        deliverableKind: "social_post",
        documentKey: "briefing",
        channel: "x",
        sourceSystem: "paperclip",
      },
    });
    mockWorkProductService.update.mockResolvedValue({
      ...workProduct,
      status: "published",
      reviewState: "approved",
      url: "https://x.com/i/web/status/2046425694436249985",
      externalId: "2046425694436249985",
      metadata: {
        deliverableKind: "social_post",
        documentKey: "briefing",
        channel: "x",
        sourceSystem: "paperclip",
        evidenceUrl: "https://x.com/i/web/status/2046425694436249985",
      },
    });

    const res = await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "publish_via_api" })
      .expect(200);

    expect(mockToolDispatcher.executeTool).toHaveBeenCalledWith(
      "paperclip-social-reader:x-create-post",
      { text: "ACENT Paperclip에서 X API 포스팅 경로를 테스트합니다." },
      expect.objectContaining({
        companyId: "company-1",
        projectId: sourceIssue.projectId,
      }),
    );
    expect(mockWorkProductService.update).toHaveBeenCalledWith(workProduct.id, expect.objectContaining({
      status: "published",
      externalId: "2046425694436249985",
      url: "https://x.com/i/web/status/2046425694436249985",
    }));
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledWith(
      sourceIssue.id,
      "company-1",
      expect.objectContaining({
        type: "preview_url",
        status: "published",
        metadata: expect.objectContaining({
          deliverableKind: "action_evidence",
          channel: "x",
          sourceDeliverableId: workProduct.id,
        }),
      }),
    );
    expect(res.body.evidenceWorkProduct.metadata.deliverableKind).toBe("action_evidence");
  });

  it("publishes numbered X draft sections as a reply thread", async () => {
    const app = await createApp();
    mockWorkProductService.getById.mockResolvedValue({
      ...workProduct,
      status: "queued_for_publish",
      reviewState: "approved",
      metadata: {
        deliverableKind: "social_post",
        documentKey: "briefing",
        channel: "x",
        sourceSystem: "paperclip",
      },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue({
      key: "briefing",
      body: `# ACE-202 X 최종안

### X thread draft
1/
Claude Opus 4.7에서 조용히 바뀐 건 모델 크기가 아니라 비용 구조다.

---

2/
예전엔 에이전트 돌려놓고 끝난 뒤에야 얼마 태웠는지 알았다.

---

3/
예산을 먼저 정하고, 그 안에서 어디까지 갈지 모델이 알아서 맞춘다.

해시태그: #Claude #AIagents`,
    });
    mockToolDispatcher.executeTool.mockResolvedValue({
      pluginId: "paperclip-social-reader",
      toolName: "x-create-thread",
      result: {
        data: {
          data: {
            id: "2046425694436249985",
            text: "Claude Opus 4.7에서 조용히 바뀐 건 모델 크기가 아니라 비용 구조다.",
          },
          rootId: "2046425694436249985",
          lastId: "2046425694436249987",
          url: "https://x.com/i/web/status/2046425694436249985",
          posts: [
            {
              id: "2046425694436249985",
              text: "Claude Opus 4.7에서 조용히 바뀐 건 모델 크기가 아니라 비용 구조다.",
              url: "https://x.com/i/web/status/2046425694436249985",
            },
            {
              id: "2046425694436249986",
              text: "예전엔 에이전트 돌려놓고 끝난 뒤에야 얼마 태웠는지 알았다.",
              url: "https://x.com/i/web/status/2046425694436249986",
            },
            {
              id: "2046425694436249987",
              text: "예산을 먼저 정하고, 그 안에서 어디까지 갈지 모델이 알아서 맞춘다.\n\n#Claude #AIagents",
              url: "https://x.com/i/web/status/2046425694436249987",
            },
          ],
        },
      },
    });

    await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "publish_via_api" })
      .expect(200);

    expect(mockToolDispatcher.executeTool).toHaveBeenCalledWith(
      "paperclip-social-reader:x-create-thread",
      {
        posts: [
          "Claude Opus 4.7에서 조용히 바뀐 건 모델 크기가 아니라 비용 구조다.",
          "예전엔 에이전트 돌려놓고 끝난 뒤에야 얼마 태웠는지 알았다.",
          "예산을 먼저 정하고, 그 안에서 어디까지 갈지 모델이 알아서 맞춘다.\n\n#Claude #AIagents",
        ],
      },
      expect.objectContaining({
        companyId: "company-1",
        projectId: sourceIssue.projectId,
      }),
    );
    expect(mockWorkProductService.update).toHaveBeenCalledWith(workProduct.id, expect.objectContaining({
      status: "published",
      externalId: "2046425694436249985",
      url: "https://x.com/i/web/status/2046425694436249985",
      metadata: expect.objectContaining({
        publishMode: "thread",
        threadPostCount: 3,
        threadPostIds: [
          "2046425694436249985",
          "2046425694436249986",
          "2046425694436249987",
        ],
      }),
    }));
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledWith(
      sourceIssue.id,
      "company-1",
      expect.objectContaining({
        title: "X thread publish evidence: AI narrative briefing",
        metadata: expect.objectContaining({
          deliverableKind: "action_evidence",
          publishMode: "thread",
          threadPostCount: 3,
        }),
      }),
    );
  });

  it("rejects direct API publish for unsupported channels", async () => {
    const app = await createApp();
    mockWorkProductService.getById.mockResolvedValue({
      ...workProduct,
      status: "queued_for_publish",
      reviewState: "approved",
      metadata: {
        deliverableKind: "social_post",
        documentKey: "briefing",
        channel: "linkedin",
        sourceSystem: "paperclip",
      },
    });

    const res = await request(app)
      .post(`/api/work-products/${workProduct.id}/steering`)
      .send({ action: "publish_via_api" })
      .expect(422);

    expect(res.body.error).toBe('Direct API publish currently supports only channels "x" and "blog"');
    expect(mockToolDispatcher.executeTool).not.toHaveBeenCalled();
  });
});
