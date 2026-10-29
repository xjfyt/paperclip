import { useTranslation, formatDate } from "../i18n";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type { AgentInstructionsFileDetail } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { Button } from "./ui/button";

export function InstructionHistory({
  agentId,
  companyId,
  path,
  currentRevisionId,
  disabled,
  onRestored,
}: {
  agentId: string;
  companyId?: string;
  path: string;
  currentRevisionId: string;
  disabled: boolean;
  onRestored: (file: AgentInstructionsFileDetail) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const resource = JSON.stringify([companyId, agentId, path]);
  const [selection, setSelection] = useState<{ resource: string; id: string } | null>(null);
  const selected = selection?.resource === resource ? selection.id : null;
  const history = useInfiniteQuery({
    queryKey: ["instruction-history", companyId, agentId, path, currentRevisionId],
    queryFn: ({ pageParam }) =>
      agentsApi.instructionHistory(agentId, path, companyId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open,
  });
  const diff = useQuery({
    queryKey: ["instruction-diff", companyId, agentId, path, selected, currentRevisionId],
    queryFn: () =>
      agentsApi.instructionDiff(
        agentId,
        path,
        selected!,
        currentRevisionId,
        companyId,
      ),
    enabled: open && Boolean(selected),
  });
  const restore = useMutation({
    mutationFn: () =>
      agentsApi.restoreInstructions(
        agentId,
        { path, revisionId: selected!, baseRevisionId: currentRevisionId },
        companyId,
      ),
    onSuccess: (file) => {
      setSelection(null);
      onRestored(file);
    },
  });
  return (
    <div className="space-y-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("instructionHistoryUi.history")}
      </Button>
      {open && (
        <div className="space-y-3">
          {history.isLoading && (
            <p className="text-sm text-muted-foreground">{t("instructionHistoryUi.loading")}</p>
          )}
          {([
            [history, "historyFailed", "retryHistory", () => history.isFetchNextPageError ? history.fetchNextPage() : history.refetch()],
            [diff, "diffFailed", "retryDiff", () => diff.refetch()],
          ] as const).map(([query, message, retry, refetch]) => query.isError ? (
            <div key={message} role="alert" className="space-y-2 text-sm text-destructive">
              <p>{t(`instructionHistoryUi.${message}`)}</p>
              {query.error instanceof Error && <p>{query.error.message}</p>}
              <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void refetch()}>
                {t(`instructionHistoryUi.${query.isFetching ? "retrying" : retry}`)}
              </Button>
            </div>
          ) : null)}
          {restore.isError && (
            <div role="alert" className="text-sm text-destructive">
              <p>{t("instructionHistoryUi.restoreFailed")}</p>
              {restore.error instanceof Error && <p>{restore.error.message}</p>}
            </div>
          )}
          {history.isSuccess && history.data.pages.every(page => page.revisions.length === 0) && (
            <p className="text-sm text-muted-foreground">{t("instructionHistoryUi.empty")}</p>
          )}
          {history.data?.pages
            .flatMap((page) => page.revisions)
            .map((revision) => (
              <div key={revision.id} className="flex items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant={selected === revision.id ? "secondary" : "ghost"}
                  onClick={() => setSelection({ resource, id: revision.id })}
                >
                  <span className="font-mono">{revision.id.slice(0, 8)}</span>
                </Button>
                <span className="text-sm text-muted-foreground">
                  {revision.source} ·{" "}
                  {formatDate(new Date(revision.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                  {revision.id === currentRevisionId ? ` · ${t("instructionHistoryUi.current")}` : ""}
                </span>
              </div>
            ))}
          {history.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {t("instructionHistoryUi.older")}
            </Button>
          )}
          {diff.data && (
            <>
              <p className="text-sm text-muted-foreground">{t("instructionHistoryUi.selected")}</p>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border p-3 font-mono text-sm">
                {diff.data.from.content}
              </pre>
              <p className="text-sm text-muted-foreground">
                {t("instructionHistoryUi.changes")}
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border p-3 font-mono text-sm">
                {diff.data.removed && `${t("instructionHistoryUi.removed")}\n${diff.data.removed}\n`}
                {diff.data.added && `${t("instructionHistoryUi.added")}\n${diff.data.added}`}
                {!diff.data.removed &&
                  !diff.data.added &&
                  t("instructionHistoryUi.unchanged")}
              </pre>
              <Button
                type="button"
                disabled={
                  disabled ||
                  restore.isPending || history.isError || diff.isError || diff.isFetching ||
                  selected === currentRevisionId
                }
                onClick={() => restore.mutate()}
              >
                {t(`instructionHistoryUi.${restore.isPending ? "restoring" : "restore"}`)}
              </Button>
              {disabled && (
                <p className="text-sm text-muted-foreground">
                  {t("instructionHistoryUi.saveFirst")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
