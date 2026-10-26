import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revokeLocalAuthSchema, type RevokeLocalAuthInput } from "@paperclipai/shared";
import { accessApi } from "@/api/access";
import { formatDate, formatNumber, useTranslation } from "@/i18n";
import { Button } from "./ui/button";

/** Key this component by acting account + selected user: confirmations never carry across targets. */
export function AuthRevocationPanel({ actorUserId, targetUserId }: { actorUserId: string; targetUserId: string }) {
  const { t } = useTranslation(), queryClient = useQueryClient();
  const storageKey = `mimouse:auth-revocation:${actorUserId}:${targetUserId}`;
  const [attempt, setAttempt] = useState<RevokeLocalAuthInput | null>(() => {
    try {
      const parsed = revokeLocalAuthSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"));
      return parsed.success && parsed.data.confirmUserId === targetUserId ? parsed.data : null;
    } catch { return null; }
  });
  const [reason, setReason] = useState<RevokeLocalAuthInput["reason"]>(attempt?.reason ?? "offboarding");
  const [confirmation, setConfirmation] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const busy = useRef(false);
  const queryKey = ["auth-revocations", actorUserId, targetUserId];
  const history = useQuery({ queryKey, queryFn: () => accessApi.listAuthRevocations(targetUserId), retry: false });
  const mutation = useMutation({
    mutationFn: (input: RevokeLocalAuthInput) => accessApi.revokeLocalAuth(targetUserId, input),
    onSuccess: () => { setConfirmation(""); void queryClient.invalidateQueries({ queryKey }); },
    onSettled: () => { busy.current = false; },
  });
  const receipt = mutation.data ?? history.data?.find(row => row.requestId === attempt?.requestId);
  function save(value: RevokeLocalAuthInput | null) {
    setAttempt(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); }
    catch { setStorageFailed(true); }
  }
  return <section className="space-y-3 border-t pt-4" data-testid="auth-revocation-panel">
    <h2 className="text-sm font-semibold">{t("authRevocation.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("authRevocation.scope")}</p>
    <p className="text-sm text-amber-700 dark:text-amber-300">{t("authRevocation.warning")}</p>
    <p className="break-all text-sm">{t("authRevocation.target")}: {targetUserId}</p>
    <label className="block text-sm">{t("authRevocation.reason")}
      <select value={attempt?.reason ?? reason} disabled={!!attempt || mutation.isPending} onChange={event => setReason(event.target.value as RevokeLocalAuthInput["reason"])} className="block border rounded p-2 bg-background">
        {(["offboarding", "compromised", "administrative"] as const).map(value => <option key={value} value={value}>{t(`authRevocation.${value}`)}</option>)}
      </select>
    </label>
    {attempt && <p className="break-all text-xs">{t("authRevocation.request")}: {attempt.requestId}</p>}
    {receipt ? <div role="status" className="space-y-2 text-sm">
      <p>{t("authRevocation.success", { sessions: formatNumber(receipt.sessionsRevoked), keys: formatNumber(receipt.boardKeysRevoked) })}</p>
      <p>{t("authRevocation.cutoff")}: {formatDate(new Date(receipt.cutoffAt), { dateStyle: "medium", timeStyle: "medium" })}</p>
      <Button variant="outline" onClick={() => { save(null); mutation.reset(); setConfirmation(""); }}>{t("authRevocation.newRequest")}</Button>
    </div> : <>
      <label className="block text-sm">{t("authRevocation.confirm")}
        <input className="block w-full border rounded p-2" autoComplete="off" value={confirmation} disabled={mutation.isPending} onChange={event => setConfirmation(event.target.value)} />
      </label>
      <Button variant="destructive" disabled={mutation.isPending || confirmation !== targetUserId} onClick={() => {
        if (busy.current || confirmation !== targetUserId) return;
        busy.current = true;
        const input = attempt ?? { requestId: crypto.randomUUID(), confirmUserId: targetUserId, reason };
        save(input); mutation.mutate(input);
      }}>{mutation.isPending ? t("authRevocation.working") : attempt ? t("authRevocation.retry") : t("authRevocation.submit")}</Button>
    </>}
    {mutation.isError && <p role="alert">{t("authRevocation.uncertain")}</p>}
    {storageFailed && <p role="alert">{t("authRevocation.storageFailed")}</p>}
    <h3 className="text-sm font-medium">{t("authRevocation.history")}</h3>
    {history.isPending ? <p role="status">{t("authRevocation.loading")}</p> : history.isError ? <p role="alert">{t("authRevocation.historyFailed")}</p> : <ul className="space-y-2 text-xs">
      {(history.data ?? []).map(row => <li key={row.requestId} className="break-all">{formatDate(new Date(row.createdAt), { dateStyle: "medium", timeStyle: "short" })} · {t(`authRevocation.${row.reason}`)} · {t("authRevocation.success", { sessions: formatNumber(row.sessionsRevoked), keys: formatNumber(row.boardKeysRevoked) })} · {row.requestId}</li>)}
    </ul>}
  </section>;
}
