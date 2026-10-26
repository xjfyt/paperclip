import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { evaluateCapabilityEvidence, type AppendCapabilityEvidence } from "@paperclipai/shared/capability-evidence";
import { capabilityEvidenceApi } from "@/api/capability-evidence";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Admin inspection surface. Does not alter the fixture panel or execution controls. */
export function CapabilityEvidenceLedger({ companyId, adapterType }: { companyId: string; adapterType: string }) {
  // Remount on company change, so a pending confirmation cannot cross tenants.
  return <Ledger key={`${companyId}:${adapterType}`} companyId={companyId} adapterType={adapterType} />;
}
function Ledger({ companyId, adapterType }: { companyId: string; adapterType: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["capability-evidence", companyId];
  const [confirmation, setConfirmation] = useState<AppendCapabilityEvidence | null>(null);
  const query = useInfiniteQuery({ queryKey, initialPageParam: 0,
    queryFn: ({ pageParam }) => capabilityEvidenceApi.list(companyId, pageParam),
    getNextPageParam: page => page.nextRevision ?? undefined,
    staleTime: 0,
  });
  const events = query.data?.pages.flatMap(page => page.events) ?? [];
  const [now, setNow] = useState(Date.now);
  const nextExpiry = Math.min(...events.flatMap(event => event.receipt ? [Date.parse(event.receipt.expiresAt)] : []).filter(time => time > now));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, nextExpiry - Date.now()) + 1));
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  const complete = query.isSuccess && !query.hasNextPage && !query.isFetching;
  const mutation = useMutation({ mutationFn: (input: AppendCapabilityEvidence) => capabilityEvidenceApi.append(companyId, input),
    onSuccess: async () => { setConfirmation(null); await client.invalidateQueries({ queryKey }); },
  });
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("capabilityEvidence.title")}>
    <h3 className="text-sm font-medium">{t("capabilityEvidence.title")}</h3>
    <p className="text-xs text-muted-foreground">{t("capabilityEvidence.disclaimer")}</p>
    {query.isPending && <p role="status">{t("capabilityEvidence.loading")}</p>}
    {query.isError && <p role="alert">{t("capabilityEvidence.loadError")}</p>}
    <Button variant="outline" disabled={query.isFetching || mutation.isPending} onClick={() => void query.refetch()}>{t("capabilityEvidence.refresh")}</Button>
    {query.hasNextPage && <Button variant="outline" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{t("capabilityEvidence.more")}</Button>}
    {complete && !events.length && <p>{t("capabilityEvidence.empty")}</p>}
    <ul className="space-y-3">{events.filter(event => event.receipt?.adapterType === adapterType).map(event => {
      const receipt = event.receipt!;
      const status = complete ? evaluateCapabilityEvidence(companyId, receipt, events, Math.max(now, Date.now())) : null;
      const retired = events.some(candidate => candidate.targetId === event.id);
      return <li key={event.id} className="space-y-1 rounded border border-border p-3">
        <p className="text-sm font-medium">{t(`adapterCapabilities.${receipt.capability}`)} · {receipt.level} · {t(`capabilityEvidence.${receipt.result}`)}</p>
        <p className="text-xs">{status?.latestReceiptId === event.id && status.manualAttestation ? t("capabilityEvidence.manualActive") : t("capabilityEvidence.notActive")}</p>
        <dl className="text-xs font-mono">
          <dt>{t("capabilityEvidence.context")}</dt><dd>{receipt.runtime} / {receipt.runtimeVersion} / {receipt.environmentAlias} / {receipt.accountAlias}</dd>
          <dt>{t("capabilityEvidence.source")}</dt><dd>{receipt.sourceResourceId} / {receipt.sourceRunId}</dd>
          <dt>{t("capabilityEvidence.commit")}</dt><dd>{receipt.testedCommit}</dd>
          <dt>{t("capabilityEvidence.validity")}</dt><dd>{receipt.testedAt} → {receipt.expiresAt}</dd>
          <dt>{t("capabilityEvidence.reviewer")}</dt><dd>{event.reviewerId} · {event.createdAt}</dd>
          <dt>{t("capabilityEvidence.receipt")}</dt><dd>{event.id} · {event.revision}</dd>
        </dl>
        <Button variant="outline" disabled={!complete || retired || mutation.isPending || Boolean(confirmation)} onClick={() => {
          setConfirmation({ action: "revoke", targetId: event.id, expectedRevision: Math.max(0, ...events.map(item => item.revision)), idempotencyKey: crypto.randomUUID(), reason: "incorrect" });
        }}>{t("capabilityEvidence.revoke")}</Button>
      </li>;
    })}</ul>
    {confirmation && <div className="space-y-3" role="group" aria-label={t("capabilityEvidence.confirm")}>
      <p>{t("capabilityEvidence.confirm")}</p>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={mutation.isPending} onClick={() => { setConfirmation(null); mutation.reset(); }}>{t("capabilityEvidence.cancel")}</Button>
        <Button disabled={mutation.isPending} onClick={() => mutation.mutate(confirmation)}>{t("capabilityEvidence.revoke")}</Button>
      </div>
      {mutation.isError && <p role="alert">{t("capabilityEvidence.writeError")}</p>}
    </div>}
  </section>;
}
