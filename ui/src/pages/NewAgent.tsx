import { useTranslation } from "@/i18n";
import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { NewAgentSetup } from "../components/new-agent/NewAgentSetup";

export function NewAgent() {
  const { t } = useTranslation();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([
      { label: t("commonUi.agents"), href: "/agents" },
      { label: t("commonUi.newAgent") },
    ]);
  }, [setBreadcrumbs, t]);
  return <NewAgentSetup />;
}
