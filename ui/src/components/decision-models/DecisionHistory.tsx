import { useQuery } from "@tanstack/react-query";
import { Trans } from "react-i18next";
import type { DecisionHistoryEntry } from "@paperclipai/shared";
import { decisionModelsApi } from "@/api/decision-models";
import { Link } from "@/lib/router";
import { formatDateTime, formatNumber, formatDetailedCents } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useFastResponsesEnabled } from "@/hooks/useFastResponsesEnabled";

const statuses = ["succeeded", "running", "unknown", "skipped", "pending", "failed"];
const publications = ["awaiting_consent", "pending", "streaming", "retry", "published", "suppressed", "test", "failed", "cancelled", "delivery_unknown"];
const columns = ["whenFeature", "responsible", "task", "model", "status", "duration", "tokens", "cost"];

export function DecisionHistoryTable({ entries, fastResponse = false, connectionsEnabled = true }: { entries: (DecisionHistoryEntry & { publicationStatus?: string; connectionName?: string | null })[]; fastResponse?: boolean; connectionsEnabled?: boolean }) {
  const { t } = useTranslation();
  if (!entries.length) return <p className="text-sm text-muted-foreground"><Trans
    i18nKey={`costHistoryUi.${fastResponse ? connectionsEnabled ? "emptyFast" : "emptyFastDisabled" : "emptyDecisions"}`}
    components={[<Link key="setup" to={connectionsEnabled ? "/company/settings/connections" : fastResponse ? "/company/settings/instance/experimental" : "/company/settings"} className="underline underline-offset-4" />]}
  /></p>;
  const headers = fastResponse ? [...columns.slice(0, 3), "connection", ...columns.slice(3)] : columns;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{t("costHistoryUi.privacy")}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm" aria-label={t(fastResponse ? "costHistoryUi.fastResponses" : "costHistoryUi.decisions")}>
      <thead><tr className="border-b border-border text-muted-foreground">{headers.map(key => <th key={key} className="px-3 py-2 text-left font-medium">{t(`costHistoryUi.columns.${key}`)}</th>)}</tr></thead>
      <tbody>{entries.map(row => <tr key={row.id} className="border-b border-border last:border-0">
        <td className="px-3 py-3"><div className="whitespace-nowrap">{formatDateTime(row.startedAt)}</div><div className="text-xs text-muted-foreground">{row.feature === "settings.test" ? t("costHistoryUi.setupTest") : row.feature}</div></td>
        <td className="px-3 py-3">{row.actorType === "system" ? t("costHistoryUi.services") : row.userName ?? t(row.responsibleUserId === "local-board" ? "costHistoryUi.board" : "costHistoryUi.formerUser")}</td>
        <td className="px-3 py-3">{row.issueId ? <Link className="underline underline-offset-4" to={`/issues/${row.issueIdentifier ?? row.issueId}`}>{row.issueIdentifier ?? t("costHistoryUi.viewTask")}</Link> : "—"}</td>
        {fastResponse && <td className="px-3 py-3">{row.connectionName ?? (row.connectionId ? t("costHistoryUi.removedConnection") : "—")}</td>}
        <td className="px-3 py-3 font-mono text-xs">{row.model}</td>
        <td className="px-3 py-3"><div>{statuses.includes(row.status) ? t(`costHistoryUi.status.${row.status}`) : row.status}</div>{row.publicationStatus && <div className="text-xs text-muted-foreground">{publications.includes(row.publicationStatus) ? t(`costHistoryUi.publication.${row.publicationStatus}`) : row.publicationStatus}</div>}{row.errorCode && <div className="text-xs text-muted-foreground">{row.errorCode}</div>}</td>
        <td className="px-3 py-3 font-mono">{row.durationMs === null ? "—" : formatNumber(row.durationMs / 1000, { style: "unit", unit: "second", unitDisplay: "narrow", minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
        <td className="whitespace-nowrap px-3 py-3 font-mono">{row.inputTokens === null ? "—" : formatNumber(row.inputTokens, { notation: "compact", maximumFractionDigits: 1 })} / {row.outputTokens === null ? "—" : formatNumber(row.outputTokens, { notation: "compact", maximumFractionDigits: 1 })}</td>
        <td className="px-3 py-3 font-mono"><div>{row.costCents === null ? t("costHistoryUi.unknownCost") : formatDetailedCents(row.costCents)}</div>{row.costStatus !== "unpriced" && row.costStatus && <span className="text-xs text-muted-foreground">{["estimated", "reported"].includes(row.costStatus) ? t(`costHistoryUi.cost.${row.costStatus}`) : row.costStatus}</span>}</td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}
export function DecisionHistory({ companyId, from, to }: { companyId: string; from?: string | null; to?: string | null }) {
  const { t } = useTranslation();
  const { enabled } = useFastResponsesEnabled();
  const query = useQuery({ queryKey: ["decision-history", companyId, from, to], queryFn: () => decisionModelsApi.history(companyId, from, to), refetchInterval: q => q.state.data?.some(row => row.status === "running") ? 5000 : false });
  if (query.isPending) return <p className="text-sm text-muted-foreground">{t("costHistoryUi.loadingDecisions")}</p>;
  if (query.error) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{t("costHistoryUi.failedDecisions")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("costHistoryUi.retry")}</Button></div>;
  return <DecisionHistoryTable entries={query.data ?? []} connectionsEnabled={enabled} />;
}
