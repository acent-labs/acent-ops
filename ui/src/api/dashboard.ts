import type { DashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (companyId: string, options: { initial?: boolean } = {}) =>
    api.get<DashboardSummary>(`/companies/${companyId}/dashboard${options.initial ? "?initial=true" : ""}`),
};
