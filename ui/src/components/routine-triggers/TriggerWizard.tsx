import { formatDate, t, useTranslation } from "@/i18n";
import { describeManagementError, renderManagementError, type ManagementErrorDescriptor } from "@/i18n/management-errors";
import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  AlertCircle,
  Globe,
  GitBranch,
  Radio,
  Webhook,
} from "lucide-react";
import {
  SetupWizardNavigation,
  SetupWizardFooter,
} from "@/components/SetupWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { cn } from "@/lib/utils";
import { AgentInstructions, CopyField } from "./WebhookFields";
import { WebhookUrlWarning } from "./WebhookUrlWarning";

export type TriggerDraft = {
  kind: "choose" | "schedule" | "webhook";
  step: number;
  availableStep: number;
  sender: "custom" | "github";
  /** Retained when resuming webhooks created before generic signed-app support. */
  signingMode?: "bearer" | "app_webhook" | "fireflies_hmac";
  frequency: string;
  time: string;
  weekday: string;
  timezone: string;
  created: boolean;
};
export const defaultTriggerDraft: TriggerDraft = {
  kind: "choose",
  step: 0,
  availableStep: 0,
  sender: "custom",
  frequency: "weekdays",
  time: "09:00",
  weekday: "Monday",
  timezone: "America/Chicago",
  created: false,
};
// Execution payload: preserve the original instructions, protocol tokens and secrets across locale changes.
export function webhookAgentInstructions(
  sender: TriggerDraft["sender"],
  routineTitle: string,
  webhookUrl: string,
  webhookSecret: string,
  setupPending = true,
  signingMode: TriggerDraft["signingMode"] = "app_webhook",
) {
  const common = [
    `Connect the sending app to the Paperclip routine ${JSON.stringify(routineTitle)}.`,
    `Webhook URL: ${webhookUrl}`,
    "Send an HTTP POST request with a JSON object as the body (not an array or string).",
    "Content-Type: application/json",
  ];
  const auth =
    sender === "github"
      ? [
          "In GitHub, open your repository → Settings → Webhooks → Add webhook.",
          "Use the webhook URL above as Payload URL and select application/json as Content type.",
          `Secret: ${webhookSecret}`,
          "Paste this value into GitHub’s Secret field. GitHub signs requests with X-Hub-Signature-256; do not use Bearer authentication.",
          "Select the events that should start this routine, enable the webhook, and save.",
          "To check the connection, open Recent Deliveries and redeliver an event.",
        ]
      : [
          `Secret key: ${webhookSecret}`,
          ...(signingMode === "bearer" ? [] : [
            `If the app asks for a signing secret, paste the secret key above. Paperclip accepts HMAC-SHA256 over the exact request body in ${signingMode === "fireflies_hmac" ? "X-Hub-Signature" : "X-Hub-Signature or X-Hub-Signature-256"}, formatted sha256=<hex digest>.`,
          ]),
          ...(signingMode === "fireflies_hmac" ? [] : [
            `For apps with custom headers, use Authorization: Bearer ${webhookSecret}`,
          ]),
          "Subscribe only to the events that should start this routine. Public services need a publicly reachable HTTPS URL.",
          "In the sending app, add a webhook using this URL, POST method, JSON body, and headers, then save it.",
          "Send a unique Idempotency-Key header for each event and reuse it on retries, so retrying a setup test after activation cannot start the routine.",
          'Example JSON body: {"event":"deployment.completed","environment":"production"}',
          "To check the connection, send a test event from the app or perform the action that triggers a delivery.",
        ];
  return [
    ...common,
    ...auth,
    "Open Check connection in Paperclip to see whether the event arrived and authentication passed.",
    ...(setupPending
      ? [
          "During setup, deliveries only test the connection. They do not start the routine or create a task.",
          "Finish setup in Paperclip to enable this webhook for future events. Test events are not replayed.",
        ]
      : [
          "This webhook is enabled. Deliveries can start the routine and create tasks.",
        ]),
    "Store the key securely; do not put it in source control or logs.",
  ].join("\n");
}
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
function weekdayLabel(day: string) {
  const index = WEEKDAYS.indexOf(day as typeof WEEKDAYS[number]);
  return index < 0 ? day : formatDate(new Date(Date.UTC(2026, 0, 5 + index)), { weekday: "long", timeZone: "UTC" });
}
export function describeSchedule(draft: TriggerDraft) {
  const [hour, minute] = draft.time.split(":").map(Number);
  const time = /^\d{2}:\d{2}$/.test(draft.time) && hour < 24 && minute < 60
    ? formatDate(new Date(Date.UTC(2026, 0, 5, hour, minute)), { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    : draft.time;
  return t(`routineTriggerPanelsUi.${draft.frequency === "daily" ? "dailyAt" : draft.frequency === "weekly" ? "weeklyAt" : "weekdayAt"}`, { time, day: weekdayLabel(draft.weekday) });
}
export function RoutineTriggerWizard({
  initialDraft,
  onSaveExit,
  onFinish,
  onCreateWebhook,
  onRotateKey,
  routineTitle,
  routineId,
  routineActive = true,
  webhookUrl = "",
  webhookSecret = "",
  checkResult = "waiting",
}: {
  initialDraft: TriggerDraft;
  routineTitle: string;
  routineId: string;
  routineActive?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
  onCreateWebhook?: (draft: TriggerDraft) => Promise<void>;
  onRotateKey?: () => Promise<void>;
  onSaveExit: (draft: TriggerDraft) => void | Promise<void>;
  onFinish: (draft: TriggerDraft) => void | Promise<void>;
  checkResult?: "waiting" | "received" | "rejected" | "no_event";
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialDraft);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<ManagementErrorDescriptor | null>(null);
  const { setBreadcrumbs } = useBreadcrumbs();
  const perform = useCallback(
    async (action: () => void | Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setSaveError(null);
      try {
        await action();
      } catch (error) {
        setSaveError(describeManagementError(error, "routineTriggerPanelsUi.saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  const saveAndExit = useCallback(() => {
    void perform(() => onSaveExit(draft));
  }, [draft, onSaveExit, perform]);
  useEffect(() => {
    setBreadcrumbs([
      {
        label: routineTitle,
        href: `/routines/${routineId}/triggers`,
        onClick: (event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          saveAndExit();
        },
      },
      { label: t("routineTriggerPanelsUi.addTrigger") },
    ]);
  }, [saveAndExit, setBreadcrumbs, routineTitle, routineId, t]);
  const schedule = draft.kind === "schedule";
  const github = draft.sender === "github";
  const labels = schedule
    ? [t("routineTriggerPanelsUi.chooseTrigger"), t("routineTriggerPanelsUi.setSchedule"), t("routineTriggerPanelsUi.reviewSchedule")]
    : [t("routineTriggerPanelsUi.chooseTrigger"), t("routineTriggerPanelsUi.connectApp"), t("routineTriggerPanelsUi.checkConnection")];
  function patch(values: Partial<TriggerDraft>) {
    setDraft((current) => ({ ...current, ...values }));
  }
  function advance() {
    void perform(async () => {
      if (draft.kind === "webhook" && draft.step === 0 && !draft.created)
        await onCreateWebhook?.(draft);
      const step = draft.step + 1;
      patch({
        step,
        availableStep: Math.max(draft.availableStep, step),
        created:
          draft.created || (draft.kind === "webhook" && draft.step === 0),
      });
    });
  }
  const title =
    draft.step === 0
      ? t("routineTriggerPanelsUi.chooseTitle")
      : schedule
        ? draft.step === 1
          ? t("routineTriggerPanelsUi.scheduleTitle")
          : t("routineTriggerPanelsUi.reviewTitle")
        : draft.step === 1
          ? t(`routineTriggerPanelsUi.${github ? "connectGithub" : "connectApp"}`)
          : t("routineTriggerPanelsUi.checkTitle");
  const subtitle =
    draft.step === 0
      ? t("routineTriggerPanelsUi.chooseHelp", { title: routineTitle })
      : schedule
        ? draft.step === 1
          ? t("routineTriggerPanelsUi.scheduleHelp")
          : t("routineTriggerPanelsUi.reviewHelp")
        : draft.step === 1
          ? t("routineTriggerPanelsUi.connectHelp")
          : t("routineTriggerPanelsUi.checkHelp");
  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const goBack = (
    <Button variant="outline" onClick={() => patch({ step: draft.step - 1 })}>
      {t("routineTriggerPanelsUi.back")}
    </Button>
  );
  return (
    <div className="min-w-0 w-full max-w-2xl space-y-6">
      <SetupWizardNavigation
        takeover
        disabled={busy}
        ariaLabel={t("routineTriggerPanelsUi.progress")}
        labels={labels}
        step={draft.step}
        availableStep={draft.availableStep}
        onSelect={(step) => patch({ step })}
      />
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {!schedule && draft.step > 0 && <WebhookUrlWarning url={webhookUrl} />}
        {draft.step === 0 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{t("routineTriggerPanelsUi.triggerType")}</legend>
            {(
              [
                {
                  kind: "schedule",
                  label: t("routineTriggerPanelsUi.onSchedule"),
                  detail: t("routineTriggerPanelsUi.onScheduleHelp"),
                  Icon: CalendarClock,
                },
                {
                  kind: "webhook",
                  label: t("routineTriggerPanelsUi.onWebhook"),
                  detail:
                    t("routineTriggerPanelsUi.onWebhookHelp"),
                  Icon: Webhook,
                },
              ] as const
            ).map(({ kind, label, detail, Icon }) => (
              <label
                key={kind}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-4 focus-within:ring-2 focus-within:ring-ring",
                  draft.kind === kind
                    ? "border-primary bg-accent/30"
                    : "border-border hover:bg-accent/20",
                )}
              >
                <input
                  type="radio"
                  name="trigger-kind"
                  checked={draft.kind === kind}
                  disabled={draft.created && kind !== draft.kind}
                  onChange={() =>
                    patch({
                      kind,
                      availableStep:
                        kind === draft.kind ? draft.availableStep : 0,
                    })
                  }
                  className="sr-only"
                />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {detail}
                  </span>
                </span>
                {draft.kind === kind && <Check className="h-4 w-4" />}
              </label>
            ))}
          </fieldset>
        )}
        {schedule && draft.step === 1 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="repeat">{t("routineTriggerPanelsUi.repeat")}</Label>
                <select
                  id="repeat"
                  className={selectClass}
                  value={draft.frequency}
                  onChange={(event) => patch({ frequency: event.target.value })}
                >
                  <option value="daily">{t("routineTriggerPanelsUi.daily")}</option>
                  <option value="weekdays">{t("routineTriggerPanelsUi.weekdays")}</option>
                  <option value="weekly">{t("routineTriggerPanelsUi.weekly")}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="run-time">{t("routineTriggerPanelsUi.time")}</Label>
                <Input
                  id="run-time"
                  type="time"
                  value={draft.time}
                  onChange={(event) => patch({ time: event.target.value })}
                />
              </div>
            </div>
            {draft.frequency === "weekly" && (
              <div className="space-y-2">
                <Label htmlFor="run-day">{t("routineTriggerPanelsUi.day")}</Label>
                <select
                  id="run-day"
                  className={selectClass}
                  value={draft.weekday}
                  onChange={(event) => patch({ weekday: event.target.value })}
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day} value={day}>{weekdayLabel(day)}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="timezone">{t("routineTriggerPanelsUi.timezone")}</Label>
              <select
                id="timezone"
                className={selectClass}
                value={draft.timezone}
                onChange={(event) => patch({ timezone: event.target.value })}
              >
                {Array.from(
                  new Set([
                    draft.timezone,
                    "America/Chicago",
                    "America/New_York",
                    "America/Los_Angeles",
                    "Europe/London",
                    "UTC",
                  ]),
                ).map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("routineTriggerPanelsUi.timezoneHelp")}
              </p>
            </div>
          </div>
        )}
        {schedule && draft.step === 2 && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-md bg-muted/40 p-4">
              <CalendarClock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{describeSchedule(draft)}</p>
                <p className="text-xs text-muted-foreground">
                  {draft.timezone}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("routineTriggerPanelsUi.scheduledRunHelp")}
            </p>
          </div>
        )}
        {draft.step === 0 && draft.kind === "webhook" && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              {t("routineTriggerPanelsUi.sender")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    sender: "custom",
                    label: t("routineTriggerPanelsUi.customSender"),
                    Icon: Globe,
                  },
                  { sender: "github", label: "GitHub", Icon: GitBranch },
                ] as const
              ).map(({ sender, label, Icon }) => (
                <label
                  key={sender}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border p-3 focus-within:ring-2 focus-within:ring-ring",
                    draft.sender === sender
                      ? "border-primary bg-accent/30"
                      : "border-border",
                    draft.created && "cursor-default",
                  )}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="sender"
                    checked={draft.sender === sender}
                    disabled={draft.created}
                    onChange={() => patch({ sender })}
                  />
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-sm">{label}</span>
                  {draft.sender === sender && <Check className="h-4 w-4" />}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {draft.kind === "webhook" && draft.step === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("routineTriggerPanelsUi.publicUrlHelp")}
          </p>
        )}
        {!schedule && draft.step === 1 && (
          <div className="space-y-5">
            {webhookSecret && (
              <AgentInstructions
                value={webhookAgentInstructions(
                  draft.sender,
                  routineTitle,
                  webhookUrl,
                  webhookSecret,
                  true,
                  draft.signingMode,
                )}
              />
            )}
            <CopyField
              label={t(`routineTriggerPanelsUi.${github ? "payloadUrl" : "webhookUrl"}`)}
              value={webhookUrl}
            />
            {!github && draft.signingMode !== "bearer" && (
              <p className="text-sm text-muted-foreground">
                {t("routineTriggerPanelsUi.signingHelp")}
                {draft.signingMode !== "fireflies_hmac" && <>
                  {" "}{t("routineTriggerPanelsUi.headerHelp")}
                </>}
              </p>
            )}
            {webhookSecret ? (
              <CopyField
                label={t(`routineTriggerPanelsUi.${github ? "secret" : draft.signingMode === "bearer" ? "authorizationValue" : "secretKey"}`)}
                value={!github && draft.signingMode === "bearer" ? `Bearer ${webhookSecret}` : webhookSecret}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("routineTriggerPanelsUi.hiddenKeyHelp")}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void perform(() => onRotateKey?.())}
                >
                  {t("routineTriggerPanelsUi.generateKey")}
                </Button>
              </div>
            )}
          </div>
        )}
        {!schedule && draft.step === 2 && (
          <div className="space-y-5">
            <div className="space-y-1 rounded-md border border-border p-4">
              <p className="text-sm font-medium">{t("routineTriggerPanelsUi.testOnly")}</p>
              <p className="text-sm text-muted-foreground">
                {t("routineTriggerPanelsUi.testOnlyHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t(`routineTriggerPanelsUi.${github ? "sendGithub" : "sendApp"}`)}
              </p>
              <p className="text-sm text-muted-foreground">
                {github
                  ? t("routineTriggerPanelsUi.githubTestHelp")
                  : t("routineTriggerPanelsUi.appTestHelp")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("routineTriggerPanelsUi.keepOpen")}
              </p>
            </div>
            <div
              role="status"
              className="flex items-start gap-3 rounded-md bg-muted/40 p-4"
            >
              {checkResult === "received" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-(--status-task-done)" />
              ) : checkResult === "rejected" ? (
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              ) : (
                <Radio className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {checkResult === "received"
                    ? t("routineTriggerPanelsUi.received")
                    : checkResult === "rejected"
                      ? t("routineTriggerPanelsUi.rejected")
                      : checkResult === "no_event"
                        ? t("routineTriggerPanelsUi.noEvent")
                        : t("routineTriggerPanelsUi.waiting")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {checkResult === "received"
                    ? t("routineTriggerPanelsUi.receivedHelp")
                    : checkResult === "rejected"
                      ? t("routineTriggerPanelsUi.rejectedHelp")
                      : t("routineTriggerPanelsUi.waitingHelp")}
                </p>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("routineTriggerPanelsUi.troubleshoot")}
              </summary>
              <div className="space-y-3 pt-3">
                <p className="text-xs text-muted-foreground">
                  {t("routineTriggerPanelsUi.troubleshootHelp")}
                </p>
                <CopyField label={t("routineTriggerPanelsUi.webhookUrl")} value={webhookUrl} />
              </div>
            </details>
          </div>
        )}
        {!schedule && draft.step === 2 && (
          <p className="text-xs text-muted-foreground">
            {routineActive
              ? t("routineTriggerPanelsUi.finishActiveHelp")
              : t("routineTriggerPanelsUi.finishPausedHelp")}
          </p>
        )}
        {schedule && draft.step === 2 && !routineActive && (
          <p className="text-sm text-muted-foreground">
            {t("routineTriggerPanelsUi.pausedScheduleHelp")}
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {renderManagementError(saveError)}
          </p>
        )}
        <SetupWizardFooter onSaveExit={saveAndExit}>
          {draft.step > 0 && goBack}
          {draft.step === 0 ? (
            <Button disabled={draft.kind === "choose"} onClick={advance}>
              {t("routineTriggerPanelsUi.continue")}
            </Button>
          ) : schedule ? (
            draft.step === 1 ? (
              <Button disabled={!draft.time} onClick={advance}>
                {t("routineTriggerPanelsUi.reviewSchedule")}
              </Button>
            ) : (
              <Button onClick={() => void perform(() => onFinish(draft))}>
                {t("routineTriggerPanelsUi.addSchedule")}
              </Button>
            )
          ) : draft.step === 1 ? (
            <Button onClick={advance}>{t("routineTriggerPanelsUi.checkConnection")}</Button>
          ) : (
            <Button onClick={() => void perform(() => onFinish(draft))}>
              {checkResult === "received"
                ? t("routineTriggerPanelsUi.finish")
                : t("routineTriggerPanelsUi.finishUnchecked")}
            </Button>
          )}
        </SetupWizardFooter>
      </fieldset>
    </div>
  );
}
