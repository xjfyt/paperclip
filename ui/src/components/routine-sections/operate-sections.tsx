import { useTranslation, i18n } from "@/i18n";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { routineDetailHref } from "../RoutineContextualSidebar";
import { createIssueDetailLocationState } from "@/lib/issueDetailBreadcrumb";
import { useToastActions } from "@/context/ToastContext";
import { IssuesList } from "../IssuesList";
import { EmptyState } from "../EmptyState";
import { RoutineHistoryTab } from "../RoutineHistoryTab";
import { RoutineActivityRow } from "../RoutineActivityRow";
import { useRoutineDetail } from "./context";

export function RunsSection() {
  const { t } = useTranslation();
  const { routine, companyId, agents, projects, hasLiveRun, activeIssueId } = useRoutineDetail();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const filters = { originKind: "routine_execution", originId: routine.id };
  const issueQueryKey = [...queryKeys.issues.list(companyId), "routine", routine.id];
  const { data: issues, isLoading, error } = useQuery({
    queryKey: issueQueryKey,
    queryFn: () => issuesApi.list(companyId, filters),
  });
  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => issuesApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routine.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routines.runs(routine.id) });
    },
    onError: (updateError) => pushToast({ title: t("routineDetailUi.taskUpdateFailed"), body: updateError.message, tone: "error" }),
  });

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error}
      agents={agents}
      projects={projects}
      liveIssueIds={new Set(hasLiveRun && activeIssueId ? [activeIssueId] : [])}
      viewStateKey={`paperclip:routine-runs:${companyId}:${routine.id}`}
      searchFilters={filters}
      issueLinkState={createIssueDetailLocationState(t("browserQa.runs"), routineDetailHref(routine.id, "runs"))}
      rowPresentation="task"
      toolbarPresentation="collection"
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
    />
  );
}

export function ActivitySection({ isLoading = false, error }: { isLoading?: boolean; error?: Error | null } = {}) {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const { activity } = ctx;
  const events = activity ?? [];

  const groups = useMemo(() => {
    const byDay = new Map<string, { date: Date | null; events: typeof events }>();
    for (const event of events) {
      const date = new Date(event.createdAt);
      const validDate = Number.isFinite(date.getTime()) ? date : null;
      // Locale-independent identity preserves expanded activity rows on language changes.
      const day = validDate ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : "earlier";
      const bucket = byDay.get(day) ?? { date: validDate, events: [] };
      bucket.events.push(event);
      byDay.set(day, bucket);
    }
    return Array.from(byDay.entries());
  }, [events]);

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("routineDetailUi.loadingActivity")}</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">{error.message}</p>;

  if (events.length === 0) {
    return <EmptyState icon={ActivityIcon} message={t("routineDetailUi.noActivity")} />;
  }

  return (
    <div className="space-y-4">
      {groups.map(([day, group]) => (
        <div key={day}>
          <div className="sticky top-0 bg-background py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.date ? group.date.toLocaleDateString(i18n.language, {
              weekday: "short", month: "short", day: "numeric",
            }) : t("routineDetailUi.earlier")}
          </div>
          <div>
            {group.events.map((event) => (
              <RoutineActivityRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistorySection() {
  const ctx = useRoutineDetail();
  const {
    routine,
    isEditDirty,
    dirtyFields,
    routineDefaults,
    setEditDraft,
    saveRoutine,
    agentById,
    projectById,
    availableSecrets,
    onHistoryRestoreSecretMaterials,
    onHistoryRestored,
  } = ctx;

  return (
    <RoutineHistoryTab
      routine={routine}
      isEditDirty={isEditDirty}
      dirtyFields={dirtyFields}
      onDiscardEdits={() => setEditDraft(routineDefaults)}
      onSaveEdits={() => {
        if (!saveRoutine.isPending && routine.title.trim()) {
          saveRoutine.mutate();
        }
      }}
      agents={agentById}
      projects={projectById}
      secrets={availableSecrets}
      onRestoreSecretMaterials={onHistoryRestoreSecretMaterials}
      onRestored={onHistoryRestored}
    />
  );
}
