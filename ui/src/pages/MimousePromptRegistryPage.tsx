import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTranslation } from "@/i18n";
import { MimousePromptRegistry } from "./MimousePromptRegistry";

/** The registry requires a real human session, including on local-trusted servers. */
export function MimousePromptRegistryPage() {
  const { selectedCompanyId } = useCompany(), { t } = useTranslation(), { setBreadcrumbs } = useBreadcrumbs();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false });
  useEffect(() => { setBreadcrumbs([{ label: t("promptRegistryUi.title") }]); }, [setBreadcrumbs, t]);
  if (!selectedCompanyId) return <p>{t("feedbackUi.chooseCompany")}</p>;
  if (session.isPending) return <p role="status">{t("common.loading")}</p>;
  const userId = session.data?.user?.id, sessionId = session.data?.session?.id;
  if (session.isError || !userId || !sessionId) return <p role="alert">{t("promptRegistryUi.denied")}</p>;
  return <>
    {session.isFetching && <p role="status">{t("common.loading")}</p>}
    <div hidden={session.isFetching}>
      <MimousePromptRegistry companyId={selectedCompanyId} userId={userId} sessionId={sessionId} authPending={session.isFetching} authEpoch={session.dataUpdatedAt} />
    </div>
  </>;
}
