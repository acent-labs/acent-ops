import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Eye, Send, ShieldCheck } from "lucide-react";
import type { WorkProductSteeringRequest } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { useSearchParams } from "@/lib/router";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { DeliverablesPanel } from "../components/DeliverablesPanel";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "../lib/queryKeys";

type CommandCenterTab = "review" | "deliverables" | "publish" | "evidence";

type DeliverableFilters = {
  status?: string;
  reviewState?: string;
  kind?: string;
  channel?: string;
  limit: number;
  offset?: number;
};

const DELIVERABLES_PAGE_SIZE = 6;

const tabFilters: Record<CommandCenterTab, Partial<DeliverableFilters>> = {
  review: { reviewState: "needs_board_review" },
  deliverables: {},
  publish: { status: "queued_for_publish" },
  evidence: { kind: "action_evidence" },
};

function titleForTab(tab: CommandCenterTab) {
  if (tab === "review") return "Review Inbox";
  if (tab === "publish") return "Publish Queue";
  if (tab === "evidence") return "Action Evidence";
  return "Deliverables";
}

function descriptionForTab(tab: CommandCenterTab) {
  if (tab === "review") return "산출물 중 대표 검토가 필요한 것만 모아봅니다.";
  if (tab === "publish") return "승인 후 API 발행 또는 OpenClaw 반영을 기다리는 산출물입니다.";
  if (tab === "evidence") return "OpenClaw 실행 결과, 게시 URL, 스크린샷 같은 증거 산출물입니다.";
  return "Paperclip과 외부 실행 시스템이 등록한 전체 산출물입니다.";
}

export function CommandCenter() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTabState] = useState<CommandCenterTab>(
    initialTab === "deliverables" || initialTab === "publish" || initialTab === "evidence" ? initialTab : "review",
  );
  const [kind, setKind] = useState("");
  const [channel, setChannel] = useState("");
  const [deliverablesPage, setDeliverablesPage] = useState(1);

  function setTab(next: CommandCenterTab) {
    setTabState(next);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("tab", next);
      return params;
    }, { replace: true });
  }

  useEffect(() => {
    setBreadcrumbs([{ label: "Command Center" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setDeliverablesPage(1);
  }, [channel, kind, selectedCompanyId, tab]);

  const filters = useMemo<DeliverableFilters>(() => ({
    ...tabFilters[tab],
    ...(kind ? { kind } : {}),
    ...(channel ? { channel } : {}),
    limit: tab === "deliverables" ? DELIVERABLES_PAGE_SIZE + 1 : 100,
    ...(tab === "deliverables" ? { offset: (deliverablesPage - 1) * DELIVERABLES_PAGE_SIZE } : {}),
  }), [channel, deliverablesPage, kind, tab]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const openClawAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.adapterType === "openclaw_gateway" && agent.status !== "terminated"),
    [agents],
  );

  const {
    data: deliverables,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.deliverables.list(selectedCompanyId!, filters),
    queryFn: () => issuesApi.listCompanyDeliverables(selectedCompanyId!, filters),
    enabled: !!selectedCompanyId,
  });
  const visibleDeliverables = useMemo(
    () => tab === "deliverables" ? (deliverables ?? []).slice(0, DELIVERABLES_PAGE_SIZE) : (deliverables ?? []),
    [deliverables, tab],
  );
  const deliverablesHasNextPage = tab === "deliverables" && (deliverables?.length ?? 0) > DELIVERABLES_PAGE_SIZE;

  useEffect(() => {
    if (tab !== "deliverables" || isLoading || deliverablesPage <= 1) return;
    if ((deliverables?.length ?? 0) > 0) return;
    setDeliverablesPage((current) => Math.max(1, current - 1));
  }, [deliverables?.length, deliverablesPage, isLoading, tab]);

  const steer = useMutation({
    mutationFn: ({ workProductId, data }: { workProductId: string; data: WorkProductSteeringRequest }) =>
      issuesApi.steerWorkProduct(workProductId, data),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: ["deliverables", selectedCompanyId] });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId) });
      }
      pushToast({ title: "Deliverable updated", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "Steering failed",
        body: err instanceof Error ? err.message : "Unable to update deliverable",
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        message={companies.length === 0 ? "Create a company to use Command Center." : "Select a company to use Command Center."}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Paperclip이 만든 산출물과 OpenClaw 실행 증거를 검토하고 바로 steering합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setTab("review")}>
            <ShieldCheck className="h-4 w-4" />
            Review
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTab("publish")}>
            <Send className="h-4 w-4" />
            Publish
          </Button>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load deliverables"}
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as CommandCenterTab)} className="space-y-4">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="review">
            <ShieldCheck className="h-4 w-4" />
            Review Inbox
          </TabsTrigger>
          <TabsTrigger value="deliverables">
            <ClipboardCheck className="h-4 w-4" />
            Deliverables
          </TabsTrigger>
          <TabsTrigger value="publish">
            <Send className="h-4 w-4" />
            Publish Queue
          </TabsTrigger>
          <TabsTrigger value="evidence">
            <Eye className="h-4 w-4" />
            Action Evidence
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{titleForTab(tab)}</h2>
            <p className="text-xs text-muted-foreground">{descriptionForTab(tab)}</p>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Kind
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="h-8 min-w-36 cursor-pointer border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">All</option>
              <option value="briefing">Briefing</option>
              <option value="social_post">Social post</option>
              <option value="sales_deck">Sales deck</option>
              <option value="homepage_copy">Homepage copy</option>
              <option value="report">Report</option>
              <option value="action_evidence">Action evidence</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Channel
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className="h-8 min-w-32 cursor-pointer border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">All</option>
              <option value="x">X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="blog">Blog</option>
              <option value="homepage">Homepage</option>
              <option value="deck">Deck</option>
            </select>
          </label>
        </div>

        {(["review", "deliverables", "publish", "evidence"] as const).map((value) => (
          <TabsContent key={value} value={value} className="space-y-3">
            {isLoading ? (
              <PageSkeleton variant="list" />
            ) : (
              <DeliverablesPanel
                items={value === "deliverables" ? visibleDeliverables : (deliverables ?? [])}
                openClawAgents={openClawAgents}
                emptyMessage={`No ${titleForTab(value).toLowerCase()} items.`}
                onSteer={(workProductId, data) => steer.mutateAsync({ workProductId, data }).then(() => undefined)}
                pagination={value === "deliverables"
                  ? {
                    currentPage: deliverablesPage,
                    pageSize: DELIVERABLES_PAGE_SIZE,
                    hasNextPage: deliverablesHasNextPage,
                    onPageChange: setDeliverablesPage,
                  }
                  : undefined}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
