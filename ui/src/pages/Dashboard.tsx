import { useCompanyAgentCreationAccess } from "@/hooks/useCompanyAgentCreationAccess";
import { useTranslation } from "@/i18n";
import { AgentIdentity } from "../components/AgentIdentity";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";

import { ActivityRow } from "../components/ActivityRow";
import { timeAgo } from "../lib/timeAgo";
import { cn, formatCents } from "../lib/utils";
import { SHOW_TASK_PRIORITY_UI } from "../lib/ui-flags";
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle } from "lucide-react";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InlineBanner } from "../components/InlineBanner";
import type { Agent, Issue } from "@paperclipai/shared";
import { PluginSlotOutlet } from "@/plugins/slots";
import { SmokeLabDashboardCard } from "../components/SmokeLabDashboardCard";

const DASHBOARD_ACTIVITY_LIMIT = 10;

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export type PausedAgentBanner =
  | { kind: "imported"; pausedImportedAgentIds: string[] }
  | { kind: "all-paused" }
  | null;

/**
 * Which paused-agents banner the dashboard should show. Import-paused agents
 * get the specific banner with a bulk resume (they were parked by the import
 * safety default and stay parked until someone acts); otherwise a company
 * whose agents are ALL paused gets a generic explanation, because from the
 * outside it is indistinguishable from a broken company.
 */
export function derivePausedAgentBanner(agents: Agent[] | undefined): PausedAgentBanner {
  if (!agents || agents.length === 0) return null;
  const importedPaused = agents.filter(
    (agent) => agent.status === "paused" && agent.pauseReason === "import",
  );
  if (importedPaused.length > 0) {
    return { kind: "imported", pausedImportedAgentIds: importedPaused.map((agent) => agent.id) };
  }
  if (agents.every((agent) => agent.status === "paused")) return { kind: "all-paused" };
  return null;
}

