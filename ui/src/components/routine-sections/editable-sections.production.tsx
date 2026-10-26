import { Trans } from "react-i18next";
import { useTranslation, i18n } from "@/i18n";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Braces,
  Clock3,
  Edit3,
  KeyRound,
  Play,
  Plus,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioCardGroup } from "@/components/ui/radio-card";
import { cn } from "@/lib/utils";
import { nextCronFires, previewFirePolicies } from "../../lib/cron-fires";
import { timeAgo } from "../../lib/timeAgo";
import { EmptyState } from "../EmptyState";
import { InlineEntitySelector } from "../InlineEntitySelector";
import { DocumentAnnotationsCountChip, IssueDocumentAnnotations } from "../IssueDocumentAnnotations";
import { MarkdownEditor } from "../MarkdownEditor";
import { ScheduleEditor, getScheduleCronValidation } from "../ScheduleEditor";
import { RoutineVariablesEditor, RoutineVariablesHint } from "../RoutineVariablesEditor";
import { RoutineTriggerCard } from "../RoutineTriggerCard";
import { EnvironmentVariablesEditor } from "../environment-variables-editor";
import { createDefaultNewTrigger, useRoutineDetail } from "./context";
import type { EnvBinding, RoutineDetail as RoutineDetailType } from "@paperclipai/shared";

const routineRunStatusKeys: Record<string, string> = {
  received: "managementUi.routineStatusReceived", coalesced: "managementUi.routineStatusCoalesced",
  skipped: "managementUi.routineStatusSkipped", issue_created: "managementUi.routineStatusIssueCreated",
  completed: "managementUi.routineStatusCompleted", failed: "statuses.failed",
};

const concurrencyPolicyOptions = [
  {
    value: "coalesce_if_active",
    title: "managementUi.routineCoalesceTitle",
    description: "managementUi.routineCoalesceHelp",
  },
  {
    value: "always_enqueue",
    title: "managementUi.routineEnqueueTitle",
    description: "managementUi.routineEnqueueHelp",
  },
  {
    value: "skip_if_active",
    title: "managementUi.routineSkipTitle",
    description: "managementUi.routineSkipHelp",
  },
];

const catchUpPolicyOptions = [
  {
    value: "skip_missed",
    title: "managementUi.routineMissedTitle",
    description: "managementUi.routineMissedHelp",
  },
  {
    value: "enqueue_missed_with_cap",
    title: "managementUi.routineCatchUpTitle",
    description: "routineOps.catchUp",
  },
];

const activityGatePolicyOptions = [
  {
    value: "always",
    title: "managementUi.routineEveryTickTitle",
    description: "managementUi.routineEveryTickHelp",
  },
  {
    value: "require_external_activity",
    title: "managementUi.routineActivityTitle",
    description:
      "managementUi.routineActivityHelp",
  },
];

const activityGateScopeOptions = [
  {
    value: "company",
    title: "managementUi.routineLegacyCompanyScope",
    description: "managementUi.routineLegacyCompanyScopeHelp",
  },
  {
    value: "project",
    title: "managementUi.routineProjectScope",
    description: "managementUi.routineProjectScopeHelp",
  },
];

const triggerKinds = ["schedule", "webhook"];
const signingModes = ["app_webhook", "bearer", "hmac_sha256", "github_hmac", "none"];
const SIGNING_MODES_WITHOUT_REPLAY_WINDOW = new Set(["app_webhook", "bearer", "github_hmac", "fireflies_hmac", "none"]);

