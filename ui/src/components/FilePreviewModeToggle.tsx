import { useTranslation } from "@/i18n";
import { Code2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FilePreviewMode = "rendered" | "raw";

export function FilePreviewModeToggle({ mode, onChange, label }: {
  mode: FilePreviewMode;
  onChange: (mode: FilePreviewMode) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      <Button type="button" size="icon-sm" variant={mode === "rendered" ? "secondary" : "ghost"} aria-label={t("documentUi.rendered")} title={t("documentUi.rendered")} aria-pressed={mode === "rendered"} onClick={() => onChange("rendered")}>
        <Eye aria-hidden />
      </Button>
      <Button type="button" size="icon-sm" variant={mode === "raw" ? "secondary" : "ghost"} aria-label={t("documentUi.raw")} title={t("documentUi.raw")} aria-pressed={mode === "raw"} onClick={() => onChange("raw")}>
        <Code2 aria-hidden />
      </Button>
    </div>
  );
}
