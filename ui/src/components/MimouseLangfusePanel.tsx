import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
interface Pull { id: string; projectId: string; product: string; from: string; to: string; pages: number; imported: number; completed: boolean }
const blank = { origin: "https://cloud.langfuse.com", projectId: "", product: "", from: "", to: "", publicSecretId: "", publicVersion: "1", secretSecretId: "", secretVersion: "1" };
/** Key by company + human identity on the caller; the inner key also isolates company changes. */
export function MimouseLangfusePanel({ companyId, onImported }: { companyId: string; onImported?: () => void }) {
  return <Panel key={companyId} companyId={companyId} onImported={onImported} />;
}
function Panel({ companyId, onImported }: { companyId: string; onImported?: () => void }) {
  const { t } = useTranslation(), root = `/companies/${companyId}/feedback-langfuse/pulls`;
  const [rows, setRows] = useState<Pull[]>([]), [form, setForm] = useState(blank), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [restart, setRestart] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(true);
  async function run(path?: string, body?: unknown) {
    if (controller.current) return;
    const request = new AbortController(), epoch = ++generation.current;
    controller.current = request; setBusy(true); setError(""); setNotice("");
    try {
      if (path) await api.post(path, body, { signal: request.signal });
      if (!mounted.current || generation.current !== epoch) return;
      const result = await api.get<Pull[]>(root, { signal: request.signal, cache: "no-store" });
      if (!mounted.current || generation.current !== epoch) return;
      setRows(result); if (path) { setNotice("updated"); onImported?.(); } setRestart(null);
    } catch (failure) {
      if (!mounted.current || generation.current !== epoch) return;
      const code = (failure as { body?: { code?: string } })?.body?.code;
      setError(code === "unsupported" ? "unsupported" : code === "rate_limited" ? "rateLimited" : "error");
    } finally {
      if (mounted.current && generation.current === epoch) { controller.current = null; setBusy(false); }
    }
  }
  function cancel() { generation.current++; controller.current?.abort(); controller.current = null; setBusy(false); setNotice("cancelled"); }
  useEffect(() => {
    mounted.current = true; void run();
    return () => { mounted.current = false; generation.current++; controller.current?.abort(); controller.current = null; };
    // The keyed panel owns one immutable company scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("langfuseUi.title")}>
    <h2 className="font-medium">{t("langfuseUi.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("langfuseUi.boundary")}</p>
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault(); void run(root, { origin: form.origin, projectId: form.projectId, product: form.product, from: form.from, to: form.to, api: "observations_v2",
        publicKey: { secretId: form.publicSecretId, version: Number(form.publicVersion) }, secretKey: { secretId: form.secretSecretId, version: Number(form.secretVersion) } });
    }}>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(blank) as (keyof typeof blank)[]).map(field => <label key={field} className="block space-y-1"><span>{t(`langfuseUi.${field}`)}</span>
          <Input name={field} required value={form[field]} maxLength={300} type={field.endsWith("Version") ? "number" : "text"} min={field.endsWith("Version") ? 1 : undefined} onChange={event => setForm({ ...form, [field]: event.target.value })} />
        </label>)}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t("langfuseUi.credentials")}</p>
      <div className="flex items-center justify-between gap-2"><Button type="button" variant="outline" onClick={busy ? cancel : () => { setForm(blank); setRestart(null); }} >{t(busy ? "langfuseUi.cancel" : "langfuseUi.clear")}</Button><Button type="submit" disabled={busy}>{t("langfuseUi.create")}</Button></div>
    </form>
    {error && <p role="alert">{t(`langfuseUi.${error}`)}</p>}{notice && <p role="status">{t(`langfuseUi.${notice}`)}</p>}
    <Button variant="outline" disabled={busy} onClick={() => void run()}>{t("langfuseUi.refresh")}</Button>
    {!busy && !error && !rows.length && <p>{t("langfuseUi.empty")}</p>}
    {rows.map(row => <article key={row.id} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="font-medium">{row.product} · {row.projectId}</h3><p className="break-all font-mono text-xs">{row.from} — {row.to}</p>
      <p>{t(row.completed ? "langfuseUi.complete" : "langfuseUi.pending")} · {t("langfuseUi.counts", { pages: row.pages, imported: row.imported })}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || row.completed} onClick={() => void run(`${root}/${row.id}/pull`, {})}>{t("langfuseUi.pull")}</Button><Button variant="outline" disabled={busy} onClick={() => setRestart(row.id)}>{t("langfuseUi.restart")}</Button></div>
      {restart === row.id && <div className="space-y-2"><p>{t("langfuseUi.confirmRestart")}</p><div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={busy} onClick={() => setRestart(null)}>{t("langfuseUi.cancel")}</Button><Button disabled={busy} onClick={() => void run(`${root}/${row.id}/restart`, { confirm: true })}>{t("langfuseUi.confirm")}</Button></div></div>}
    </article>)}
  </section>;
}
