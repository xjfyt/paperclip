import { i18n, t, formatNumber, useTranslation } from "@/i18n";
import { useCommittedResourceScope } from "@/hooks/useCommittedResourceScope";
import { artifactFileSize } from "@/lib/artifact-card-data";
import { CsvPreview } from "./CsvPreview";
import { isCsvFile } from "@/lib/csv-preview";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  Cloud,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileSearch,
  FolderOpen,
  FolderSearch,
  Link2,
  Loader2,
  Lock,
  RefreshCcw,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileResourcesApi } from "@/api/file-resources";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  useRequiredFileViewer,
  type FileViewerUrlState,
} from "@/context/FileViewerContext";
import { WorkspaceFileBrowser } from "@/components/WorkspaceFileBrowser";
import { WorkspaceFileMarkdownBody } from "@/components/WorkspaceFileMarkdownBody";
import { HtmlArtifactPreview } from "@/components/HtmlArtifactPreview";
import { FilePreviewModeToggle, type FilePreviewMode } from "@/components/FilePreviewModeToggle";
import { isHtmlPreview } from "@/lib/html-preview";
import type {
  ResolvedWorkspaceResource,
  WorkspaceFileContent,
  WorkspaceFileSelector,
} from "@paperclipai/shared";

const FILE_VIEWER_LABELLED_BY_ID = "paperclip-file-viewer-title";
const FILE_VIEWER_DESCRIBED_BY_ID = "paperclip-file-viewer-description";
const MIN_FILE_TREE_WIDTH = 220;
const MAX_FILE_TREE_WIDTH = 520;

interface FileViewerErrorShape {
  status: number;
  code: string;
  message: string;
}

function normalizeError(error: unknown): FileViewerErrorShape {
  if (error instanceof ApiError) {
    const body = (error.body ?? null) as { error?: string; code?: string } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    return {
      status: error.status,
      code,
      message: typeof body?.error === "string" ? body.error : error.message,
    };
  }
  if (error instanceof Error) {
    return { status: 0, code: "", message: error.message };
  }
  return { status: 0, code: "", message: "Something went wrong." };
}

function formatBytes(size: number | null | undefined): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  return artifactFileSize(size, i18n.language);
}

function splitContentIntoLines(data: string): string[] {
  if (data === "") return [""];
  const normalized = data.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length > 0 ? lines : [""];
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? path : path.slice(idx + 1);
}

function middleTruncatePath(path: string, maxLen = 80): string {
  if (path.length <= maxLen) return path;
  const head = path.slice(0, Math.floor(maxLen / 2) - 1);
  const tail = path.slice(path.length - (maxLen - head.length - 1));
  return `${head}…${tail}`;
}

function isMarkdownResource(resource: ResolvedWorkspaceResource): boolean {
  const contentType = resource.contentType?.toLowerCase() ?? "";
  if (contentType.includes("markdown")) return true;
  const path = (resource.displayPath || resource.title).toLowerCase();
  return /\.(md|markdown|mdown|mkdn|mkd)$/.test(path);
}

export function describeDenial(code: string, fallback: string): { title: string; body: string; icon: ReactNode } {
  const lower = code.toLowerCase();
  if (lower.includes("policy") || lower.includes("denied") || lower.includes("sensitive")) {
    return {
      icon: <Lock aria-hidden="true" className="h-6 w-6 text-amber-500" />,
      title: t("fileViewerUi.blockedTitle"),
      body: t("fileViewerUi.blockedBody"),
    };
  }
  if (lower.includes("outside") || lower.includes("traversal")) {
    return {
      icon: <Ban aria-hidden="true" className="h-6 w-6 text-red-500" />,
      title: t("fileViewerUi.outsideTitle"),
      body: t("fileViewerUi.outsideBody"),
    };
  }
  if (lower.includes("archive") || lower.includes("cleaned")) {
    return {
      icon: <FolderOpen aria-hidden="true" className="h-6 w-6 text-muted-foreground" />,
      title: t("fileViewerUi.unavailableTitle"),
      body: t("fileViewerUi.unavailableBody"),
    };
  }
  if (lower.includes("remote")) {
    return {
      icon: <AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-500" />,
      title: t("fileViewerUi.remoteTitle"),
      body: t("fileViewerUi.remoteBody"),
    };
  }
  if (lower.includes("too_large") || lower.includes("size")) {
    return {
      icon: <AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-500" />,
      title: t("fileViewerUi.largeTitle"),
      body: t("fileViewerUi.largeBody"),
    };
  }
  if (lower.includes("binary") || lower.includes("unsupported")) {
    return {
      icon: <AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-500" />,
      title: t("fileViewerUi.unsupportedTitle"),
      body: t("fileViewerUi.unsupportedBody"),
    };
  }
  return {
    icon: <Ban aria-hidden="true" className="h-6 w-6 text-red-500" />,
    title: t("fileViewerUi.previewTitle"),
    body: fallback || t("fileViewerUi.previewBody"),
  };
}

