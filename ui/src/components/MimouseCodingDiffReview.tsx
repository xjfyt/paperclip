import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { readCodingEvidence } from "@/api/coding-read";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
interface Diff { evidence: unknown; artifactManifest: unknown; baseSha: string; headSha: string; projectId: number; repository: string; digest: string; patch: string; fileCount: number; complete: boolean; blockers: string[] }
type Props = { companyId: string; userId: string; sessionId: string; authEpoch: number; deliveryId: string; headSha: string; onReviewed: () => Promise<unknown> };
export function MimouseCodingDiffReview({ companyId, userId, sessionId, authEpoch, deliveryId, headSha, onReviewed }: Props) {
  const { t } = useTranslation(); const [open, setOpen] = useState(false);
  return <div><Button variant="outline" onClick={() => setOpen(value => !value)}>{t("codingDiff.title")}</Button>
    {open && <Review key={`${companyId}:${userId}:${sessionId}:${authEpoch}:${deliveryId}:${headSha}`} companyId={companyId} userId={userId} sessionId={sessionId} authEpoch={authEpoch} deliveryId={deliveryId} headSha={headSha} onReviewed={onReviewed} onClose={() => setOpen(false)} />}
  </div>;
}
function Review({ companyId, userId, sessionId, authEpoch, deliveryId, headSha, onReviewed, onClose }: Props & { onClose: () => void }) {
  const { t } = useTranslation(); const [approvedDigest, setApprovedDigest] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const root = `/companies/${companyId}/coding/${deliveryId}`;
  const query = useQuery({ queryKey: ["coding-diff", companyId, userId, sessionId, authEpoch, deliveryId, headSha], queryFn: ({ signal }) => readCodingEvidence<Diff>(`${root}/diff`, signal), staleTime: 0, gcTime: 0, retry: false });
  const mutation = useMutation({ mutationFn: (diff: Diff) => api.post(`${root}/review`, { headSha: diff.headSha, baseSha: diff.baseSha, digest: diff.digest, confirm: true }), retry: false,
    onSuccess: async () => { if (!active.current) return; await onReviewed(); if (active.current) onClose(); }, onError: () => { if (active.current) setApprovedDigest(null); } });
  const diff = !query.isFetching && !query.isError ? query.data : undefined;
  const available = userId !== "local-board" && diff?.headSha === headSha && diff.complete;
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="font-medium">{t("codingDiff.title")}</h3><p className="text-sm text-muted-foreground">{t("codingDiff.boundary")}</p>
    {userId === "local-board" && <p role="alert">{t("codingDiff.loginRequired")}</p>}
    {query.isFetching && <p role="status">{t("common.loading")}</p>}
    {(query.isError || mutation.isError) && <p role="alert">{t("codingDiff.error")}</p>}
    {diff && <><p className="break-all font-mono text-sm">{diff.repository} · {diff.projectId}<br />{diff.baseSha} → {diff.headSha}</p>
      <p>{t("codingDiff.files", { count: diff.fileCount })}</p><p className="break-all font-mono text-xs">{diff.digest}</p>
      {!diff.complete && <p role="alert">{t("codingDiff.incomplete")}: {diff.blockers.join(", ")}</p>}
      <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">{diff.patch || t("codingDiff.empty")}</pre>
      <details><summary>{t("codingDiff.evidence")}</summary><pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify({ evidence: diff.evidence, artifactManifest: diff.artifactManifest }, null, 2)}</pre></details>
      <label className="flex items-center gap-2"><input type="checkbox" disabled={!available || mutation.isPending} checked={available && approvedDigest === diff.digest} onChange={event => setApprovedDigest(event.target.checked ? diff.digest : null)} />{t("codingDiff.confirm")}</label>
    </>}
    <div className="flex justify-between gap-2"><Button variant="outline" onClick={onClose} disabled={mutation.isPending}>{t("common.cancel")}</Button>
      <Button disabled={!available || !diff || approvedDigest !== diff.digest || mutation.isPending} onClick={() => { if (diff) mutation.mutate(diff); }}>{t("codingDiff.save")}</Button></div>
  </section>;
}
