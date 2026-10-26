import { useQuery } from "@tanstack/react-query";
import { accessApi } from "@/api/access";
import type { CompanySetupCapabilities } from "@paperclipai/shared";
export function agentCreationIsReady(data: CompanySetupCapabilities | undefined, refreshing: boolean, failed: boolean) {
  return data?.canCreateAgents === true && !refreshing && !failed;
}
/** Fail closed while loading, refetching or on error, including stale grants. */
export function useCompanyAgentCreationAccess(companyId: string | null | undefined) {
  const query = useQuery({ queryKey: ["company-setup-capabilities", companyId], queryFn: () => accessApi.getCompanySetupCapabilities(companyId!), enabled: !!companyId, retry: false, staleTime: 0 });
  return { allowed: agentCreationIsReady(query.data, query.isFetching, query.isError), pending: query.isPending || query.isFetching, failed: query.isError };
}
