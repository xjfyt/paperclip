import { useTranslation } from "@/i18n";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { copyTextToClipboard } from "@/lib/clipboard";
import { AgentSetupPrompt } from "@/components/AgentSetupPrompt";

export function CopyField({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <code title={value} className="min-w-0 flex-1 truncate text-xs">
          {value}
        </code>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("routineTriggerPanelsUi.copyLabel", { label })}
          onClick={async () => {
            try {
              await copyTextToClipboard(value);
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {t(copied ? "routineTriggerPanelsUi.copied" : "routineTriggerPanelsUi.copy")}
        </Button>
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">
            {t("routineTriggerPanelsUi.copyFailed")}
          </p>
          <textarea
            readOnly
            aria-label={t("routineTriggerPanelsUi.textLabel", { label })}
            value={value}
            rows={5}
            className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          />
        </div>
      )}
    </div>
  );
}

export function AgentInstructions({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("routineTriggerPanelsUi.agentInstructions")}
      className="space-y-3 rounded-md bg-muted/40 p-4"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{t("routineTriggerPanelsUi.agentInstructions")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("routineTriggerPanelsUi.agentInstructionsHelp")}
        </p>
      </div>
      <AgentSetupPrompt
        prompt={value}
        label={t("routineTriggerPanelsUi.copyForAgent")}
        title={t("routineTriggerPanelsUi.webhookSetup")}
        description={t("routineTriggerPanelsUi.agentPromptHelp")}
      />
    </section>
  );
}
