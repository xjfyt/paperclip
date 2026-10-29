import { useTranslation } from "@/i18n";
import { useOptionalCompany } from "@/context/CompanyContext";
import { useCommittedResourceScope } from "@/hooks/useCommittedResourceScope";
import { isCsvFile } from "@/lib/csv-preview";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download } from "lucide-react";
import { fileResourcesApi } from "@/api/file-resources";
import { FileViewerBody, FileViewerMetadataRow } from "@/components/FileViewerSheet";
import { Button } from "@/components/ui/button";
import { FilePreviewModeToggle, type FilePreviewMode } from "@/components/FilePreviewModeToggle";
import { isHtmlPreview } from "@/lib/html-preview";
import type { FileViewerUrlState } from "@/context/FileViewerContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import { queryKeys } from "@/lib/queryKeys";
import type { TaskSidePanelTabPayload } from "@/lib/task-side-panel-state";

type WorkspaceFilePayload = Extract<TaskSidePanelTabPayload, { kind: "workspace-file" }>;

export function TaskWorkspaceFilePanel({
  issueId,
  payload,
  onFallbackToProject,
}: {
  issueId: string;
  payload: WorkspaceFilePayload;
  onFallbackToProject?: () => void;
}) {
  const { t } = useTranslation();
  const company = useOptionalCompany();
  const [previewMode, setPreviewMode] = useState<"raw" | "rendered">("rendered");

  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const attempt = useRef(0);
  const state: FileViewerUrlState = {
    path: payload.path,
    workspace: payload.workspace,
    projectId: payload.projectId,
    workspaceId: payload.workspaceId,
    line: payload.line,
    column: payload.column,
  };
  const resourceQuery = useQuery({
    queryKey: queryKeys.issues.fileResource(issueId, state),
    queryFn: () => fileResourcesApi.resolve(issueId, state),
    retry: false,
  });
  const resource = resourceQuery.data;
  const contentQuery = useQuery({
    queryKey: queryKeys.issues.fileResourceContent(issueId, state),
    queryFn: () => fileResourcesApi.content(issueId, state),
    enabled: resource?.capabilities.preview === true,
    retry: false,
  });
  const scope = JSON.stringify([company?.selectedCompanyId, issueId, payload.path, payload.workspace, payload.workspaceId, payload.projectId, resource?.workspaceId, resource?.provider]);
  const isCurrent = useCommittedResourceScope(scope, contentQuery.data?.content.data);
  useLayoutEffect(() => {
    attempt.current += 1;
    setCopied(false); setCopyFailed(false); setAnnouncement("");
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [scope, contentQuery.data?.content.data]);
  useLayoutEffect(() => setPreviewMode("rendered"), [scope]);
  const setScopedAnnouncement = useCallback((message: string) => { if (isCurrent()) setAnnouncement(message); }, [isCurrent]);
  const downloadUrl = resource?.capabilities.download
    ? fileResourcesApi.downloadUrl(issueId, state)
    : null;

  const renderedPreview = resource && (isHtmlPreview(resource.contentType, resource.displayPath || resource.title) || isCsvFile(resource.displayPath || resource.title, resource.contentType ?? "") || /\.(md|markdown|mdown|mkdn|mkd)$/i.test(resource.displayPath || resource.title) || resource.contentType?.includes("markdown"));

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <header className="flex min-w-0 items-start gap-2 border-b border-border bg-card px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium" title={payload.path}>{resource?.title ?? payload.path}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground" title={payload.path}>{payload.path}</p>
          <FileViewerMetadataRow resolvedResource={resource} state={state} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {contentQuery.data ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("documentUi.copyFile")}
              title={t(copied ? "documentUi.copied" : "documentUi.copyFile")}
              onClick={() => {
                const token = ++attempt.current;
                void copyTextToClipboard(contentQuery.data!.content.data).then(() => {
                  if (!isCurrent() || token !== attempt.current) return;
                  setCopied(true); setCopyFailed(false);
                  if (timer.current !== null) window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(() => { if (isCurrent() && token === attempt.current) setCopied(false); }, 1800);
                }).catch(() => {
                  if (isCurrent() && token === attempt.current) { setCopied(false); setCopyFailed(true); }
                });
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          ) : null}
          {renderedPreview && contentQuery.data ? <FilePreviewModeToggle mode={previewMode} onChange={setPreviewMode} label={t("documentUi.filePreviewMode")} /> : null}
          {downloadUrl ? (
            <Button asChild variant="ghost" size="icon-sm">
              <a href={downloadUrl} download={resource?.title} aria-label={t("documentUi.downloadFile")} title={t("documentUi.downloadFile")}>
                <Download aria-hidden />
              </a>
            </Button>
          ) : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="sr-only" aria-live="polite">{copyFailed ? t("documentUi.copyFailed") : copied ? t("documentUi.copied") : announcement}</div>
        <FileViewerBody
          previewMode={previewMode}
          resolveQuery={resourceQuery}
          contentQuery={contentQuery}
          elapsedMs={0}
          canPreview={resource?.capabilities.preview ?? false}
          highlightedLine={payload.line}
          onRetry={() => {
            void resourceQuery.refetch();
            if (resource?.capabilities.preview) void contentQuery.refetch();
          }}
          onSetAnnouncement={setScopedAnnouncement}
          onFallbackToProject={onFallbackToProject ?? null}
        />
      </div>
    </div>
  );
}