export function OverviewSection({
  defaultDescriptionAnnotationsOpen = false,
}: {
  defaultDescriptionAnnotationsOpen?: boolean;
} = {}) {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const {
    routine,
    editDraft,
    setEditDraft,
    assigneeOptions,
    projectOptions,
    recentAssigneeIds,
    recentProjectIds,
    agentById,
    projectById,
    currentAssignee,
    currentProject,
    mentionOptions,
    assigneeSelectorRef,
    projectSelectorRef,
    descriptionEditorRef,
    routineRuns,
    activity,
    saveRoutine,
    saveConflict,
    isSectionDirty,
    navigateToSection,
  } = ctx;
  const [descriptionAnnotationsOpen, setDescriptionAnnotationsOpen] = useState(defaultDescriptionAnnotationsOpen);

  const activeTriggers = routine.triggers.length;
  const nextFire = useMemo(() => {
    const upcoming = routine.triggers
      .filter((trigger) => trigger.kind === "schedule" && trigger.nextRunAt)
      .map((trigger) => new Date(trigger.nextRunAt as Date))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return upcoming ? upcoming.toLocaleString(i18n.language) : null;
  }, [routine.triggers, i18n.language]);
  const boundSecrets = editDraft.env ? Object.keys(editDraft.env).length : 0;
  const lastRun = (routineRuns ?? [])[0] ?? null;
  const lastRunStatus = lastRun ? (routineRunStatusKeys[lastRun.status]
    ? t(routineRunStatusKeys[lastRun.status]) : lastRun.status.replaceAll("_", " ")) : "";
  const recentActivity = (activity ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Assignment row */}
      <div className="overflow-x-auto overscroll-x-contain">
        <div className="inline-flex min-w-full flex-wrap items-center gap-2 text-sm text-muted-foreground sm:min-w-max sm:flex-nowrap">
          <span>{t("routineOps.for")}</span>
          <InlineEntitySelector
            ref={assigneeSelectorRef}
            value={editDraft.assigneeAgentId}
            options={assigneeOptions}
            recentOptionIds={recentAssigneeIds}
            placeholder={t("commonUi.responsible")}
            noneLabel={t("routineOps.noResponsible")}
            searchPlaceholder={t("routineOps.searchResponsible")}
            emptyMessage={t("workflow.noResponsibleFound")}
            onChange={(assigneeAgentId) =>
              setEditDraft((current) => ({ ...current, assigneeAgentId }))
            }
            onConfirm={() => {
              if (editDraft.projectId) {
                descriptionEditorRef.current?.focus();
              } else {
                projectSelectorRef.current?.focus();
              }
            }}
            renderTriggerValue={(option) =>
              option ? (
                currentAssignee ? (
                  <>
                    <AgentAvatar agent={currentAssignee} size={16} className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
                    <span className="truncate">{option.label}</span>
                  </>
                ) : (
                  <span className="truncate">{option.label}</span>
                )
              ) : (
                <span className="text-muted-foreground">{t("commonUi.responsible")}</span>
              )
            }
            renderOption={(option) => {
              if (!option.id) return <span className="truncate">{option.label}</span>;
              const assignee = agentById.get(option.id);
              return (
                <>
                  {assignee ? (
                    <AgentAvatar agent={assignee} size={16} className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </>
              );
            }}
          />
          <span>{t("managementUi.routineIn")}</span>
          <InlineEntitySelector
            ref={projectSelectorRef}
            value={editDraft.projectId}
            options={projectOptions}
            recentOptionIds={recentProjectIds}
            placeholder={t("commonUi.project")}
            noneLabel={t("commonUi.noProject")}
            searchPlaceholder={t("routineOps.searchProjects")}
            emptyMessage={t("workflow.noProjects")}
            onChange={(projectId) => setEditDraft((current) => ({ ...current, projectId }))}
            onConfirm={() => descriptionEditorRef.current?.focus()}
            renderTriggerValue={(option) =>
              option && currentProject ? (
                <>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: currentProject.color ?? "var(--project-none)" }}
                  />
                  <span className="truncate">{option.label}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{t("commonUi.project")}</span>
              )
            }
            renderOption={(option) => {
              if (!option.id) return <span className="truncate">{option.label}</span>;
              const project = projectById.get(option.id);
              return (
                <>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: project?.color ?? "var(--project-none)" }}
                  />
                  <span className="truncate">{option.label}</span>
                </>
              );
            }}
          />
        </div>
      </div>

      {!routine.assigneeAgentId ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-200">
          {t("managementUi.routineDefaultRequired")}
        </div>
      ) : null}

      {/* Instructions */}
      <div className="space-y-2">
        <div className="flex items-center justify-end">
          {routine.descriptionDocument ? (
            <DocumentAnnotationsCountChip
              issueId={routine.id}
              docKey="description"
              target={{ kind: "routine", routineId: routine.id, documentKey: "description" }}
              panelOpen={descriptionAnnotationsOpen}
              onToggle={() => setDescriptionAnnotationsOpen((open) => !open)}
            />
          ) : null}
        </div>
        {routine.descriptionDocument ? (
          <IssueDocumentAnnotations
            issueId={routine.id}
            doc={routine.descriptionDocument}
            target={{ kind: "routine", routineId: routine.id, documentKey: "description" }}
            bodyMarkdown={editDraft.description}
            draftDirty={isSectionDirty("overview") || saveRoutine.isPending}
            draftConflicted={saveConflict}
            historicalPreview={false}
            locationHash={typeof window === "undefined" ? "" : window.location.hash}
            panelOpen={descriptionAnnotationsOpen}
            onPanelOpenChange={setDescriptionAnnotationsOpen}
          >
            <MarkdownEditor
              ref={descriptionEditorRef}
              value={editDraft.description}
              onChange={(description) => setEditDraft((current) => ({ ...current, description }))}
              placeholder={t("commonUi.instructions")}
              bordered={false}
              contentClassName="min-h-(--sz-120px) text-sm leading-7"
              mentions={mentionOptions}
              onSubmit={() => {
                if (!saveRoutine.isPending && editDraft.title.trim()) {
                  saveRoutine.mutate();
                }
              }}
            />
          </IssueDocumentAnnotations>
        ) : (
          <MarkdownEditor
            ref={descriptionEditorRef}
            value={editDraft.description}
            onChange={(description) => setEditDraft((current) => ({ ...current, description }))}
            placeholder={t("commonUi.instructions")}
            bordered={false}
            contentClassName="min-h-(--sz-120px) text-sm leading-7"
            mentions={mentionOptions}
            onSubmit={() => {
              if (!saveRoutine.isPending && editDraft.title.trim()) {
                saveRoutine.mutate();
              }
            }}
          />
        )}
      </div>

      {/* Variables peek */}
      <div className="space-y-3">
        <RoutineVariablesHint />
        <RoutineVariablesEditor
          title={editDraft.title}
          description={editDraft.description}
          value={editDraft.variables}
          onChange={(variables) => setEditDraft((current) => ({ ...current, variables }))}
        />
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={Clock3}
          label={t("routineScheduleUi.triggers")}
          value={activeTriggers === 0 ? t("liveUi.none") : t("managementUi.routineActiveCount", { count: activeTriggers })}
          hint={nextFire ? t("managementUi.routineNextFire", { time: nextFire }) : t("managementUi.routineNoSchedule")}
          to={() => navigateToSection("triggers")}
          ariaLabel={t("managementUi.routineTriggers", { count: activeTriggers })}
        />
        <SummaryCard
          icon={KeyRound}
          label={t("browserQa.secrets")}
          value={boundSecrets === 0 ? t("liveUi.none") : t("managementUi.routineBoundCount", { count: boundSecrets })}
          hint={t("managementUi.routineManageSecrets")}
          to={() => navigateToSection("secrets")}
          ariaLabel={t("managementUi.routineSecrets", { count: boundSecrets })}
        />
        <SummaryCard
          icon={Play}
          label={t("routineOps.lastRun")}
          value={lastRun ? lastRunStatus : t("browserQa.noRuns")}
          hint={lastRun ? timeAgo(lastRun.triggeredAt) : t("managementUi.routineTriggerRun")}
          to={() => navigateToSection("runs")}
          ariaLabel={lastRun ? t("managementUi.routineLastRun", { status: lastRunStatus }) : t("managementUi.routineNoRuns")}
        />
      </div>

      {/* Recent activity */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("liveUi.recentActivity")}
        </p>
        {recentActivity.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("managementUi.routineNoActivity")}</p>
        ) : (
          <div className="divide-y divide-border/60">
            {recentActivity.map((event) => (
              <div key={event.id} className="flex items-center gap-2 py-1.5 text-xs">
                <Badge variant="outline" className="shrink-0 font-mono">
                  {event.action}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {event.details && Object.keys(event.details).length > 0
                    ? Object.keys(event.details).slice(0, 3).join(" · ")
                    : ""}
                </span>
                <span className="shrink-0 text-muted-foreground/60">{timeAgo(event.createdAt)}</span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => navigateToSection("activity")}
              className="flex items-center gap-1 pt-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("managementUi.routineAllActivity")} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  to,
  ariaLabel,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  hint: string;
  to: () => void;
  ariaLabel: string;
}) {
  return (
    <button type="button" onClick={to} aria-label={ariaLabel} className="text-left">
      <Card className="gap-2 p-4 transition-colors hover:border-border hover:bg-accent/30">
        <CardContent className="space-y-1 p-0">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {label}
            <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
          <p className="text-lg font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </button>
  );
}

export function TriggersSection() {
  const { t } = useTranslation();
  const signingDescriptions: Record<string, string> = {
    bearer: t("managementUi.routineSigningBearer", { header: "Authorization: Bearer <secret>" }),
    hmac_sha256: t("managementUi.routineSigningHmac", { timestamp: "X-Paperclip-Timestamp", signature: "X-Paperclip-Signature: sha256=<hex>" }),
    github_hmac: t("managementUi.routineSigningGithub", { header: "X-Hub-Signature-256" }),
    app_webhook: t("managementUi.routineSigningApp", { header: "X-Hub-Signature", header256: "X-Hub-Signature-256" }),
    fireflies_hmac: t("managementUi.routineSigningLegacy"),
    none: t("managementUi.routineSigningNone"),
  };
  const ctx = useRoutineDetail();
  const { routine, newTrigger, setNewTrigger, createTrigger, updateTrigger, deleteTrigger, rotateTrigger, secretMessage, copySecretValue, setSecretMessage } = ctx;
  const [addOpen, setAddOpen] = useState(false);
  const [newScheduleEditorValid, setNewScheduleEditorValid] = useState(true);
  const newScheduleValidation = useMemo(
    () => newTrigger.kind === "schedule" ? getScheduleCronValidation(newTrigger.cronExpression) : null,
    [newTrigger.cronExpression, newTrigger.kind],
  );
  const addDisabled =
    createTrigger.isPending ||
    (newScheduleValidation ? !newScheduleValidation.valid || !newScheduleEditorValid : false);

  useEffect(() => {
    if (newTrigger.kind !== "schedule") setNewScheduleEditorValid(true);
  }, [newTrigger.kind]);

  return (
    <div className="space-y-4">
      {/* Add-trigger drawer header (§3.2) */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {routine.triggers.length === 0
            ? t("managementUi.routineNoTriggers")
            : t("managementUi.routineTriggerCount", { count: routine.triggers.length })}
        </p>
        <Button
          size="sm"
          variant={addOpen ? "secondary" : "default"}
          onClick={() => setAddOpen((open) => !open)}
          aria-expanded={addOpen}
        >
          {addOpen ? (
            <>
              <X className="mr-1.5 h-3.5 w-3.5" />
              {t("commonUi.cancel")}
            </>
          ) : (
            <>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("managementUi.routineNewTrigger")}
            </>
          )}
        </Button>
      </div>

      {/* Add trigger form — expand-on-click drawer */}
      {addOpen ? (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">{t("managementUi.routineAddTrigger")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("managementUi.routineKind")}</Label>
            <Select
              value={newTrigger.kind}
              onValueChange={(kind) => setNewTrigger((current) => ({ ...current, kind }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggerKinds.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`routineScheduleUi.kind_${kind}`, { defaultValue: kind })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {newTrigger.kind === "schedule" && (
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">{t("routineScheduleUi.schedule")}</Label>
              <ScheduleEditor
                value={newTrigger.cronExpression}
                onChange={(cronExpression) =>
                  setNewTrigger((current) => ({ ...current, cronExpression }))
                }
                onValidityChange={setNewScheduleEditorValid}
              />
            </div>
          )}
          {newTrigger.kind === "webhook" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("routineScheduleUi.signing")}</Label>
                <Select
                  value={newTrigger.signingMode}
                  onValueChange={(signingMode) =>
                    setNewTrigger((current) => ({ ...current, signingMode }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {signingModes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`routineScheduleUi.signing_${mode}`, { defaultValue: mode })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {signingDescriptions[newTrigger.signingMode]}
                </p>
              </div>
              {!SIGNING_MODES_WITHOUT_REPLAY_WINDOW.has(newTrigger.signingMode) && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("routineScheduleUi.replay")}</Label>
                  <Input
                    value={newTrigger.replayWindowSec}
                    onChange={(event) =>
                      setNewTrigger((current) => ({ ...current, replayWindowSec: event.target.value }))
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
            {t("commonUi.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              createTrigger.mutate(undefined, {
                onSuccess: () => {
                  setNewTrigger(createDefaultNewTrigger());
                  setAddOpen(false);
                },
              })
            }
            disabled={addDisabled}
          >
            {createTrigger.isPending ? t("managementUi.routineAdding") : t("managementUi.routineAddTrigger")}
          </Button>
        </div>
      </div>
      ) : null}

      {secretMessage ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
          <div>
            <p className="font-medium">{secretMessage.title}</p>
            <p className="text-xs text-muted-foreground">
              {t("managementUi.routineSecretOnce")}
            </p>
          </div>
          <div className="space-y-3">
            {secretMessage.entries.map((entry, index) => (
              <div key={`${entry.webhookUrl}-${index}`} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input aria-label={t("managementUi.routineNewWebhookUrl")} value={entry.webhookUrl} readOnly className="flex-1" />
                  <Button variant="outline" size="sm" onClick={() => copySecretValue(t("routineScheduleUi.webhookUrl"), entry.webhookUrl)}>
                    URL
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input aria-label={t("managementUi.routineNewWebhookSecret")} value={entry.webhookSecret} readOnly className="flex-1" />
                  <Button variant="outline" size="sm" onClick={() => copySecretValue(t("managementUi.routineWebhookSecret"), entry.webhookSecret)}>
                    {t("managementUi.routineSecret")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setSecretMessage(null)}>{t("shell.done")}</Button>
        </div>
      ) : null}

      {/* Existing triggers */}
      {routine.triggers.length === 0 ? (
        <EmptyState
          icon={Clock3}
          message={t("managementUi.routineNoTriggers")}
          action={t("managementUi.routineAddATrigger")}
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {routine.triggers.map((trigger) => (
            <RoutineTriggerCard
              key={trigger.id}
              trigger={trigger}
              onSave={(id, patch) => updateTrigger.mutate({ id, patch })}
              onRotate={(id) => rotateTrigger.mutate(id)}
              onDelete={(id) => deleteTrigger.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function VariablesSection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const { editDraft, setEditDraft, navigateToSection } = ctx;
  const hasVariables = editDraft.variables.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-4 py-3 text-xs">
        <span className="flex-1 text-muted-foreground">
          <Trans i18nKey="managementUi.routineVariablesHelp" values={{ example: "{{placeholders}}" }} components={[<code className="font-mono" />]} />
        </span>
        <Button variant="secondary" size="sm" onClick={() => navigateToSection("overview")}>
          <Edit3 className="mr-1.5 h-3.5 w-3.5" />
          {t("managementUi.routineEditInstructions")}
        </Button>
      </div>

      {hasVariables ? (
        <RoutineVariablesEditor
          title={editDraft.title}
          description={editDraft.description}
          value={editDraft.variables}
          onChange={(variables) => setEditDraft((current) => ({ ...current, variables }))}
        />
      ) : (
        <EmptyState
          icon={Braces}
          message={t("managementUi.routineNoVariables", { example: "{{placeholder}}" })}
          action={t("managementUi.routineEditInstructions")}
          onAction={() => navigateToSection("overview")}
        />
      )}
    </div>
  );
}

export function SecretsSection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const { editDraft, setEditDraft, availableSecrets, createSecret } = ctx;

  // Project/company-scoped secrets that already see real usage, surfaced as
  // quick-bind chips (§3.4). Ranked by reference count then recency.
  const recentlyUsedSecrets = useMemo(
    () =>
      [...availableSecrets]
        .filter((secret) => secret.status === "active")
        .sort((a, b) => {
          const refDelta = (b.referenceCount ?? 0) - (a.referenceCount ?? 0);
          if (refDelta !== 0) return refDelta;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        })
        .slice(0, 8),
    [availableSecrets],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <Trans i18nKey="managementUi.routineSecretsHelp" components={[<span className="font-mono" />]} />
      </div>


      <EnvironmentVariablesEditor
        value={(editDraft.env ?? {}) as Record<string, EnvBinding>}
        secrets={availableSecrets}
        recentlyUsedSecrets={recentlyUsedSecrets}
        onCreateSecret={async (name, value) => createSecret.mutateAsync({ name, value })}
        onChange={(env) => setEditDraft((current) => ({ ...current, env: env ?? null }))}
      />
    </div>
  );
}

export function DeliverySection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const { editDraft, setEditDraft, routine } = ctx;

  // The activity gate only affects schedule ticks (webhook/manual/API fires are
  // themselves activity and always run), so the control is only meaningful for
  // routines that have a schedule trigger. Disable — rather than hide — it
  // elsewhere so the capability stays discoverable.
  const hasScheduleTrigger = routine.triggers.some((trigger) => trigger.kind === "schedule");
  const gateEnabled = editDraft.activityGatePolicy === "require_external_activity";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          {t("commonUi.concurrency")}
        </p>
        <RadioCardGroup
          ariaLabel={t("managementUi.routineConcurrencyPolicy")}
          value={editDraft.concurrencyPolicy}
          onValueChange={(concurrencyPolicy) =>
            setEditDraft((current) => ({ ...current, concurrencyPolicy }))
          }
          options={concurrencyPolicyOptions.map(option => ({ ...option, title: t(option.title), description: t(option.description) }))}
        />
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          {t("routineHistoryUi.catchUp")}
        </p>
        <RadioCardGroup
          ariaLabel={t("managementUi.routineCatchUpPolicy")}
          value={editDraft.catchUpPolicy}
          onValueChange={(catchUpPolicy) =>
            setEditDraft((current) => ({ ...current, catchUpPolicy }))
          }
          options={catchUpPolicyOptions.map(option => ({ ...option, title: t(option.title), description: t(option.description) }))}
        />
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          {t("managementUi.routineAdvancedPolicy")}
        </p>
        <RadioCardGroup
          ariaLabel={t("managementUi.routineAdvancedPolicy")}
          value={editDraft.activityGatePolicy}
          onValueChange={(activityGatePolicy) =>
            setEditDraft((current) => ({ ...current, activityGatePolicy }))
          }
          options={activityGatePolicyOptions.map(option => ({ ...option, title: t(option.title), description: t(option.description) }))}
          disabled={!hasScheduleTrigger}
        />
        {!hasScheduleTrigger ? (
          <p className="text-xs text-muted-foreground">
            {t("managementUi.routineGateHelp")}
          </p>
        ) : gateEnabled ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label className="text-xs font-medium">{t("managementUi.routineActivityScope")}</Label>
            <RadioCardGroup
              ariaLabel={t("managementUi.routineGateScope")}
              value={editDraft.activityGateScope}
              onValueChange={(activityGateScope) =>
                setEditDraft((current) => ({ ...current, activityGateScope }))
              }
              options={activityGateScopeOptions.map(option => ({ ...option, title: t(option.title), description: t(option.description) }))}
            />
          </div>
        ) : null}
      </div>
      <NextFiresPreview
        triggers={routine.triggers}
        concurrencyPolicy={editDraft.concurrencyPolicy}
      />
    </div>
  );
}

const dispositionLabelKeys: Record<string, string> = {
  queued: "managementUi.routineQueued",
  coalesced: "managementUi.routineCoalesced",
  skipped: "managementUi.routineSkipped",
};
const dispositionNoteKeys: Record<string, string> = {
  "runs immediately": "managementUi.routineImmediately",
  "if the previous run is still active": "managementUi.routinePreviousActive",
};

const dispositionToneClass: Record<string, string> = {
  queued: "text-emerald-600 dark:text-emerald-400",
  coalesced: "text-amber-600 dark:text-amber-400",
  skipped: "text-muted-foreground",
};

/**
 * "Next 5 fires" preview (§3.5) — the strongest "what does this policy mean?"
 * surface. Picks the soonest-firing schedule trigger, computes its next fires
 * client-side, and annotates each with how the chosen concurrency policy would
 * treat it.
 */
function NextFiresPreview({
  triggers,
  concurrencyPolicy,
}: {
  triggers: RoutineDetailType["triggers"];
  concurrencyPolicy: string;
}) {
  const { t } = useTranslation();
  const preview = useMemo(() => {
    const schedule = triggers
      .filter((trigger) => trigger.kind === "schedule" && trigger.enabled && trigger.cronExpression)
      .map((trigger) => {
        const fires = nextCronFires(trigger.cronExpression, 5, {
          timeZone: trigger.timezone ?? "UTC",
        });
        return { trigger, fires };
      })
      .filter((entry) => entry.fires.length > 0)
      .sort((a, b) => a.fires[0]!.getTime() - b.fires[0]!.getTime())[0];
    if (!schedule) return null;
    return {
      timeZone: schedule.trigger.timezone ?? "UTC",
      entries: previewFirePolicies(schedule.fires, concurrencyPolicy),
    };
  }, [triggers, concurrencyPolicy]);

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
        {t("managementUi.routineNextFive")}
      </p>
      {preview ? (
        <>
          <div className="space-y-1.5 rounded-lg border border-border p-3 font-mono text-xs">
            {preview.entries.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-muted-foreground/40">·</span>
                <span className="tabular-nums">{formatFireTime(entry.at, preview.timeZone)}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span className={cn("font-medium", dispositionToneClass[entry.disposition])}>
                  {dispositionLabelKeys[entry.disposition] ? t(dispositionLabelKeys[entry.disposition]) : entry.label}
                </span>
                {entry.note ? (
                  <span className="truncate text-muted-foreground/60">({dispositionNoteKeys[entry.note] ? t(dispositionNoteKeys[entry.note]) : entry.note})</span>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-(length:--text-micro) text-muted-foreground/60">
            {t("managementUi.routinePreviewHelp", { zone: preview.timeZone })}
          </p>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t("managementUi.routineNoPreview")}
        </p>
      )}
    </div>
  );
}

function formatFireTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(i18n.language, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(date)
      .replace(",", "");
  } catch {
    return date.toISOString();
  }
}