function FileViewerStateView({
  icon,
  title,
  body,
  secondary,
  actions,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  secondary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 p-6 text-sm">
      <div className="flex items-start gap-3">
        {icon}
        <div className="flex-1 space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          {body ? <p className="text-muted-foreground">{body}</p> : null}
          {secondary}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function FileViewerMetadataRow({
  resolvedResource,
  state,
}: {
  resolvedResource?: ResolvedWorkspaceResource;
  state: FileViewerUrlState | null;
}) {
  useTranslation();
  return (
    <div className="flex min-h-(--sz-18px) flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {resolvedResource ? (
        <>
          {resolvedResource.previewKind ? <span className="capitalize">{t(`fileViewerUi.kind${resolvedResource.previewKind.charAt(0).toUpperCase()}${resolvedResource.previewKind.slice(1)}`, { defaultValue: resolvedResource.previewKind })}</span> : null}
          {formatBytes(resolvedResource.byteSize) ? (
            <>
              <span aria-hidden="true" className="opacity-50">·</span>
              <span>{formatBytes(resolvedResource.byteSize)}</span>
            </>
          ) : null}
          {state?.line ? (
            <>
              <span aria-hidden="true" className="opacity-50">·</span>
              <span>
                {t("fileViewerUi.line", { line: formatNumber(state.line) })}
                {state.column ? `, ${t("fileViewerUi.column", { column: formatNumber(state.column) })}` : ""}
              </span>
            </>
          ) : null}
        </>
      ) : state ? (
        <span className="h-3 w-28 rounded bg-muted animate-pulse" aria-label={t("fileViewerUi.detailsLoading")} />
      ) : null}
    </div>
  );
}

interface FileContentViewerProps {
  content: WorkspaceFileContent;
  highlightedLine: number | null;
  onLoaded?: (summary: string) => void;
  previewMode?: "raw" | "rendered";
  htmlMode?: FilePreviewMode;
}

type MarkdownPreviewMode = "raw" | "rendered";

