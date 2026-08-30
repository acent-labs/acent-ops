import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "@/lib/router";
import { companySkillsApi } from "../api/companySkills";
import { foldersApi } from "../api/folders";
import { PageSkeleton } from "../components/PageSkeleton";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";

const CompanySkills = lazy(() =>
  import("./CompanySkills").then((module) => ({ default: module.CompanySkills })),
);

export function CompanySkillsRoute() {
  const { "*": routePath } = useParams<{ "*": string }>();
  const [searchParams] = useSearchParams();
  const { selectedCompanyId: selectedCompanyContextId } = useCompany();
  const storedCompanyId = window.localStorage.getItem("paperclip.selectedCompanyId");
  const selectedCompanyId = selectedCompanyContextId ?? storedCompanyId;
  const installedRoot = !routePath && !searchParams.get("tab");
  const skillsQuery = useQuery({
    queryKey: queryKeys.companySkills.list(selectedCompanyId ?? ""),
    queryFn: () => companySkillsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && installedRoot),
  });
  const foldersQuery = useQuery({
    queryKey: queryKeys.folders.list(selectedCompanyId ?? "", "skill"),
    queryFn: () => foldersApi.list(selectedCompanyId!, "skill"),
    enabled: Boolean(selectedCompanyId && installedRoot && skillsQuery.data),
  });
  const [bootstrapSettled, setBootstrapSettled] = useState(false);
  useEffect(() => {
    if (!installedRoot || (skillsQuery.data?.length ?? 0) === 0) return;
    setBootstrapSettled(false);
    const timer = window.setTimeout(() => setBootstrapSettled(true), 500);
    return () => window.clearTimeout(timer);
  }, [installedRoot, skillsQuery.data]);

  if (installedRoot && skillsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (installedRoot && (skillsQuery.data?.length ?? 0) > 0 && (!bootstrapSettled || (!foldersQuery.data && !foldersQuery.isError))) {
    if ((skillsQuery.data?.length ?? 0) === 0) return <PageSkeleton variant="list" />;
    return (
      <div data-testid="skills-bootstrap-data" className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {skillsQuery.data!.map((skill) => (
          <div key={skill.id} className="rounded-lg border border-border bg-card p-4 text-left">
            <span className="block truncate font-mono text-sm font-medium text-foreground">{skill.name}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {skill.tagline ?? skill.description ?? "Installed skill"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <CompanySkills />
    </Suspense>
  );
}
