import { useTranslation } from "../i18n";
import { formatNumber } from "../lib/utils";
import { type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sun } from "lucide-react";
import type { Agent, AttentionItem } from "@paperclipai/shared";
import { decisionQueuesApi } from "../api/decisionQueues";
import { useCompany } from "../context/CompanyContext";
import { useDecisionActionBoundary, type DecisionActionReceipt } from "../hooks/useDecisionActionBoundary";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { attentionIdleDays } from "../lib/attention";
import { AttentionQueueRow } from "./AttentionQueueRow";
import { IssueGroupHeader } from "./IssueGroupHeader";
import { Button } from "./ui/button";

/**
 * A collapsible shelf header + body (snoozed / dismissed / aging / decided /
 * expired). Shared by the desk and the per-queue page so both collapse the same
 * way across both decision surfaces.
 */
export function Curtain({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count?: number | string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <IssueGroupHeader
        label={count == null ? label : `${label} (${typeof count === "number" ? formatNumber(count) : count})`}
        collapsible
        collapsed={!open}
        onToggle={onToggle}
        className="text-muted-foreground"
      />
      {open && <div className="space-y-4">{children}</div>}
    </section>
  );
}

/**
 * An aging-shelf row (§4.4): the standard card, prefaced by an idle-duration
 * label and a "Keep on desk" affordance that clears the shelf flag server-side
 * (P1 retention `keep`). Shared by the desk and the per-queue page.
 */
export function AgingItemRow({
  item,
  companyId,
  now,
  agentMap,
  agents,
  currentUserId,
  expanded,
  onToggleExpand,
  onDismiss,
  onSnooze,
}: {
  item: AttentionItem;
  companyId: string;
  now: number;
  agentMap: Map<string, Agent>;
  agents: Agent[] | undefined;
  currentUserId: string | null;
  expanded: boolean;
  onToggleExpand: (item: AttentionItem) => void;
  onDismiss: (item: AttentionItem) => void;
  onSnooze: (item: AttentionItem, snoozedUntil: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const idleDays = attentionIdleDays(item, now);
  const { selectedCompanyId } = useCompany();
  const boundary = useDecisionActionBoundary(companyId, JSON.stringify([item.id, item.sourceKind, item.subject.id]), selectedCompanyId);
  type KeepAction = { companyId: string; sourceKind: AttentionItem["sourceKind"]; sourceId: string; title: string | null };
  const keep = useMutation({
    mutationFn: (receipt: DecisionActionReceipt<KeepAction>) => {
      if (!boundary.isCurrent(receipt)) throw new DOMException("Decision context changed", "AbortError");
      const input = receipt.input;
      return decisionQueuesApi.setKeep(input.companyId, input.sourceKind, input.sourceId, true);
    },
    onSuccess: (_data, receipt) => {
      if (!boundary.isCurrent(receipt)) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.attention(receipt.input.companyId) });
      pushToast({ title: t("decisionDeskUi.keptToast"), body: receipt.input.title ?? undefined, tone: "success" });
    },
    onError: (error, receipt) => {
      if (!boundary.isCurrent(receipt)) return;
      pushToast({
        title: t("decisionDeskUi.keepError"),
        body: error instanceof Error ? error.message : t("decisionDeskUi.tryAgain"),
        tone: "error",
      });
    },
    onSettled: (_data, _error, receipt) => boundary.finish(receipt),
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-(length:--text-nano) text-muted-foreground">
          {t("decisionDeskUi.idle", { count: idleDays, n: formatNumber(idleDays) })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 gap-1"
          disabled={boundary.pending || item.keep}
          onClick={() => {
            if (item.keep) return;
            const receipt = boundary.begin({ companyId, sourceKind: item.sourceKind, sourceId: item.subject.id, title: item.subject.title });
            if (receipt) keep.mutate(receipt);
          }}
        >
          {boundary.pending && <Loader2 className="h-3 w-3 animate-spin" />}
          <Sun className="h-3.5 w-3.5" />
          {t(item.keep ? "decisionDeskUi.kept" : "decisionDeskUi.keep")}
        </Button>
      </div>
      <AttentionQueueRow
        item={item}
        companyId={companyId}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onDismiss={onDismiss}
        onSnooze={onSnooze}
        agentMap={agentMap}
        agents={agents}
        showTriage
        currentUserId={currentUserId}
      />
    </div>
  );
}