export function FileContentViewer({ content, highlightedLine, onLoaded, previewMode, htmlMode = "rendered" }: FileContentViewerProps) {
  const { i18n } = useTranslation();
  const { resource } = content;
  const isMarkdown = resource.previewKind === "text" && content.content.encoding === "utf8" && isMarkdownResource(resource);
  const isCsv = resource.previewKind === "text" && content.content.encoding === "utf8" && isCsvFile(resource.displayPath || resource.title, resource.contentType ?? "");
  const [localMode, setMarkdownMode] = useState<MarkdownPreviewMode>("rendered");
  const markdownMode = isMarkdown || isCsv ? (previewMode ?? localMode) : "raw";
  const isHtml = resource.previewKind === "text" && content.content.encoding === "utf8" && isHtmlPreview(resource.contentType, resource.displayPath || resource.title);
  const previewLabel = isCsv ? "CSV" : "Markdown";
  const lines = useMemo(() => {
    if (resource.previewKind === "text") {
      return splitContentIntoLines(content.content.data);
    }
    return null;
  }, [content.content.data, resource.previewKind]);

  const codeScrollRef = useRef<HTMLDivElement>(null);
  const highlightedLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMarkdownMode(isMarkdown || isCsv ? "rendered" : "raw");
  }, [isMarkdown, isCsv, resource.displayPath, resource.title, resource.contentType]);

  useEffect(() => {
    if (!lines) return;
    onLoaded?.(t("fileViewerUi.loaded", { count: lines.length, number: formatNumber(lines.length) }));
  }, [lines, onLoaded, i18n.language]);

  useEffect(() => {
    if (markdownMode !== "raw") return;
    if (!highlightedLine || !highlightedLineRef.current) return;
    highlightedLineRef.current.scrollIntoView({ block: "center", behavior: "auto" });
  }, [highlightedLine, markdownMode, htmlMode, previewMode]);

  if (resource.previewKind === "image") {
    const dataUrl = content.content.encoding === "base64"
      ? `data:${resource.contentType ?? "application/octet-stream"};base64,${content.content.data}`
      : null;
    if (!dataUrl) {
      return (
        <FileViewerStateView
          icon={<AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-500" />}
          title={t("fileViewerUi.imageUnavailable")}
        />
      );
    }
    return (
      <div className="flex items-center justify-center overflow-auto bg-muted/40 p-4">
        <img
          src={dataUrl}
          alt={resource.title}
          className="max-h-full max-w-full rounded border border-border object-contain"
        />
      </div>
    );
  }

  if (resource.previewKind === "video") {
    const dataUrl = content.content.encoding === "base64"
      ? `data:${resource.contentType ?? "application/octet-stream"};base64,${content.content.data}`
      : null;
    if (!dataUrl) {
      return (
        <FileViewerStateView
          icon={<AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-500" />}
          title={t("fileViewerUi.videoUnavailable")}
        />
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto bg-black p-4">
        <video
          src={dataUrl}
          controls
          preload="metadata"
          playsInline
          aria-label={t("fileViewerUi.videoPreview", { title: resource.title })}
          className="max-h-full max-w-full rounded border border-white/10 bg-black"
        />
      </div>
    );
  }

  if (resource.previewKind === "unsupported" || !lines) {
    return (
      <FileViewerStateView
        icon={<AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-500" />}
        title={t("fileViewerUi.unsupportedTitle")}
        body={resource.contentType ? t("fileViewerUi.contentType", { type: resource.contentType }) : undefined}
      />
    );
  }

  const gutterWidth = `calc(${Math.max(4, String(lines.length).length)}ch + 2rem)`;

  const rawSourceView = (
    <div
      ref={codeScrollRef}
      role="region"
      aria-label={t("fileViewerUi.source", { title: resource.title })}
      tabIndex={0}
      className="paperclip-file-viewer-code flex-1 overflow-auto bg-(--code-bg-resolved) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <pre className="m-0 font-mono text-xs leading-5">
        {lines.map((lineText, index) => {
          const lineNumber = index + 1;
          const isHighlighted = lineNumber === highlightedLine;
          return (
            <div
              key={lineNumber}
              ref={isHighlighted ? highlightedLineRef : undefined}
              data-line-number={lineNumber}
              className={cn(
                "grid grid-cols-(--gtc-5)",
                // Batch 4 resolved the former half-migrated var(--x, fallback)
                // pattern here into --code-highlight-bg-resolved (see
                // ui/src/index.css MISC token block + TOKEN-AUDIT.md Batch 4 log).
                isHighlighted && "bg-(--code-highlight-bg-resolved)",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "sticky left-0 z-10 shrink-0 select-none pl-3 pr-4 text-right text-(--code-gutter-fg-resolved) opacity-70",
                  "bg-(--code-bg-resolved)",
                  isHighlighted &&
                    "opacity-100 bg-(--code-highlight-bg-resolved) border-l-2 border-(--code-highlight-border-resolved)",
                )}
                style={{ width: gutterWidth, minWidth: gutterWidth }}
              >
                {lineNumber}
              </span>
              <code className="min-w-0 whitespace-pre-wrap break-words pr-4">{lineText.length === 0 ? "​" : lineText}</code>
            </div>
          );
        })}
      </pre>
    </div>
  );

  if (isHtml) {
    return (previewMode ?? htmlMode) === "raw" ? rawSourceView : <HtmlArtifactPreview html={content.content.data} title={resource.title} />;
  }

  if (!isMarkdown && !isCsv) {
    return rawSourceView;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {previewMode === undefined && <div className="absolute right-3 top-3 z-20">
        <div
          role="group"
          aria-label={t("fileViewerUi.previewMode", { type: previewLabel })}
          className="inline-flex rounded-md border border-border bg-background/95 p-0.5 shadow-sm backdrop-blur"
        >
          <Button
            type="button"
            variant={markdownMode === "rendered" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={t("fileViewerUi.showRendered", { type: previewLabel })}
            title={t("fileViewerUi.rendered", { type: previewLabel })}
            aria-pressed={markdownMode === "rendered"}
            onClick={() => setMarkdownMode("rendered")}
            className={cn(
              "h-7 w-7 rounded-sm",
              markdownMode !== "rendered" && "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant={markdownMode === "raw" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={t("fileViewerUi.showRaw", { type: previewLabel })}
            title={t("fileViewerUi.raw", { type: previewLabel })}
            aria-pressed={markdownMode === "raw"}
            onClick={() => setMarkdownMode("raw")}
            className={cn(
              "h-7 w-7 rounded-sm",
              markdownMode !== "raw" && "text-muted-foreground hover:text-foreground",
            )}
          >
            <FileCode2 aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      }
      {markdownMode === "raw" ? (
        rawSourceView
      ) : isCsv ? <CsvPreview text={content.content.data} title={resource.title} /> : (
        <div
          role="region"
          aria-label={t("fileViewerUi.renderedMarkdown", { title: resource.title })}
          tabIndex={0}
          className="flex-1 overflow-auto bg-background p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <WorkspaceFileMarkdownBody softBreaks={false}>
            {content.content.data}
          </WorkspaceFileMarkdownBody>
        </div>
      )}
    </div>
  );
}

function LoadingView({ elapsedMs }: { elapsedMs: number }) {
  useTranslation();
  if (elapsedMs < 100) {
    return <div className="flex-1" aria-hidden="true" />;
  }
  if (elapsedMs < 400) {
    return (
      <div className="flex-1 space-y-2 p-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t("fileViewerUi.previewLoading")}</span>
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="h-3 rounded bg-muted animate-pulse" style={{ width: `${90 - index * 6}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div
      className="flex flex-1 flex-col items-start justify-start gap-3 p-6 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        {t("fileViewerUi.previewLoading")}…
      </div>
    </div>
  );
}

interface FileViewerSheetProps {
  issueId: string;
  companyId?: string | null;
  /** When not provided, the sheet defaults to the context state. */
  state?: FileViewerUrlState | null;
  /** When true, renders the "Open file" prompt when no file is selected but sheet is open. */
  showPromptWhenEmpty?: boolean;
  /** Whether the sheet is open. Defaults to `state !== null`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FileViewerSheet({
  issueId,
  companyId,
  state: stateProp,
  showPromptWhenEmpty = false,
  open: openProp,
  onOpenChange,
}: FileViewerSheetProps) {
  useTranslation();
  const viewer = useRequiredFileViewer();
  const state = typeof stateProp !== "undefined" ? stateProp : viewer.state;
  // Browse mode: no file selected, but the sheet was opened to browse/search.
  const browseMode = state === null && (showPromptWhenEmpty || viewer.browse);
  // True when the current file was reached from the browse list (drill-down).
  const cameFromBrowse = state !== null && viewer.browse;
  const computedOpen =
    typeof openProp === "boolean" ? openProp : state !== null || showPromptWhenEmpty || viewer.browse;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [htmlMode, setHtmlMode] = useState<FilePreviewMode>("rendered");

  const [copiedField, setCopiedField] = useState<"content" | "link" | null>(null);
  const [copyingField, setCopyingField] = useState<"content" | "link" | null>(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [announcement, setAnnouncement] = useState<string>("");
  const [fileTreeWidth, setFileTreeWidth] = useState(288);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const copyAttempt = useRef(0);


  const resolveQuery = useQuery({
    queryKey: state
      ? queryKeys.issues.fileResource(issueId, state)
      : ["issues", "file-resources", issueId, "resolve", "__closed__"],
    queryFn: () => fileResourcesApi.resolve(issueId, state!),
    enabled: !!state && computedOpen,
    retry: false,
    staleTime: 30_000,
  });

  const resolvedResource: ResolvedWorkspaceResource | undefined = resolveQuery.data;
  const canPreview = resolvedResource?.capabilities.preview ?? false;
  const downloadUrl = state && resolvedResource?.capabilities.download
    ? fileResourcesApi.downloadUrl(issueId, state)
    : null;

  const contentQuery = useQuery({
    queryKey: state
      ? queryKeys.issues.fileResourceContent(issueId, state)
      : ["issues", "file-resources", issueId, "content", "__closed__"],
    queryFn: () => fileResourcesApi.content(issueId, state!),
    enabled: !!state && computedOpen && canPreview,
    retry: false,
    staleTime: 30_000,
  });

  const scope = JSON.stringify([companyId, issueId, computedOpen, state?.path, state?.workspace, state?.workspaceId, state?.projectId, resolvedResource?.workspaceId, resolvedResource?.provider]);
  const isCurrent = useCommittedResourceScope(scope);
  const sourceIsCurrent = useCommittedResourceScope(scope, contentQuery.data?.content.data);
  const committedContent = useRef(contentQuery.data?.content.data);
  useLayoutEffect(() => {
    if (committedContent.current !== undefined && committedContent.current !== contentQuery.data?.content.data) {
      copyAttempt.current += 1; setCopiedField(null); setCopyingField(null); setCopyFeedback("");
    }
    committedContent.current = contentQuery.data?.content.data;
  }, [contentQuery.data?.content.data]);
  useLayoutEffect(() => {
    copyAttempt.current += 1;
    setHtmlMode("rendered"); setCopiedField(null); setCopyingField(null); setCopyFeedback(""); setAnnouncement("");
    return () => { if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current); };
  }, [scope]);

  // `elapsedMs` only drives the progressive loading skeleton (see LoadingView).
  // Run the 75ms ticker *only* while a preview is still loading — leaving it
  // running after content arrives would re-render the whole sheet ~13x/second,
  // which forces the markdown body to re-render and discards scroll position
  // and text selection, producing visible flashing (PAP-10767).
  const isLoadingPreview =
    (resolveQuery.isFetching && !resolveQuery.data) ||
    (canPreview && contentQuery.isFetching && !contentQuery.data);

  useEffect(() => {
    if (!state) {
      setElapsedMs(0);
      return;
    }
    if (!isLoadingPreview) return;
    const now = Date.now();
    setElapsedMs(0);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - now);
    }, 75);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.path, state?.workspace, state?.projectId, state?.workspaceId, isLoadingPreview]);

  useEffect(() => {
    if (resolveQuery.isError && !resolveQuery.data) {
      const normalized = normalizeError(resolveQuery.error);
      setAnnouncement(normalized.message || t("fileViewerUi.loadError"));
    }
  }, [resolveQuery.isError, resolveQuery.error]);

  useEffect(() => {
    if (contentQuery.isError && !contentQuery.data) {
      const normalized = normalizeError(contentQuery.error);
      setAnnouncement(normalized.message || t("fileViewerUi.contentLoadError"));
    }
  }, [contentQuery.isError, contentQuery.error]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current);
    resizeCleanupRef.current?.();
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (onOpenChange) {
        onOpenChange(next);
        return;
      }
      if (!next) viewer.close();
    },
    [onOpenChange, viewer],
  );

  const handleBrowseOpen = useCallback(
    (ref: {
      path: string;
      workspace: WorkspaceFileSelector;
      line?: number | null;
      column?: number | null;
      projectId?: string | null;
      workspaceId?: string | null;
      browseFolderPath?: string | null;
      browseQuery?: string | null;
    }) => {
      viewer.open(
        {
          path: ref.path,
          line: ref.line ?? null,
          column: ref.column ?? null,
          workspace: ref.workspace,
          projectId: ref.projectId ?? null,
          workspaceId: ref.workspaceId ?? null,
        },
        {
          fromBrowse: true,
          browseState: {
            folderPath: ref.browseFolderPath ?? null,
            q: ref.browseQuery ?? null,
          },
        },
      );
    },
    [viewer],
  );

  const handleBrowseStateChange = useCallback(
    (next: {
      q: string | null;
      folderPath: string | null;
      projectId: string | null;
      workspaceId: string | null;
    }) => {
      viewer.updateBrowseState(next);
    },
    [viewer],
  );

  const showCopyFeedback = useCallback((field: "content" | "link" | null, message: string, token = copyAttempt.current) => {
    if (!isCurrent() || token !== copyAttempt.current) return;
    setCopiedField(field);
    setCopyFeedback(message);
    setAnnouncement("");
    if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      if (!isCurrent() || token !== copyAttempt.current) return;
      setCopiedField((current) => (current === field ? null : current));
      setCopyFeedback("");
      copyFeedbackTimerRef.current = null;
    }, 1800);
  }, [isCurrent]);

  const copyToClipboard = useCallback(async (value: string, field: "content" | "link", message: string, token = ++copyAttempt.current, sourceCurrent = isCurrent) => {
    if (!isCurrent() || token !== copyAttempt.current) return;
    try {
      setCopyingField(field);
      await copyTextToClipboard(value);
      if (!sourceCurrent()) return;
      showCopyFeedback(field, message, token);
    } catch {
      if (!sourceCurrent()) return;
      showCopyFeedback(null, "fileViewerUi.copyFailed", token);
    } finally {
      if (isCurrent() && token === copyAttempt.current) setCopyingField((current) => (current === field ? null : current));
    }
  }, [showCopyFeedback, isCurrent]);

  const handleCopyContent = useCallback(() => {
    if (!state || !isCurrent()) return;
    const token = ++copyAttempt.current;
    const sourceCurrent = contentQuery.data ? sourceIsCurrent : isCurrent;
    setCopyingField("content");
    void (async () => {
      let content = contentQuery.data;
      if (!content && canPreview) {
        const result = await contentQuery.refetch();
        content = result.data;
      }
      if (!isCurrent() || token !== copyAttempt.current) return;
      if (!content) {
        showCopyFeedback(null, "fileViewerUi.contentsUnavailable", token);
        setCopyingField(null);
        return;
      }
      const message = content.content.encoding === "base64" ? "fileViewerUi.copiedData" : "fileViewerUi.copiedContents";
      await copyToClipboard(content.content.data, "content", message, token, sourceCurrent);
    })().catch(() => {
      if (!isCurrent() || token !== copyAttempt.current) return;
      showCopyFeedback(null, "fileViewerUi.contentLoadError", token); setCopyingField(null);
    });
  }, [canPreview, contentQuery, copyToClipboard, showCopyFeedback, state, isCurrent, sourceIsCurrent]);

  const handleCopyLink = useCallback(() => {
    if (typeof window === "undefined") return;
    void copyToClipboard(window.location.href, "link", "fileViewerUi.copiedLink");
  }, [copyToClipboard]);

  const setScopedAnnouncement = useCallback((message: string) => { if (isCurrent()) setAnnouncement(message); }, [isCurrent]);

  const handleRetry = useCallback(() => {
    void resolveQuery.refetch();
    if (canPreview) void contentQuery.refetch();
  }, [canPreview, contentQuery, resolveQuery]);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = fileTreeWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        MAX_FILE_TREE_WIDTH,
        Math.max(MIN_FILE_TREE_WIDTH, startWidth + moveEvent.clientX - startX),
      );
      setFileTreeWidth(nextWidth);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", cleanup);
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", cleanup, { once: true });
  }, [fileTreeWidth]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setFileTreeWidth((current) => {
      const delta = event.key === "ArrowLeft" ? -24 : 24;
      return Math.min(MAX_FILE_TREE_WIDTH, Math.max(MIN_FILE_TREE_WIDTH, current + delta));
    });
  }, []);

  const title = state ? basename(state.path) : t("fileViewerUi.browse");
  const description = state
    ? middleTruncatePath(state.path)
    : t("fileViewerUi.browseHint");
  const showDescription = state ? description !== title : true;

  return (
    <Dialog open={computedOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-(--sz-calc-3) w-(--sz-calc-4) max-w-(--sz-calc-5) flex-col gap-0 overflow-hidden p-0 sm:w-(--sz-94vw) sm:max-w-(--sz-1280px)"
        aria-labelledby={FILE_VIEWER_LABELLED_BY_ID}
        aria-describedby={FILE_VIEWER_DESCRIBED_BY_ID}
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          // From a file reached via browse, Esc returns to the list; a second Esc closes.
          if (cameFromBrowse) {
            event.preventDefault();
            viewer.backToFiles();
          }
        }}
      >
        <DialogHeader className="border-b border-border gap-1 p-3">
          <div className="grid min-w-0 grid-cols-(--gtc-6) items-start gap-2">
            {browseMode ? (
              <FolderSearch aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileCode2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle id={FILE_VIEWER_LABELLED_BY_ID} className="truncate text-sm leading-5">
                {title}
              </DialogTitle>
              <DialogDescription
                id={FILE_VIEWER_DESCRIBED_BY_ID}
                className={cn(
                  "truncate font-mono text-xs",
                  !showDescription && "sr-only",
                )}
                title={state?.path}
              >
                {description}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1 self-start">
              <span className="hidden min-w-28 text-right text-xs text-muted-foreground sm:inline" role="status" aria-live="polite">
                {copyFeedback ? t(copyFeedback) : ""}
              </span>
              {cameFromBrowse ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => viewer.backToFiles()}
                  className="h-7 gap-1 px-2 text-xs"
                  aria-label={t("fileViewerUi.back")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t("fileViewerUi.back")}
                </Button>
              ) : null}
              {contentQuery.data?.resource.previewKind === "text" && contentQuery.data.content.encoding === "utf8"
                && isHtmlPreview(contentQuery.data.resource.contentType, contentQuery.data.resource.displayPath || contentQuery.data.resource.title) ? (
                  <FilePreviewModeToggle mode={htmlMode} onChange={setHtmlMode} label={t("documentUi.htmlView")} />
                ) : null}
              {state ? (
                downloadUrl ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7"
                  >
                    <a
                      href={downloadUrl}
                      download={resolvedResource?.title ?? basename(state.path)}
                      aria-label={t("documentUi.downloadFile")}
                      title={t("documentUi.downloadFile")}
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null
              ) : null}
              {state ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopyContent}
                  aria-label={copiedField === "content" ? t("fileViewerUi.copiedFile") : t("documentUi.copyFile")}
                  title={copiedField === "content" ? t("fileViewerUi.copiedContents") : t("documentUi.copyFile")}
                  className="h-7 w-7"
                >
                  {copyingField === "content" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : copiedField === "content" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              {state ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopyLink}
                  aria-label={copiedField === "link" ? t("fileViewerUi.copiedViewLink") : t("fileViewerUi.copyViewLink")}
                  title={copiedField === "link" ? t("fileViewerUi.copiedLink") : t("fileViewerUi.copyLink")}
                  className="h-7 w-7"
                >
                  {copyingField === "link" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : copiedField === "link" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleOpenChange(false)}
                className="h-7 w-7"
                aria-label={t("fileViewerUi.closeViewer")}
                title={t("fileViewerUi.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <FileViewerMetadataRow resolvedResource={resolvedResource} state={state} />
        </DialogHeader>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div aria-live="polite" className="sr-only">
            {copyFeedback ? t(copyFeedback) : announcement}
          </div>
          {state ? (
            <div className="flex min-h-0 flex-1 gap-3 bg-muted/30 p-3">
              <aside
                className="hidden min-h-0 shrink-0 overflow-hidden sm:flex"
                style={{ width: fileTreeWidth }}
              >
                <WorkspaceFileBrowser
                  key={`${state.projectId ?? ""}:${state.workspaceId ?? ""}`}
                  issueId={issueId}
                  companyId={companyId}
                  onOpen={handleBrowseOpen}
                  onBrowseStateChange={cameFromBrowse ? handleBrowseStateChange : undefined}
                  initialQuery={cameFromBrowse ? viewer.query : null}
                  initialFolderPath={cameFromBrowse ? viewer.folderPath : undefined}
                  initialProjectId={state.projectId ?? (cameFromBrowse ? viewer.browseProjectId : null)}
                  initialWorkspaceId={state.workspaceId ?? (cameFromBrowse ? viewer.browseWorkspaceId : null)}
                  autoFocusSearch={false}
                  compact
                  selectedPath={state.path}
                  selectedProjectId={state.projectId}
                  selectedWorkspaceId={state.workspaceId}
                  active={computedOpen}
                  className="min-h-0 flex-1 p-2"
                />
              </aside>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("fileViewerUi.resize")}
                aria-valuemin={MIN_FILE_TREE_WIDTH}
                aria-valuemax={MAX_FILE_TREE_WIDTH}
                aria-valuenow={fileTreeWidth}
                tabIndex={0}
                onPointerDown={handleResizeStart}
                onKeyDown={handleResizeKeyDown}
                className="hidden w-1 shrink-0 cursor-col-resize rounded-full bg-border transition-colors hover:bg-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
              />
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <FileViewerBody
                  resolveQuery={resolveQuery}
                  contentQuery={contentQuery}
                  elapsedMs={elapsedMs}
                  canPreview={canPreview}
                  highlightedLine={state.line ?? null}
                  htmlMode={htmlMode}
                  onRetry={handleRetry}
                  onSetAnnouncement={setScopedAnnouncement}
                  onFallbackToProject={
                    state.workspace !== "project" && !state.projectId && !state.workspaceId
                      ? () =>
                          viewer.open({
                            path: state.path,
                            line: state.line,
                            column: state.column,
                            workspace: "project",
                            projectId: null,
                            workspaceId: null,
                          })
                      : null
                  }
                />
              </div>
            </div>
          ) : browseMode ? (
            <WorkspaceFileBrowser
              issueId={issueId}
              companyId={companyId}
              onOpen={handleBrowseOpen}
              onBrowseStateChange={handleBrowseStateChange}
              initialQuery={viewer.query}
              initialFolderPath={viewer.folderPath}
              initialProjectId={viewer.browseProjectId}
              initialWorkspaceId={viewer.browseWorkspaceId}
              active={computedOpen}
              className="min-h-0 flex-1 p-4"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FileViewerBodyProps {
  resolveQuery: UseQueryResult<ResolvedWorkspaceResource, unknown>;
  contentQuery: UseQueryResult<WorkspaceFileContent, unknown>;
  elapsedMs: number;
  canPreview: boolean;
  highlightedLine: number | null;
  onRetry: () => void;
  onSetAnnouncement: (message: string) => void;
  onFallbackToProject: null | (() => void);
  previewMode?: "raw" | "rendered";
  htmlMode?: FilePreviewMode;
}

export function FileViewerBody({
  resolveQuery,
  contentQuery,
  elapsedMs,
  canPreview,
  highlightedLine,
  onRetry,
  onSetAnnouncement,
  onFallbackToProject,
  previewMode,
  htmlMode,
}: FileViewerBodyProps) {
  useTranslation();
  if (resolveQuery.isFetching && !resolveQuery.data) {
    return <LoadingView elapsedMs={elapsedMs} />;
  }

  if (resolveQuery.isError && !resolveQuery.data) {
    const normalized = normalizeError(resolveQuery.error);
    if (normalized.status === 404) {
      return (
        <FileViewerStateView
          icon={<FileSearch aria-hidden="true" className="h-6 w-6 text-muted-foreground" />}
          title={t("fileViewerUi.notFound")}
          body={t("fileViewerUi.notFoundBody")}
          actions={
            <>
              {onFallbackToProject ? (
                <Button type="button" variant="secondary" size="sm" onClick={onFallbackToProject}>
                  {t("fileViewerUi.tryProject")}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
                <RefreshCcw aria-hidden="true" className="mr-1 h-3 w-3" /> {t("documentUi.retry")}
              </Button>
            </>
          }
        />
      );
    }
    if (normalized.status === 422) {
      return (
        <FileViewerStateView
          icon={<FolderOpen aria-hidden="true" className="h-6 w-6 text-muted-foreground" />}
          title={t("fileViewerUi.noWorkspace")}
          body={t("fileViewerUi.noWorkspaceBody")}
        />
      );
    }
    const denial = describeDenial(normalized.code, normalized.message);
    return (
      <FileViewerStateView
        icon={denial.icon}
        title={denial.title}
        body={denial.body}
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCcw aria-hidden="true" className="mr-1 h-3 w-3" /> {t("documentUi.retry")}
          </Button>
        }
      />
    );
  }

  const resource = resolveQuery.data;
  if (!resource) return null;

  if (resource.kind === "remote_resource") {
    return (
      <FileViewerStateView
        icon={<Cloud aria-hidden="true" className="h-6 w-6 text-muted-foreground" />}
        title={t("fileViewerUi.remoteSoon")}
        body={t("fileViewerUi.remoteSoonBody")}
      />
    );
  }

  if (!canPreview) {
    const denial = describeDenial(resource.denialReason ?? "", "");
    return <FileViewerStateView icon={denial.icon} title={denial.title} body={denial.body} />;
  }

  if (contentQuery.isFetching && !contentQuery.data) {
    return <LoadingView elapsedMs={elapsedMs} />;
  }

  if (contentQuery.isError && !contentQuery.data) {
    const normalized = normalizeError(contentQuery.error);
    const denial = describeDenial(normalized.code, normalized.message);
    return (
      <FileViewerStateView
        icon={denial.icon}
        title={denial.title}
        body={denial.body}
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCcw aria-hidden="true" className="mr-1 h-3 w-3" /> {t("documentUi.retry")}
          </Button>
        }
      />
    );
  }

  if (!contentQuery.data) return null;

  return (
    <>
      {resolveQuery.isError || contentQuery.isError ? (
        <div role="alert" className="p-3 text-sm text-muted-foreground">
          {t("fileViewerUi.contentLoadError")}
          <Button variant="ghost" size="sm" onClick={onRetry}>{t("documentUi.retry")}</Button>
        </div>
      ) : null}
    <FileContentViewer
      content={contentQuery.data}
      highlightedLine={highlightedLine}
      previewMode={previewMode}
      onLoaded={onSetAnnouncement}
      htmlMode={htmlMode}
    />
    </>
  );
}
