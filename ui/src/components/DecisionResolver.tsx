import { useTranslation } from "../i18n";
import { useCallback, useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { decisionEffectTargetIssueIds, type Agent, type AttentionSubject } from "@paperclipai/shared";
import { decisionsApi, type DecisionOutcome } from "../api/decisions";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { useDecisionActionBoundary, type DecisionActionReceipt } from "../hooks/useDecisionActionBoundary";
import { DecisionCard, type DecisionIssueRef } from "./DecisionCard";

interface DecisionResolverProps {
  companyId: string;
  decisionId: string;
  /** Origin issue subject from the attention row (already carries identifier/href). */
  originIssue?: AttentionSubject | null;
  agentMap?: Map<string, Agent>;
  /** Complete terminal list item used to avoid one detail request per history row. */
  initialDecision?: DecisionOutcome;
  /** Called after a decide/dismiss so the parent can refresh the feed row. */
  onResolved?: () => void;
}

type IssueDetail = Awaited<ReturnType<typeof issuesApi.get>>;

// A module-level combine function lets TanStack Query structurally share this
// projection until issue data actually changes. Depending on useQueries' raw
// result array would invalidate resolveIssue on every render.
function combineIssueData(results: Array<{ data?: IssueDetail }>) {
  return results.map((result) => result.data);
}

export function signedCancelTreePreviewIds(targetIssueId: string, snapshot: { descendantIds?: string[] } | undefined) {
  return snapshot?.descendantIds ? [targetIssueId, ...snapshot.descendantIds] : null;
}

/**
 * Container for a Decisions-v1 decision surfaced in the attention feed. Fetches
 * the full decision (`get`) plus the shared open-list (for `targetChanged`),
 * resolves referenced issue ids + the cancel-tree preview, owns the decide /
 * dismiss mutations, and invalidates the attention feed + target-issue keys on
 * success — same conventions as {@link AttentionInteractionResolver}.
 */
export function DecisionResolver({ companyId, decisionId, originIssue, agentMap, initialDecision, onResolved }: DecisionResolverProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const boundary = useDecisionActionBoundary(companyId, decisionId, selectedCompanyId === undefined ? companyId : selectedCompanyId);
  const prefix = selectedCompany?.issuePrefix ?? "";
  const issueHref = useCallback(
    (idOrIdentifier: string) => (prefix ? `/${prefix}/issues/${idOrIdentifier}` : `/issues/${idOrIdentifier}`),
    [prefix],
  );

  const detail = useQuery({
    queryKey: queryKeys.decisions.detail(decisionId),
    queryFn: () => decisionsApi.get(decisionId),
    enabled: !!decisionId,
    initialData: initialDecision,
    staleTime: 30_000,
  });
  const decision = detail.data;

  // Shared across every open decision row → a single fetch carries `targetChanged`.
  const openList = useQuery({
    queryKey: queryKeys.decisions.list(companyId, "open"),
    queryFn: () => decisionsApi.list(companyId, { status: "open" }),
    enabled: !!companyId && decision?.status === "open",
  });
  const targetChanged = useMemo(
    () => openList.data?.find((entry) => entry.id === decisionId)?.targetChanged ?? null,
    [openList.data, decisionId],
  );

  // Issue ids referenced by snapshots / effects / results, resolved to labels.
  const referencedIds = useMemo(() => {
    if (!decision) return [] as string[];
    const ids = new Set<string>(Object.keys(decision.targetSnapshots ?? {}));
    for (const snapshot of Object.values(decision.targetSnapshots ?? {})) {
      for (const descendantId of snapshot.descendantIds ?? []) ids.add(descendantId);
    }
    for (const option of decision.options) {
      for (const effect of option.effects) {
        for (const id of decisionEffectTargetIssueIds(effect)) ids.add(id);
      }
    }
    for (const execution of decision.executions ?? []) {
      ids.add(execution.targetIssueId);
      const created = (execution.result ?? {}).issueId;
      if (typeof created === "string") ids.add(created);
    }
    if (originIssue?.id) ids.delete(originIssue.id);
    return [...ids];
  }, [decision, originIssue?.id]);

  const issueData = useQueries({
    queries: referencedIds.map((id) => ({
      queryKey: queryKeys.issues.detail(id),
      queryFn: () => issuesApi.get(id),
      staleTime: 30_000,
    })),
    combine: combineIssueData,
  });

  const resolveIssue = useMemo(() => {
    const map = new Map<string, DecisionIssueRef>();
    if (originIssue?.id) {
      map.set(originIssue.id, {
        id: originIssue.id,
        identifier: originIssue.identifier,
        title: originIssue.title,
        href: originIssue.href ?? issueHref(originIssue.identifier ?? originIssue.id),
        status: originIssue.status,
      });
    }
    issueData.forEach((issue, index) => {
      const id = referencedIds[index];
      if (issue && id) {
        map.set(id, {
          id,
          identifier: issue.identifier ?? null,
          title: issue.title ?? null,
          href: issueHref(issue.identifier ?? id),
          status: issue.status ?? null,
        });
      }
    });
    return (id: string) => map.get(id) ?? null;
  }, [originIssue, referencedIds, issueData, issueHref]);

  const cancelTreePreview = useCallback((targetIssueId: string): DecisionIssueRef[] | null => {
    const snapshot = decision?.targetSnapshots?.[targetIssueId];
    const signedIds = signedCancelTreePreviewIds(targetIssueId, snapshot);
    if (!signedIds) return null;
    const refs = signedIds.map(resolveIssue);
    return refs.every((ref): ref is DecisionIssueRef => ref !== null) ? refs : null;
  }, [decision?.targetSnapshots, resolveIssue]);

  type Action = { companyId: string; decisionId: string; targetIds: string[] } & (
    { kind: "decide"; optionId: string; inputValues: Record<string, string>; idempotencyKey: string }
    | { kind: "dismiss"; reason?: string }
  );
  const mutationOptions = {
    mutationFn: (receipt: DecisionActionReceipt<Action>) => {
      // Do not replay an old intent with the next viewer's ambient credentials.
      if (!boundary.isCurrent(receipt)) throw new DOMException("Decision context changed", "AbortError");
      const { input } = receipt;
      return input.kind === "decide"
        ? decisionsApi.decide(input.decisionId, { optionId: input.optionId, inputValues: input.inputValues, idempotencyKey: input.idempotencyKey })
        : decisionsApi.dismiss(input.decisionId, input.reason);
    },
    onSuccess: (data: DecisionOutcome, receipt: DecisionActionReceipt<Action>) => {
      if (!boundary.isCurrent(receipt)) return;
      const { companyId: company, decisionId: id, targetIds } = receipt.input;
      queryClient.setQueryData(queryKeys.decisions.detail(id), data);
      queryClient.invalidateQueries({ queryKey: queryKeys.decisions.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.decisions.list(company, "open") });
      queryClient.invalidateQueries({ queryKey: queryKeys.decisions.list(company, "decided") });
      queryClient.invalidateQueries({ queryKey: queryKeys.attention(company) });
      for (const targetId of targetIds) {
        queryClient.invalidateQueries({ queryKey: queryKeys.decisions.forTargetIssue(company, targetId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(targetId) });
      }
      onResolved?.();
    },
    onSettled: (_data: DecisionOutcome | undefined, _error: Error | null, receipt: DecisionActionReceipt<Action>) => boundary.finish(receipt),
  };
  // Retries reuse this receipt's idempotency key, never a new intent.
  const decideMutation = useMutation({ ...mutationOptions, retry: (count, error) => error.name !== "AbortError" && count < 2 });
  const dismissMutation = useMutation(mutationOptions);
  const submit = (action: { kind: "decide"; optionId: string; inputValues: Record<string, string> } | { kind: "dismiss"; reason?: string }) => {
    if (!decision || decision.status !== "open" || decision.companyId !== companyId) return;
    const receipt = boundary.begin<Action>({
      ...action, companyId, decisionId, targetIds: Object.keys(decision.targetSnapshots ?? {}),
      ...(action.kind === "decide" ? { inputValues: { ...action.inputValues }, idempotencyKey: crypto.randomUUID() } : {}),
    } as Action);
    if (receipt) (action.kind === "decide" ? decideMutation : dismissMutation).mutate(receipt);
  };

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("decisionCardUi.loading")}
      </div>
    );
  }

  if (detail.error || !decision || decision.companyId !== companyId) {
    return (
      <p className="py-3 text-xs text-muted-foreground">
        {t("decisionCardUi.unavailable")}
      </p>
    );
  }

  const busy = boundary.pending;
  const errorMessage = [decideMutation, dismissMutation].find((mutation) => boundary.isCurrent(mutation.variables) && mutation.error instanceof Error)?.error?.message ?? null;

  return (
    <DecisionCard
      key={`${companyId}:${decisionId}`}
      decision={decision}
      executions={decision.executions}
      targetChanged={targetChanged}
      resolveIssue={resolveIssue}
      cancelTreePreview={cancelTreePreview}
      originAgentName={agentMap?.get(decision.originAgentId)?.name ?? null}
      originIssue={
        originIssue
          ? {
              id: originIssue.id,
              identifier: originIssue.identifier,
              title: originIssue.title,
              href: originIssue.href ?? issueHref(originIssue.identifier ?? originIssue.id),
              status: originIssue.status,
            }
          : null
      }
      busy={busy}
      errorMessage={errorMessage}
      onDecide={(optionId, inputValues) => submit({ kind: "decide", optionId, inputValues })}
      onDismiss={(reason) => submit({ kind: "dismiss", reason })}
    />
  );
}
