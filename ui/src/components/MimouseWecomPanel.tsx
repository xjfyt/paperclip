import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { wecomApi, type WecomConnection, type WecomSecretOption, type WecomRegistration } from "@/api/wecom";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Identity = { companyId: string; userId: string; sessionId: string };
const blank = { botId: "", product: "", groups: "", senders: "", secretId: "", version: "" };
const identities = (value: string) => value.split("\n").map(item => item.trim()).filter(Boolean);
const validIdentity = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(value);
export function MimouseWecomPanel(props: Identity) {
  const { t } = useTranslation();
  if (!props.companyId || !props.userId || !props.sessionId) return <p role="alert">{t("wecomUi.denied")}</p>;
  return <Panel key={JSON.stringify([props.companyId, props.userId, props.sessionId])} {...props} />;
}
function Panel({ companyId }: Identity) {
  const { t } = useTranslation(), text = (key: string) => t(`wecomUi.${key}`);
  const controller = useMemo(() => new AbortController(), []), api = useMemo(() => wecomApi(companyId, controller.signal), [companyId, controller]);
  const live = useRef(true), lock = useRef(false);
  const [rows, setRows] = useState<WecomConnection[]>([]), [secrets, setSecrets] = useState<WecomSecretOption[]>([]);
  const [form, setForm] = useState(blank), [registerOpen, setRegisterOpen] = useState(false), [registrationConfirmed, setRegistrationConfirmed] = useState(false);
  const [pending, setPending] = useState<{ id: string; enabled: boolean } | null>(null), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false), [refreshed, setRefreshed] = useState(false);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; queueMicrotask(() => { if (!live.current) controller.abort(); }); }; }, []);
  function clear() { setForm(blank); setSecrets([]); setRegisterOpen(false); setRegistrationConfirmed(false); setPending(null); setConfirmed(false); }
  function deny() { setFailed(true); setRows([]); clear(); setNotice("denied"); }
  async function refresh() {
    if (lock.current) return; lock.current = true; setBusy(true); setConfirmed(false); setRegistrationConfirmed(false);
    try { const result = await api.list(); if (!live.current) return; setRows(result.filter(row => row.companyId === companyId)); setFailed(false); setRefreshed(true); setNotice(old => old === "denied" ? "" : old); }
    catch { if (live.current) deny(); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  async function prepare() {
    if (lock.current || uncertain) return; lock.current = true; setBusy(true); setNotice(""); clear();
    try { const result = await api.secrets(); if (!live.current) return; setSecrets(result); setRegisterOpen(true); }
    catch { if (live.current) deny(); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  async function mutate(config?: WecomRegistration) {
    if (lock.current || uncertain || (config ? !registrationConfirmed : !pending || !confirmed)) return;
    lock.current = true; setBusy(true); setNotice(""); setConfirmed(false); setRegistrationConfirmed(false);
    try {
      const result = config ? await api.register(config) : await api.enabled(pending!.id, pending!.enabled);
      if (!live.current) return;
      if (result.companyId !== companyId) throw Error("Unexpected scope");
      setRows(old => [result, ...old.filter(item => item.id !== result.id)]); clear(); setNotice(config ? "registered" : "updated");
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) deny();
      else if (error instanceof ApiError && [400, 404, 409].includes(error.status)) { setNotice("rejected"); setPending(null); }
      else { setUncertain(true); setRefreshed(false); setNotice("unknown"); }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  }
  const groups = identities(form.groups), senders = identities(form.senders), selectedSecret = secrets.find(item => item.id === form.secretId);
  const version = Number(form.version), valid = validIdentity(form.botId) && Boolean(form.product.trim()) && form.product.trim().length <= 120 && selectedSecret && Number.isSafeInteger(version) && version > 0 && version <= selectedSecret.version && groups.length <= 100 && senders.length <= 100 && groups.length + senders.length > 0 && [...groups, ...senders].every(validIdentity);
  function edit(field: keyof typeof blank, value: string) { setForm(old => ({ ...old, [field]: value })); setRegistrationConfirmed(false); }
  return <section className="space-y-3">
    <p>{text("boundary")}</p><p className="text-sm text-muted-foreground">{text("noReplay")}</p>
    {notice && !failed && <p role="status">{text(notice)}</p>}
    {failed ? <p role="alert">{text("denied")}</p> : <>
      <p className="text-xs text-muted-foreground">{text("limit")}</p>
      <fieldset disabled={busy || uncertain} className="space-y-3">
        {rows.map(row => <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
          <p className="break-all">{row.product} · {row.id}</p>
          <p>{text("state")}: {row.state} · {text("enabled")}: {text(row.enabled ? "yes" : "no")} · {text("imported")}: {row.imported}</p>
          <p>{text("groups")}: {row.allowedGroupCount} · {text("senders")}: {row.allowedDirectSenderCount} · {text("gap")}: {text(row.gapDetected ? "yes" : "no")}</p>
          <Button variant="outline" onClick={() => { setPending({ id: row.id, enabled: !row.enabled }); setConfirmed(false); }}>{text(row.enabled ? "disable" : "enable")}</Button>
        </div>)}
        {!rows.length && <p>{text("empty")}</p>}
        {pending && <div className="space-y-2 rounded-md border border-border p-3"><p className="break-all">{pending.id}</p><p>{text(pending.enabled ? "enableWarning" : "disableWarning")}</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{text("confirmChange")}</span></label>
          <div className="flex gap-2"><Button variant="outline" onClick={() => { setPending(null); setConfirmed(false); }}>{text("cancel")}</Button><Button disabled={!confirmed} onClick={() => void mutate()}>{text("apply")}</Button></div>
        </div>}
        <Button variant="outline" onClick={() => void prepare()}>{text("prepare")}</Button>
        {registerOpen && <div className="space-y-3 border-t border-border pt-3">
          <p>{text("registrar")}</p>
          {(["botId", "product", "groups", "senders"] as const).map(field => <label className="block space-y-1" key={field}><span>{text(field)}</span>{field === "groups" || field === "senders" ? <textarea aria-label={text(field)} className="w-full rounded-md border border-border bg-background p-2" value={form[field]} onChange={event => edit(field, event.target.value)} /> : <Input aria-label={text(field)} maxLength={field === "product" ? 120 : 160} value={form[field]} onChange={event => edit(field, event.target.value)} />}</label>)}
          <p className="text-xs text-muted-foreground">{text("scopeHelp")}</p>
          <label className="block">{text("secret")}<select aria-label={text("secret")} value={form.secretId} onChange={event => { const item = secrets.find(value => value.id === event.target.value); setForm(old => ({ ...old, secretId: item?.id ?? "", version: item ? String(item.version) : "" })); setRegistrationConfirmed(false); }}><option value="">{text("choose")}</option>{secrets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="block">{text("version")}<Input aria-label={text("version")} type="number" min={1} step={1} max={selectedSecret?.version} value={form.version} onChange={event => edit("version", event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">{text("pinHelp")}</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={registrationConfirmed} onChange={event => setRegistrationConfirmed(event.target.checked)} /><span>{text("confirmRegister")}</span></label>
          <div className="flex gap-2"><Button variant="outline" onClick={clear}>{text("cancel")}</Button><Button disabled={!valid || !registrationConfirmed} onClick={() => void mutate({ transport: "long_connection", botId: form.botId, product: form.product.trim(), allowedGroupIds: groups, allowedDirectSenderIds: senders, secret: { secretId: form.secretId, version } })}>{text("register")}</Button></div>
        </div>}
      </fieldset>
      {uncertain && <div className="space-y-2"><p>{text("unknown")}</p><Button variant="outline" disabled={busy || !refreshed} onClick={() => { clear(); setUncertain(false); setNotice(""); }}>{text("reconciled")}</Button></div>}
    </>}
    <Button variant="outline" disabled={busy} onClick={() => void refresh()}>{text("refresh")}</Button>
  </section>;
}
