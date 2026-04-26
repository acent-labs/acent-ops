import { useMemo, useState } from "react";
import type {
  Agent,
  DeliverableListItem,
  IssueDeliverableMetadata,
  WorkProductSteeringAction,
  WorkProductSteeringRequest,
} from "@paperclipai/shared";
import { ExternalLink, FileText, MessageSquare, Send, ShieldCheck, Archive, UploadCloud } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isExternalCommandCenterHref, normalizeCommandCenterHref } from "@/lib/command-center-links";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type DeliverablesPanelProps = {
  items: DeliverableListItem[];
  isLoading?: boolean;
  emptyMessage?: string;
  openClawAgents?: Agent[];
  onSteer?: (workProductId: string, data: WorkProductSteeringRequest) => Promise<void>;
  compact?: boolean;
  pagination?: {
    currentPage: number;
    pageSize: number;
    hasNextPage: boolean;
    onPageChange: (nextPage: number) => void;
  };
};

type SteeringDraft = {
  item: DeliverableListItem;
  action: WorkProductSteeringAction;
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  ready_for_review: "Ready",
  approved: "Approved",
  changes_requested: "Changes",
  queued_for_publish: "Queued",
  published: "Published",
  archived: "Archived",
  failed: "Failed",
};

const reviewLabels: Record<string, string> = {
  none: "No review",
  needs_board_review: "Needs review",
  approved: "Approved",
  changes_requested: "Changes requested",
};

const actionLabels: Record<WorkProductSteeringAction, string> = {
  comment: "Ask question",
  approve: "Approve",
  request_changes: "Request changes",
  queue_for_publish: "Queue for publish",
  publish_via_api: "Publish via API",
  send_to_openclaw: "Send to OpenClaw",
  mark_published: "Mark published",
  archive: "Archive",
};

function ActionButtonLabel({ children }: { children: string }) {
  return <span className="min-w-0 truncate leading-none">{children}</span>;
}

function metadataFor(item: DeliverableListItem): IssueDeliverableMetadata {
  const value = item.workProduct.metadata;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as IssueDeliverableMetadata
    : {};
}

function issueHref(item: DeliverableListItem) {
  return `/issues/${item.issue.identifier ?? item.issue.id}`;
}

function primaryHref(item: DeliverableListItem) {
  const meta = metadataFor(item);
  if (item.workProduct.url) return item.workProduct.url;
  if (typeof meta.evidenceUrl === "string" && meta.evidenceUrl.length > 0) return meta.evidenceUrl;
  if (typeof meta.documentKey === "string" && meta.documentKey.length > 0) {
    return `${issueHref(item)}#document-${encodeURIComponent(meta.documentKey)}`;
  }
  return issueHref(item);
}

const deliverableChannels = new Set(["x", "linkedin", "blog", "homepage", "deck"]);

function isDeliverableChannel(value: string): value is NonNullable<WorkProductSteeringRequest["channel"]> {
  return deliverableChannels.has(value);
}

function actionAcceptsChannel(action: WorkProductSteeringAction) {
  return action === "approve"
    || action === "queue_for_publish"
    || action === "publish_via_api"
    || action === "send_to_openclaw";
}

export function buildWorkProductSteeringPayload({
  action,
  comment,
  channel,
  openClawAgentId,
}: {
  action: WorkProductSteeringAction;
  comment: string;
  channel: string;
  openClawAgentId: string;
}): WorkProductSteeringRequest {
  return {
    action,
    ...(comment.trim() ? { comment: comment.trim() } : {}),
    ...(actionAcceptsChannel(action) && isDeliverableChannel(channel) ? { channel } : {}),
    ...(openClawAgentId ? { openClawAgentId } : {}),
  };
}

function statusVariant(status: string) {
  if (status === "failed" || status === "changes_requested") return "destructive" as const;
  if (status === "approved" || status === "published") return "default" as const;
  if (status === "queued_for_publish" || status === "ready_for_review") return "secondary" as const;
  return "outline" as const;
}

function canPublishViaApi(item: DeliverableListItem) {
  const meta = metadataFor(item);
  return (meta.channel === "x" || meta.channel === "blog") && item.workProduct.status === "queued_for_publish";
}

function shouldPublishOnApproval(item: DeliverableListItem) {
  const meta = metadataFor(item);
  return (meta.channel === "x" || meta.channel === "blog") && meta.reviewRequest === "publish" && item.workProduct.status !== "published";
}

function approveActionLabel(item: DeliverableListItem) {
  return shouldPublishOnApproval(item) ? "Approve & Publish" : "Approve & Complete";
}

