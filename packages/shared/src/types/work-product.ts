export type IssueWorkProductType =
  | "preview_url"
  | "runtime_service"
  | "pull_request"
  | "branch"
  | "commit"
  | "artifact"
  | "document";

export type IssueWorkProductProvider =
  | "paperclip"
  | "github"
  | "vercel"
  | "s3"
  | "custom";

export type IssueWorkProductStatus =
  | "active"
  | "ready_for_review"
  | "approved"
  | "changes_requested"
  | "queued_for_publish"
  | "published"
  | "merged"
  | "closed"
  | "failed"
  | "archived"
  | "draft";

export type IssueWorkProductReviewState =
  | "none"
  | "needs_board_review"
  | "approved"
  | "changes_requested";

export interface IssueWorkProduct {
  id: string;
  companyId: string;
  projectId: string | null;
  issueId: string;
  executionWorkspaceId: string | null;
  runtimeServiceId: string | null;
  type: IssueWorkProductType;
  provider: IssueWorkProductProvider | string;
  externalId: string | null;
  title: string;
  url: string | null;
  status: IssueWorkProductStatus | string;
  reviewState: IssueWorkProductReviewState;
  isPrimary: boolean;
  healthStatus: "unknown" | "healthy" | "unhealthy";
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdByRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IssueDeliverableKind =
  | "briefing"
  | "social_post"
  | "sales_deck"
  | "homepage_copy"
  | "report"
  | "action_evidence";

export type IssueDeliverableChannel =
  | "x"
  | "linkedin"
  | "blog"
  | "homepage"
  | "deck";

export type IssueDeliverableSourceSystem =
  | "paperclip"
  | "openclaw"
  | "hermes"
  | "manual";

export type IssueDeliverableReviewRequest =
  | "approve"
  | "revise"
  | "choose_one"
  | "publish"
  | "no_action";

export interface IssueDeliverableMetadata {
  deliverableKind?: IssueDeliverableKind;
  channel?: IssueDeliverableChannel;
  documentKey?: string;
  sourceDeliverableId?: string;
  sourceSystem?: IssueDeliverableSourceSystem;
  reviewRequest?: IssueDeliverableReviewRequest;
  openClawIssueId?: string;
  evidenceUrl?: string;
  [key: string]: unknown;
}

export interface DeliverableListItem {
  workProduct: IssueWorkProduct;
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    parentId: string | null;
  };
  project: {
    id: string;
    name: string;
  } | null;
  ownerAgent: {
    id: string;
    name: string;
    role: string;
    adapterType: string;
  } | null;
}

export type WorkProductSteeringAction =
  | "comment"
  | "approve"
  | "request_changes"
  | "queue_for_publish"
  | "send_to_openclaw"
  | "mark_published"
  | "archive";

export interface WorkProductSteeringRequest {
  action: WorkProductSteeringAction;
  comment?: string;
  channel?: IssueDeliverableChannel;
  openClawAgentId?: string;
}
