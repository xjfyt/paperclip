import { useEffect, useRef, useState } from "react";
import { previewEvaluationFeedbackSchema, type CreateEvaluationDataset, type EvaluationFeedbackPreview } from "@paperclipai/shared/mimouse-evaluation";
import { api } from "@/api/client";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/** Explicit provenance only. Never places feedback text into a test input. */
export function MimouseEvaluationFeedback({ root, skillId, disabled, onAdd }: { root: string; skillId: string; disabled: boolean; onAdd: (item: CreateEvaluationDataset["cases"][number]) => boolean }) {
  const { t } = useTranslation(), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [inputId, setInputId] = useState(""), [feedbackId, setFeedbackId] = useState(""), [expected, setExpected] = useState("");
  const [preview, setPreview] = useState<EvaluationFeedbackPreview | null>(null), [reviewed, setReviewed] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(false);
  function edit() { setPreview(null); setReviewed(false); setError(false); }
  async function load() {
    if (pending || disabled) return;
    edit(); setPending(true);
    try {
      const body = previewEvaluationFeedbackSchema.parse({ skillId, inputId, feedbackId, expected });
      const result = await api.post<EvaluationFeedbackPreview>(`${root}/datasets/feedback-preview`, body);
      if (alive.current) setPreview(result);
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setPending(false); }
  }
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-medium">{t("evaluationUi.feedbackTitle")}</h2>
    <p className="text-sm text-muted-foreground">{t("evaluationUi.feedbackBoundary")}</p>
    <fieldset disabled={disabled || pending} className="space-y-3">
      <label className="block space-y-1"><span>{t("evaluationUi.feedbackInputId")}</span><Input value={inputId} onChange={event => { setInputId(event.target.value); edit(); }} /></label>
      <label className="block space-y-1"><span>{t("evaluationUi.feedbackId")}</span><Input value={feedbackId} onChange={event => { setFeedbackId(event.target.value); edit(); }} /></label>
      <label className="block space-y-1"><span>{t("evaluationUi.feedbackExpected")}</span><textarea maxLength={32000} className="min-h-32 w-full rounded-md border border-border bg-background p-3 text-sm" value={expected} onChange={event => { setExpected(event.target.value); edit(); }} /></label>
      <Button disabled={!skillId || !inputId || !feedbackId || !expected} onClick={() => void load()}>{t("evaluationUi.feedbackPreview")}</Button>
      {preview && <>
        <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview, null, 2)}</pre>
        <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>{t("evaluationUi.feedbackReview")}</span></label>
        <Button disabled={!reviewed} onClick={() => {
          if (onAdd({ inputId: preview.inputId, expected: preview.expected, feedback: { feedbackId: preview.source.feedbackId, previewDigest: preview.previewDigest, reviewed: true } })) { edit(); setInputId(""); setFeedbackId(""); setExpected(""); }
          else setError(true);
        }}>{t("evaluationUi.feedbackAdd")}</Button>
      </>}
    </fieldset>
    {pending && <p role="status">{t("common.loading")}</p>}
    {error && <p role="alert">{t("evaluationUi.feedbackError")}</p>}
  </section>;
}
