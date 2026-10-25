import { Link } from "@/lib/router";
import { useTranslation } from "@/i18n";
export function MimouseCodingLink({ issueId, workspaceId }: { issueId: string; workspaceId?: string | null }) {
  const { t } = useTranslation();
  if (!workspaceId) return null;
  return <div className="rounded-lg border border-border p-3 text-sm">
    <Link className="underline" to={`/coding?issueId=${encodeURIComponent(issueId)}&workspaceId=${encodeURIComponent(workspaceId)}`}>{t("coding.title")}</Link>
    <p className="text-muted-foreground">{t("coding.boundary")}</p>
  </div>;
}
