import { useTranslation } from "@/i18n";
import { useMemo, type CSSProperties } from "react";
import { Folder, GitBranch, GitBranchPlus, Monitor } from "lucide-react";
import type { ExecutionWorkspaceSummary } from "@paperclipai/shared";
import { SearchableSelect, type SearchableSelectOption } from "@/components/SearchableSelect";
import { orderReusableExecutionWorkspaces } from "@/lib/reusable-execution-workspaces";

interface WorktreeOption extends SearchableSelectOption {
  mode: string;
  workspaceId?: string;
  description: string;
}

interface ComposerWorktreePickerProps {
  mode: string;
  workspaceId: string;
  workspaces: readonly ExecutionWorkspaceSummary[];
  onChange: (mode: string, workspaceId: string) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  disabled?: boolean;
  mobile?: boolean;
  contentStyle?: CSSProperties;
  selectedWorkspaceLabel?: string;
}

const WORKSPACE_MODES = ["isolated_workspace", "shared_workspace", "operator_branch", "agent_default", "inherit"] as const;

/** Reuses the searchable selector and the existing workspace recency ordering. */
export function ComposerWorktreePicker({
  mode, workspaceId, workspaces, onChange, loading, error, onRetry,
  disabled, mobile, contentStyle, selectedWorkspaceLabel,
}: ComposerWorktreePickerProps) {
  const { t } = useTranslation();
  const modeOptions = useMemo<WorktreeOption[]>(() => WORKSPACE_MODES.map(mode => ({ key: mode, value: mode, mode,
    label: t(`taskThreadComposerUi.modes.${mode}.label`),
    description: t(`taskThreadComposerUi.modes.${mode}.description`),
  })), [t]);
  const groups = useMemo(() => [
    { id: "new", options: [modeOptions[0]!] },
    {
      id: "reuse", label: t("taskThreadComposerUi.reuse"),
      options: orderReusableExecutionWorkspaces(workspaces).map((workspace): WorktreeOption => ({
        key: `reuse:${workspace.id}`, value: `reuse:${workspace.id}`,
        workspaceId: workspace.id, mode: "reuse_existing", label: workspace.name,
        description: workspace.branchName ?? t("taskThreadComposerUi.existingWorkspace"),
        searchText: `${workspace.branchName ?? ""} ${workspace.id}`,
      })),
    },
    {
      id: "other", label: t("taskThreadComposerUi.otherOptions"),
      options: modeOptions.filter((option) => option.mode === "shared_workspace"
        || (option.mode !== "isolated_workspace" && option.mode === mode)),
    },
  ], [mode, workspaces, modeOptions, t]);

  const value = mode === "reuse_existing" ? `reuse:${workspaceId}` : mode;
  return (
    <SearchableSelect<string, WorktreeOption>
      value={value}
      groups={groups}
      onValueChange={(_, option) => onChange(option.mode, option.workspaceId ?? "")}
      placeholder={t("taskThreadComposerUi.worktrees")}
      triggerAriaLabel={t("taskThreadComposerUi.worktrees")}
      mobileTitle={t("taskThreadComposerUi.worktrees")}
      searchPlaceholder={t("taskThreadComposerUi.searchWorktrees")}
      emptyMessage={t("taskThreadComposerUi.noMatchingWorktrees")}
      disabled={disabled}
      modal={mobile}
      contentStyle={contentStyle}
      contentWidth="auto"
      className="min-w-0 flex-1 sm:flex-none sm:max-w-72"
      triggerClassName="h-8 gap-1.5 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-0"
      renderValue={(option) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            <span className="hidden text-muted-foreground sm:inline">{t("taskThreadComposerUi.worktrees")} · </span>
            {option?.label ?? selectedWorkspaceLabel ?? t("taskThreadComposerUi.selectWorktree")}
          </span>
        </span>
      )}
      renderOption={(option) => {
        const Icon = option.workspaceId ? GitBranch : option.mode === "isolated_workspace" ? GitBranchPlus
          : option.mode === "agent_default" ? Monitor : option.mode === "operator_branch" ? GitBranch : Folder;
        return (
          <>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{option.label}</span>
              <span className="truncate text-xs text-muted-foreground">{option.description}</span>
            </span>
          </>
        );
      }}
      listFooter={loading || error || workspaces.length === 0 ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status">
          {loading ? t("taskThreadComposerUi.loadingWorktrees") : error ? (
            <span className="flex items-center justify-between gap-2">
              {t("taskThreadComposerUi.loadFailed")}
              <button type="button" className="rounded px-2 py-1 text-foreground hover:bg-accent" onClick={onRetry}>{t("common.retry")}</button>
            </span>
          ) : t("taskThreadComposerUi.noWorktrees")}
        </div>
      ) : undefined}
    />
  );
}