function DeliverableCard({
  item,
  compact,
  canSendToOpenClaw,
  onAction,
}: {
  item: DeliverableListItem;
  compact?: boolean;
  canSendToOpenClaw: boolean;
  onAction: (item: DeliverableListItem, action: WorkProductSteeringAction) => void;
}) {
  const meta = metadataFor(item);
  const href = normalizeCommandCenterHref(primaryHref(item));
  const sourceHref = normalizeCommandCenterHref(issueHref(item));
  const sourceSystem = typeof meta.sourceSystem === "string" ? meta.sourceSystem : item.workProduct.provider;
  const reviewRequest = typeof meta.reviewRequest === "string" ? meta.reviewRequest : "no_action";
  const actionButtonClass =
    "!h-9 !min-h-9 w-full min-w-0 shrink overflow-hidden px-2.5 text-[13px] leading-none md:!h-8 md:!min-h-8 md:w-auto md:px-2 md:text-xs [&_svg:not([class*='size-'])]:size-3.5";
  const actionLinkClass = "min-w-0 md:w-auto";

  return (
    <article
      className={cn(
        "min-w-0 max-w-full overflow-hidden border border-border bg-card p-3 sm:p-4",
        item.workProduct.isPrimary && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
              {item.workProduct.isPrimary && <Badge variant="default" className="max-w-full">Primary</Badge>}
              <Badge variant={statusVariant(item.workProduct.status)} className="max-w-[9rem]">
                {statusLabels[item.workProduct.status] ?? item.workProduct.status}
              </Badge>
              <Badge variant="outline" className="max-w-[10rem]">
                {reviewLabels[item.workProduct.reviewState] ?? item.workProduct.reviewState}
              </Badge>
              {meta.deliverableKind && <Badge variant="ghost" className="max-w-[9rem] truncate">{meta.deliverableKind}</Badge>}
              {meta.channel && <Badge variant="ghost" className="max-w-[7rem] truncate">{meta.channel}</Badge>}
            </div>
            <h3 className="truncate text-sm font-semibold">{item.workProduct.title}</h3>
            {item.workProduct.summary && (
              <p className="line-clamp-2 break-words text-sm text-muted-foreground">{item.workProduct.summary}</p>
            )}
          </div>
          <FileText className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="grid min-w-0 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <span className="min-w-0 truncate">Source: {sourceSystem}</span>
          <span className="min-w-0 truncate">Review: {reviewRequest}</span>
          <span className="min-w-0 truncate">
            Owner: {item.ownerAgent ? `${item.ownerAgent.name} (${item.ownerAgent.role})` : "Unassigned"}
          </span>
          <Link to={sourceHref} className="min-w-0 truncate underline underline-offset-2">
            {item.issue.identifier ?? item.issue.id.slice(0, 8)} · {item.issue.title}
          </Link>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          {isExternalCommandCenterHref(href) ? (
            <a href={href} target="_blank" rel="noreferrer" className={actionLinkClass}>
              <Button size="xs" variant="outline" className={actionButtonClass}>
                <ExternalLink className="h-3.5 w-3.5" />
                <ActionButtonLabel>Open</ActionButtonLabel>
              </Button>
            </a>
          ) : (
            <Button size="xs" variant="outline" className={actionButtonClass} asChild>
              <Link to={href}>
                <FileText className="h-3.5 w-3.5" />
                <ActionButtonLabel>Open</ActionButtonLabel>
              </Link>
            </Button>
          )}
          <Button size="xs" variant="outline" className={actionButtonClass} asChild>
            <Link to={sourceHref}>
              <ActionButtonLabel>Source issue</ActionButtonLabel>
            </Link>
          </Button>
          {!compact && (
            <>
              <Button size="xs" className={actionButtonClass} onClick={() => onAction(item, "approve")}>
                <ShieldCheck className="h-3.5 w-3.5" />
                <ActionButtonLabel>{approveActionLabel(item)}</ActionButtonLabel>
              </Button>
              <Button size="xs" variant="outline" className={actionButtonClass} onClick={() => onAction(item, "request_changes")}>
                <ActionButtonLabel>Request changes</ActionButtonLabel>
              </Button>
              <Button size="xs" variant="outline" className={actionButtonClass} onClick={() => onAction(item, "comment")}>
                <MessageSquare className="h-3.5 w-3.5" />
                <ActionButtonLabel>Ask</ActionButtonLabel>
              </Button>
              {!shouldPublishOnApproval(item) && (
                <Button size="xs" variant="outline" className={actionButtonClass} onClick={() => onAction(item, "queue_for_publish")}>
                  <UploadCloud className="h-3.5 w-3.5" />
                  <ActionButtonLabel>Queue</ActionButtonLabel>
                </Button>
              )}
              {canPublishViaApi(item) && (
                <Button size="xs" className={actionButtonClass} onClick={() => onAction(item, "publish_via_api")}>
                  <Send className="h-3.5 w-3.5" />
                  <ActionButtonLabel>API Publish</ActionButtonLabel>
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                className={actionButtonClass}
                onClick={() => onAction(item, "send_to_openclaw")}
                disabled={!canSendToOpenClaw}
                title={canSendToOpenClaw ? "Send to OpenClaw" : "OpenClaw agent required"}
              >
                <Send className="h-3.5 w-3.5" />
                <ActionButtonLabel>OpenClaw</ActionButtonLabel>
              </Button>
              <Button size="xs" variant="ghost" className={actionButtonClass} onClick={() => onAction(item, "archive")}>
                <Archive className="h-3.5 w-3.5" />
                <ActionButtonLabel>Archive</ActionButtonLabel>
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function DeliverablesPanel({
  items,
  isLoading,
  emptyMessage = "No deliverables yet.",
  openClawAgents = [],
  onSteer,
  compact,
  pagination,
}: DeliverablesPanelProps) {
  const [steeringDraft, setSteeringDraft] = useState<SteeringDraft | null>(null);
  const [comment, setComment] = useState("");
  const [channel, setChannel] = useState("");
  const [openClawAgentId, setOpenClawAgentId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => {
      if (a.workProduct.isPrimary !== b.workProduct.isPrimary) return a.workProduct.isPrimary ? -1 : 1;
      return new Date(b.workProduct.updatedAt).getTime() - new Date(a.workProduct.updatedAt).getTime();
    }),
    [items],
  );
  const visibleStart = pagination ? (pagination.currentPage - 1) * pagination.pageSize + 1 : 1;
  const visibleEnd = pagination ? visibleStart + Math.max(sortedItems.length - 1, 0) : sortedItems.length;

  function openSteering(item: DeliverableListItem, action: WorkProductSteeringAction) {
    const meta = metadataFor(item);
    setSteeringDraft({ item, action });
    setComment("");
    setChannel(typeof meta.channel === "string" && isDeliverableChannel(meta.channel) ? meta.channel : "");
    setOpenClawAgentId(openClawAgents.length === 1 ? openClawAgents[0]?.id ?? "" : "");
  }

  async function submitSteering() {
    if (!steeringDraft || !onSteer) return;
    setSubmitting(true);
    try {
      await onSteer(steeringDraft.item.workProduct.id, buildWorkProductSteeringPayload({
        action: steeringDraft.action,
        comment,
        channel,
        openClawAgentId,
      }));
      setSteeringDraft(null);
    } finally {
      setSubmitting(false);
    }
  }

  function renderPaginationControls() {
    if (!pagination || sortedItems.length === 0) return null;

    return (
      <div className="flex flex-col gap-2 border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {visibleStart}-{visibleEnd}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
            disabled={pagination.currentPage <= 1}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {pagination.currentPage}</span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
            disabled={!pagination.hasNextPage}
          >
            Next
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse bg-muted" />
        <div className="h-24 animate-pulse bg-muted" />
      </div>
    );
  }

  return (
    <>
      {renderPaginationControls()}

      {sortedItems.length === 0 ? (
        <div className="border border-border bg-card p-4 text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="grid gap-3">
          {sortedItems.map((item) => (
            <DeliverableCard
              key={item.workProduct.id}
              item={item}
              compact={compact}
              canSendToOpenClaw={openClawAgents.length > 0}
              onAction={openSteering}
            />
          ))}
        </div>
      )}

      {renderPaginationControls()}

      <Dialog open={Boolean(steeringDraft)} onOpenChange={(open) => !open && setSteeringDraft(null)}>
          <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {steeringDraft
                ? steeringDraft.action === "approve"
                  ? approveActionLabel(steeringDraft.item)
                  : actionLabels[steeringDraft.action]
                : "Steer deliverable"}
            </DialogTitle>
            <DialogDescription>
              {steeringDraft?.item.workProduct.title ?? "Update this deliverable and keep the source issue traceable."}
            </DialogDescription>
          </DialogHeader>

          {(steeringDraft?.action === "queue_for_publish" || steeringDraft?.action === "send_to_openclaw") && (
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Channel</span>
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className="h-9 cursor-pointer border border-input bg-background px-2 text-sm"
              >
                <option value="">Keep existing</option>
                <option value="x">X</option>
                <option value="linkedin">LinkedIn</option>
                <option value="blog">Blog</option>
                <option value="homepage">Homepage</option>
                <option value="deck">Deck</option>
              </select>
            </label>
          )}

          {steeringDraft?.action === "send_to_openclaw" && openClawAgents.length > 1 && (
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">OpenClaw agent</span>
              <select
                value={openClawAgentId}
                onChange={(event) => setOpenClawAgentId(event.target.value)}
                className="h-9 cursor-pointer border border-input bg-background px-2 text-sm"
              >
                <option value="">Select OpenClaw agent</option>
                {openClawAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Comment</span>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add a short steering note..."
              className="min-h-28"
            />
          </label>

          <DialogFooter>
            <Button
              onClick={() => void submitSteering()}
              disabled={
                submitting ||
                !onSteer ||
                (steeringDraft?.action === "comment" && comment.trim().length === 0) ||
                (steeringDraft?.action === "send_to_openclaw" && openClawAgents.length > 1 && !openClawAgentId)
              }
            >
              {submitting ? "Sending..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