export function Dashboard() {
  const { t } = useTranslation();
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [animatedActivityIds, setAnimatedActivityIds] = useState<Set<string>>(new Set());
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const hydratedActivityRef = useRef(false);
  const activityAnimationTimersRef = useRef<number[]>([]);

  // A cached empty list may predate the first hire; wait for its refresh
  // before offering the optional setup banner.
  const agentCreation = useCompanyAgentCreationAccess(selectedCompanyId);

  const { data: agents, isFetching: agentsRefreshing } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Bulk resume for agents parked by a company import. Sequential on purpose
  // (mirrors the import page's activation checklist); a per-agent failure is
  // tolerated so one bad agent never blocks the rest, and the refetch below
  // re-renders the banner with whatever remains paused.
  const queryClient = useQueryClient();
  const resumeImportedAgents = useMutation({
    mutationFn: async () => {
      const targets = derivePausedAgentBanner(agents);
      if (!targets || targets.kind !== "imported") return;
      for (const agentId of targets.pausedImportedAgentIds) {
        try {
          await agentsApi.resume(agentId, selectedCompanyId ?? undefined);
        } catch {
          // Leave the agent paused; the banner re-renders with the remainder.
        }
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) }),
      ]);
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: t("navigation.dashboard") }]);
  }, [setBreadcrumbs, t]);

  const dashboardQueryKey = queryKeys.dashboard(selectedCompanyId!);
  const sharedDashboard = useSharedPollingQuery({
    companyId: selectedCompanyId,
    resourceKey: "dashboard",
    queryKey: dashboardQueryKey,
    enabled: !!selectedCompanyId,
  });
  const { data, isLoading, error, dataUpdatedAt: dashboardUpdatedAt } = useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  usePublishSharedQueryData(sharedDashboard, data, dashboardUpdatedAt);

  const activityQueryKey = [...queryKeys.activity(selectedCompanyId!), { limit: DASHBOARD_ACTIVITY_LIMIT }] as const;
  const sharedActivity = useSharedPollingQuery({
    companyId: selectedCompanyId,
    resourceKey: `activity:limit:${DASHBOARD_ACTIVITY_LIMIT}`,
    queryKey: activityQueryKey,
    enabled: !!selectedCompanyId,
  });
  const { data: activity, dataUpdatedAt: activityUpdatedAt } = useQuery({
    queryKey: activityQueryKey,
    queryFn: () => activityApi.list(selectedCompanyId!, { limit: DASHBOARD_ACTIVITY_LIMIT }),
    enabled: !!selectedCompanyId,
  });
  usePublishSharedQueryData(sharedActivity, activity, activityUpdatedAt);

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!, { includeArchived: true }),
    queryFn: () => projectsApi.list(selectedCompanyId!, { includeArchived: true }),
    enabled: !!selectedCompanyId,
  });

  const { data: companyMembers } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const userProfileMap = useMemo(
    () => buildCompanyUserProfileMap(companyMembers?.users),
    [companyMembers?.users],
  );

  const recentIssues = issues ? getRecentIssues(issues) : [];
  const recentActivity = useMemo(() => (activity ?? []).slice(0, 10), [activity]);

  useEffect(() => {
    for (const timer of activityAnimationTimersRef.current) {
      window.clearTimeout(timer);
    }
    activityAnimationTimersRef.current = [];
    seenActivityIdsRef.current = new Set();
    hydratedActivityRef.current = false;
    setAnimatedActivityIds(new Set());
  }, [selectedCompanyId]);

  useEffect(() => {
    if (recentActivity.length === 0) return;

    const seen = seenActivityIdsRef.current;
    const currentIds = recentActivity.map((event) => event.id);

    if (!hydratedActivityRef.current) {
      for (const id of currentIds) seen.add(id);
      hydratedActivityRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seen.has(id));
    if (newIds.length === 0) {
      for (const id of currentIds) seen.add(id);
      return;
    }

    setAnimatedActivityIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) seen.add(id);

    const timer = window.setTimeout(() => {
      setAnimatedActivityIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      activityAnimationTimersRef.current = activityAnimationTimersRef.current.filter((t) => t !== timer);
    }, 980);
    activityAnimationTimersRef.current.push(timer);
  }, [recentActivity]);

  useEffect(() => {
    return () => {
      for (const timer of activityAnimationTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message={t("liveUi.welcomeDashboard")}
          action={t("onboarding.getStarted")}
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message={t("liveUi.chooseCompany")} />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  // Configuration is an explicit action, never a prerequisite for this page.
  const hasNoAgents = agents !== undefined && !agentsRefreshing && agents.length === 0;
  const pausedBanner = derivePausedAgentBanner(agents);
  const pausedImportedCount =
    pausedBanner?.kind === "imported" ? pausedBanner.pausedImportedAgentIds.length : 0;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {pausedBanner?.kind === "imported" ? (
        <InlineBanner
          tone="warning"
          icon={PauseCircle}
          title={t("liveUi.importedPaused", { count: pausedImportedCount })}
          actions={
            <Button
              size="sm"
              onClick={() => resumeImportedAgents.mutate()}
              disabled={resumeImportedAgents.isPending}
              data-testid="dashboard-resume-imported-agents"
            >
              {resumeImportedAgents.isPending ? t("liveUi.resuming") : t("liveUi.resumeAll")}
            </Button>
          }
        >
          {t("liveUi.importedHelp")}
        </InlineBanner>
      ) : pausedBanner?.kind === "all-paused" ? (
        <InlineBanner
          tone="warning"
          icon={PauseCircle}
          title={t("liveUi.allAgentsPaused")}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/agents">{t("liveUi.reviewAgents")}</Link>
            </Button>
          }
        >
          {t("liveUi.resumeAgentHelp")}
        </InlineBanner>
      ) : null}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              {t("optionalOnboarding.noAgents")}
            </p>
          </div>
          {agentCreation.allowed ? <button
            onClick={() => openOnboarding({ initialStep: 3, companyId: selectedCompanyId! })}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2 shrink-0"
          >
            {t("optionalOnboarding.configureAgent")}
          </button> : <p className="text-sm text-muted-foreground">{t(agentCreation.failed ? "authGate.setupAccessFailed" : agentCreation.pending ? "common.loading" : "authGate.askAdmin")}</p>}
        </div>
      )}

      <ActiveAgentsPanel companyId={selectedCompanyId!} dedupeLinkedTasks />

      {data && (
        <>
          {data.budgets.activeIncidents > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-(image:--gradient-extract-1) px-4 py-3">
              <div className="flex items-start gap-2.5">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-300" />
                <div>
                  <p className="text-sm font-medium text-red-950 dark:text-red-50">
                    {t("liveUi.budgetIncidents", { count: data.budgets.activeIncidents })}
                  </p>
                  <p className="text-xs text-red-900/70 dark:text-red-100/70">
                    {t("liveUi.budgetCounts", { agents: data.budgets.pausedAgents, projects: data.budgets.pausedProjects, approvals: data.budgets.pendingApprovals })}
                  </p>
                </div>
              </div>
              <Link to="/costs" className="text-sm underline underline-offset-2 text-red-900 dark:text-red-100">
                {t("liveUi.openBudgets")}
              </Link>
            </div>
          ) : null}

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
            <MetricCard
              icon={Bot}
              value={data.agents.active + data.agents.running + data.agents.paused + data.agents.error}
              label={t("liveUi.agentsEnabled")}
              to="/agents"
              description={
                <span>
                  {t("liveUi.agentCounts", { running: data.agents.running, paused: data.agents.paused, errors: data.agents.error })}
                </span>
              }
            />
            <MetricCard
              icon={CircleDot}
              value={data.tasks.inProgress}
              label={t("liveUi.tasksInProgress")}
              to="/issues"
              description={
                <span>
                  {t("liveUi.taskCounts", { open: data.tasks.open, blocked: data.tasks.blocked })}
                </span>
              }
            />
            <MetricCard
              icon={DollarSign}
              value={formatCents(data.costs.monthSpendCents)}
              label={t("liveUi.monthSpend")}
              to="/costs"
              description={
                <span>
                  {data.costs.monthBudgetCents > 0
                    ? t("liveUi.budgetUsage", { percent: data.costs.monthUtilizationPercent, amount: formatCents(data.costs.monthBudgetCents) })
                    : t("liveUi.unlimitedBudget")}
                </span>
              }
            />
            <MetricCard
              icon={ShieldCheck}
              value={data.pendingApprovals + data.budgets.pendingApprovals}
              label={t("liveUi.pendingApprovals")}
              to="/approvals"
              description={
                <span>
                  {data.budgets.pendingApprovals > 0
                    ? t("liveUi.budgetApprovals", { count: data.budgets.pendingApprovals })
                    : t("liveUi.awaitingReview")}
                </span>
              }
            />
          </div>

          <SmokeLabDashboardCard companyId={selectedCompanyId!} />

          <div className={cn("grid grid-cols-2 gap-4", SHOW_TASK_PRIORITY_UI ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
            <ChartCard title={t("liveUi.runActivity")} subtitle={t("liveUi.last14Days")}>
              <RunActivityChart activity={data.runActivity} />
            </ChartCard>
            {/* PAP-411: "Tasks by Priority" chart hidden behind SHOW_TASK_PRIORITY_UI. */}
            {SHOW_TASK_PRIORITY_UI && (
              <ChartCard title={t("liveUi.tasksByPriority")} subtitle={t("liveUi.last14Days")}>
                <PriorityChart issues={issues ?? []} />
              </ChartCard>
            )}
            <ChartCard title={t("liveUi.tasksByStatus")} subtitle={t("liveUi.last14Days")}>
              <IssueStatusChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title={t("liveUi.successRate")} subtitle={t("liveUi.last14Days")}>
              <SuccessRateChart activity={data.runActivity} />
            </ChartCard>
          </div>

          <PluginSlotOutlet
            slotTypes={["dashboardWidget"]}
            context={{ companyId: selectedCompanyId }}
            className="grid gap-4 md:grid-cols-2"
            // design-allow(card-pattern): class-string prop consumed by the plugin outlet; a component can't be passed here (C5a Run 3)
            itemClassName="rounded-lg border bg-card p-4 shadow-sm"
          />

          <div className="grid md:grid-cols-2 gap-4">
            {/* Recent Activity */}
            {recentActivity.length > 0 && (
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  {t("liveUi.recentActivity")}
                </h3>
                <Card className="@container block py-0 divide-y divide-border overflow-hidden">
                  {recentActivity.map((event) => (
                    <ActivityRow
                      key={event.id}
                      event={event}
                      agentMap={agentMap}
                      userProfileMap={userProfileMap}
                      entityNameMap={entityNameMap}
                      entityTitleMap={entityTitleMap}
                      className={animatedActivityIds.has(event.id) ? "activity-row-enter" : undefined}
                    />
                  ))}
                </Card>
              </div>
            )}

            {/* Recent Tasks */}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {t("workflow.recentTasks")}
              </h3>
              {recentIssues.length === 0 ? (
                <Card className="block p-4">
                  <p className="text-sm text-muted-foreground">{t("liveUi.noTasksYet")}</p>
                </Card>
              ) : (
                <Card className="@container block py-0 divide-y divide-border overflow-hidden">
                  {recentIssues.slice(0, 10).map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.identifier ?? issue.id}`}
                      className="dashboard-list-row text-sm cursor-pointer hover:bg-accent/50 transition-colors no-underline text-inherit block"
                    >
                      <div className="flex items-start gap-2 @xl:grid @xl:grid-cols-(--dashboard-task-list-columns) @xl:items-baseline">
                        <span className="flex size-6 shrink-0 items-center justify-end @xl:self-center">
                          <StatusIcon status={issue.status} externalConversationState={issue.externalConversationState} blockerAttention={issue.blockerAttention} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1 @xl:contents">
                          <span className="flex min-w-0 items-baseline gap-2 @xl:contents">
                            <span className="min-w-0 flex-1 truncate text-sm leading-6" title={issue.title}>
                              {issue.title}
                            </span>
                            <span className="ml-auto shrink-0 truncate text-right font-mono text-(length:--text-micro) text-muted-foreground @xl:col-start-4 @xl:row-start-1 @xl:w-(--dashboard-list-id-width)">
                              {issue.identifier ?? issue.id.slice(0, 8)}
                            </span>
                          </span>
                          <span className="flex min-h-6 min-w-0 items-center gap-2 @xl:contents">
                            <span className="flex min-w-0 flex-1 items-center @xl:col-start-3 @xl:row-start-1 @xl:self-center">
                              {issue.assigneeAgentId && (() => {
                                const name = agentName(issue.assigneeAgentId);
                                return name
                                  ? <AgentIdentity agent={agents?.find(agent => agent.id === issue.assigneeAgentId) ?? { id: issue.assigneeAgentId ?? undefined, name }} size="sm" className="max-w-32" />
                                  : null;
                              })()}
                            </span>
                            <span className="ml-auto w-(--dashboard-list-time-width) shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
                              {timeAgo(issue.updatedAt)}
                            </span>
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </Card>
              )}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
