import { describe, expect, it } from "vitest";
import {
  buildPlaybookEntriesFromSourceDocuments,
  runLiveAssistPipeline,
  type PlaybookSourceDocument,
} from "./playbook-live-assist.js";

const sourceDocument: PlaybookSourceDocument = {
  id: "macro-refund-policy",
  title: "환불 정책 문의 응대",
  kind: "policy",
  urlOrPath: "/ACE/issues/ACE-232#document-pricing",
  tags: ["pricing", "refund"],
  body: `
intent: 고객이 환불 가능 여부와 환불 조건을 물을 때
keywords: 환불, refund, 결제, 취소
examples: 환불 가능한가요?, 결제를 취소하고 싶어요
answer: 파일럿 환불 조건은 표준 계약 범위 안에서만 안내할 수 있습니다. 구체 금액이나 조건 변경 요청은 담당자 검토로 연결하겠습니다.
forbidden: 전액 환불해 드립니다, 즉시 환불
escalation: 구체 환불 금액 요구, 법무 조건 요청
route_to: CEO
sla: 1 business day
confidence_floor: 0.86
pii_class: low
owner: product
`,
};

describe("playbook live assist", () => {
  it("builds approved playbook entries from source documents", () => {
    const [entry] = buildPlaybookEntriesFromSourceDocuments([sourceDocument]);

    expect(entry).toMatchObject({
      id: "macro-refund-policy",
      title: "환불 정책 문의 응대",
      status: "approved",
      confidenceFloor: 0.86,
      piiClass: "low",
      escalation: {
        routeTo: "CEO",
        sla: "1 business day",
      },
    });
    expect(entry.applicability.keywords).toContain("환불");
    expect(entry.sources[0]).toMatchObject({
      refId: "macro-refund-policy",
      type: "policy",
      urlOrPath: "/ACE/issues/ACE-232#document-pricing",
    });
  });

  it("retrieves a playbook entry and emits a cited private-note draft", async () => {
    const playbook = buildPlaybookEntriesFromSourceDocuments([sourceDocument]);

    const result = await runLiveAssistPipeline(
      {
        id: "ticket-1",
        subject: "환불 조건 문의",
        description: "파일럿 결제를 취소하면 환불 가능한가요?",
        requesterHash: "requester_hash",
      },
      playbook,
    );

    expect(result.blocked).toBe(false);
    if (!result.blocked) {
      expect(result.visibility).toBe("private_note");
      expect(result.draft).toContain("담당자 검토");
      expect(result.citations).toEqual([
        expect.objectContaining({
          refId: "macro-refund-policy",
          title: "환불 정책 문의 응대",
        }),
      ]);
    }
  });

  it("blocks model output when a forbidden phrase appears", async () => {
    const playbook = buildPlaybookEntriesFromSourceDocuments([sourceDocument]);

    const result = await runLiveAssistPipeline(
      {
        id: "ticket-2",
        subject: "refund request",
        description: "Please refund this pilot.",
      },
      playbook,
      {
        model: {
          generate: () => "전액 환불해 드립니다. 바로 처리하겠습니다.",
        },
      },
    );

    expect(result).toMatchObject({
      blocked: true,
      ticketId: "ticket-2",
      entryId: "macro-refund-policy",
      violations: [
        {
          phrase: "전액 환불해 드립니다",
          reason: "Forbidden by source document macro-refund-policy.",
        },
      ],
    });
  });
});
