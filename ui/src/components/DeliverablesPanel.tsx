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

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

function statusVariant(status: string) {
  if (status === "failed" || status === "changes_requested") return "destructive" as const;
  if (status === "approved" || status === "published") return "default" as const;
  if (status === "queued_for_publish" || status === "ready_for_review") return "secondary" as const;
  return "outline" as const;
}

function canPublishViaApi(item: DeliverableListItem) {
  const meta = metadataFor(item);
  return meta.channel === "x" && item.workProduct.status === "queued_for_publish";
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
  const href = primaryHref(item);
  const sourceSystem = typeof meta.sourceSystem === "string" ? meta.sourceSystem : item.workProduct.provider;
  const reviewRequest = typeof meta.reviewRequest === "string" ? meta.reviewRequest : "no_action";

  return (
    <article
      className={cn(
        "border border-border bg-card p-4",
        item.workProduct.isPrimary && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.workProduct.isPrimary && <Badge variant="default">Primary</Badge>}
              <Badge variant={statusVariant(item.workProduct.status)}>
                {statusLabels[item.workProduct.status] ?? item.workProduct.status}
              </Badge>
              <Badge variant="outline">{reviewLabels[item.workProduct.reviewState] ?? item.workProduct.reviewState}</Badge>
              {meta.deliverableKind && <Badge variant="ghost">{meta.deliverableKind}</Badge>}
              {meta.channel && <Badge variant="ghost">{meta.channel}</Badge>}
            </div>
            <h3 className="truncate text-sm font-semibold">{item.workProduct.title}</h3>
            {item.workProduct.summary && (
              <p className="line-clamp-2 text-sm text-muted-foreground">{item.workProduct.summary}</p>
            )}
          </div>
          <FileText className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <span>Source: {sourceSystem}</span>
          <span>Review: {reviewRequest}</span>
          <span>
            Owner: {item.ownerAgent ? `${item.ownerAgent.name} (${item.ownerAgent.role})` : "Unassigned"}
          </span>
          <Link to={issueHref(item)} className="truncate underline underline-offset-2">
            {item.issue.identifier ?? item.issue.id.slice(0, 8)} · {item.issue.title}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isExternalHref(href) ? (
            <a href={href} target="_blank" rel="noreferrer">
              <Button size="xs" variant="outline">
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
            </a>
          ) : (
            <Button size="xs" variant="outline" asChild>
              <Link to={href}>
                <FileText className="h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
          )}
          <Button size="xs" variant="outline" asChild>
            <Link to={issueHref(item)}>Source issue</Link>
          </Button>
          {!compact && (
            <>
              <Button size="xs" onClick={() => onAction(item, "approve")}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button size="xs" variant="outline" onClick={() => onAction(item, "request_changes")}>
                Request changes
              </Button>
              <Button size="xs" variant="outline" onClick={() => onAction(item, "comment")}>
                <MessageSquare className="h-3.5 w-3.5" />
                Ask
              </Button>
              <Button size="xs" variant="outline" onClick={() => onAction(item, "queue_for_publish")}>
                <UploadCloud className="h-3.5 w-3.5" />
                Queue
              </Button>
              {canPublishViaApi(item) && (
                <Button size="xs" onClick={() => onAction(item, "publish_via_api")}>
                  <Send className="h-3.5 w-3.5" />
                  API Publish
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() => onAction(item, "send_to_openclaw")}
                disabled={!canSendToOpenClaw}
                title={canSendToOpenClaw ? "Send to OpenClaw" : "OpenClaw agent required"}
              >
                <Send className="h-3.5 w-3.5" />
                OpenClaw
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onAction(item, "archive")}>
                <Archive className="h-3.5 w-3.5" />
                Archive
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

  function openSteering(item: DeliverableListItem, action: WorkProductSteeringAction) {
    const meta = metadataFor(item);
    setSteeringDraft({ item, action });
    setComment("");
    setChannel(typeof meta.channel === "string" ? meta.channel : "");
    setOpenClawAgentId(openClawAgents.length === 1 ? openClawAgents[0]?.id ?? "" : "");
  }

  async function submitSteering() {
    if (!steeringDraft || !onSteer) return;
    setSubmitting(true);
    try {
      await onSteer(steeringDraft.item.workProduct.id, {
        action: steeringDraft.action,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(channel ? { channel: channel as WorkProductSteeringRequest["channel"] } : {}),
        ...(openClawAgentId ? { openClawAgentId } : {}),
      });
      setSteeringDraft(null);
    } finally {
      setSubmitting(false);
    }
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

      <Dialog open={Boolean(steeringDraft)} onOpenChange={(open) => !open && setSteeringDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{steeringDraft ? actionLabels[steeringDraft.action] : "Steer deliverable"}</DialogTitle>
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
                className="h-9 border border-input bg-background px-2 text-sm"
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
                className="h-9 border border-input bg-background px-2 text-sm"
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
