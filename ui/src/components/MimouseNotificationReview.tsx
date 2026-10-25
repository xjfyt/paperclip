import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationReviewInput } from "@paperclipai/shared";
import { notificationApi } from "@/api/mimouse-notifications";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function MimouseNotificationReview({ companyId, delivery, onClose }: {
  companyId: string; delivery: { id: string; state: string; attempt: number }; onClose: () => void;
}) {
  const { t, i18n } = useTranslation(); const client = useQueryClient();
  const key = ["mimouse-notifications", companyId, "reviews", delivery.id];
  const history = useQuery({ queryKey: key, queryFn: () => notificationApi.reviews(companyId, delivery.id) });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState<NotificationReviewInput["outcome"]>("unknown");
  const [evidence, setEvidence] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const mutation = useMutation({ mutationFn: () => notificationApi.review(companyId, delivery.id, { requestId, confirm: true, outcome, evidence: evidence.trim(), expectedState: delivery.state as NotificationReviewInput["expectedState"], expectedAttempt: delivery.attempt }), onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); setRequestId(crypto.randomUUID()); setEvidence(""); setConfirmed(false); } });
  return <section className="rounded-lg border border-border p-4 space-y-3" aria-label={t("notifications.reviewDelivery")}>
    <h2>{t("notifications.reviewDelivery")}</h2>
    <p className="font-mono text-sm">{delivery.id} · {t(`notifications.state_${delivery.state}`)} · {delivery.attempt}</p>
    <p>{t("notifications.reviewDisclaimer")}</p>
    {history.isLoading && <p>{t("common.loading")}</p>}
    {history.error && <p role="alert">{t("notifications.loadError")}</p>}
    {history.data?.map(review => <div key={review.id} className="space-y-1">
      <h3>{t(`notifications.observed_${review.outcome}`)}</h3>
      <p className="whitespace-pre-wrap break-words">{review.evidence}</p>
      <p className="text-sm text-muted-foreground">{review.actorId} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(review.createdAt))}</p>
    </div>)}
    {mutation.error && <p role="alert">{t("notifications.reviewError")}</p>}
    <Label htmlFor="delivery-review-outcome">{t("notifications.observation")}</Label>
    <select id="delivery-review-outcome" className="rounded-md border border-border bg-background p-2" disabled={mutation.isPending} value={outcome} onChange={event => setOutcome(event.target.value as NotificationReviewInput["outcome"])}>
      {(["accepted", "not_accepted", "unknown"] as const).map(value => <option key={value} value={value}>{t(`notifications.observed_${value}`)}</option>)}
    </select>
    <Label htmlFor="delivery-review-evidence">{t("notifications.reviewEvidence")}</Label>
    <textarea id="delivery-review-evidence" className="w-full rounded-md border border-border bg-background p-2" rows={3} maxLength={1000} disabled={mutation.isPending} value={evidence} onChange={event => setEvidence(event.target.value)} />
    <label className="flex items-center gap-2"><input type="checkbox" disabled={mutation.isPending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("notifications.reviewConfirm")}</label>
    <div className="flex justify-between"><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={mutation.isPending || !confirmed || !evidence.trim()} onClick={() => mutation.mutate()}>{t("notifications.saveObservation")}</Button></div>
  </section>;
}
