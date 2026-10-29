import { formatDate, formatNumber, useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueDocument } from "@paperclipai/shared";
import { FileQuestion, Loader2 } from "lucide-react";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { DocumentAnnotationsCountChip, IssueDocumentAnnotations } from "@/components/IssueDocumentAnnotations";
import { MarkdownBody } from "@/components/MarkdownBody";
import { queryKeys } from "@/lib/queryKeys";
import { documentDisplayTitle } from "@/lib/issue-artifacts";
import { useLocation } from "@/lib/router";

export function TaskDocumentPanel({
  issueId,
  documentKey,
  initialDocument,
}: {
  issueId: string;
  documentKey: string;
  initialDocument?: IssueDocument;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(false);
  const query = useQuery<IssueDocument | null>({
    queryKey: [...queryKeys.issues.documents(issueId), documentKey],
    queryFn: async () => {
      try {
        return await issuesApi.getDocument(issueId, documentKey);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    initialData: initialDocument,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t("documentUi.documentLoading")}
      </div>
    );
  }
  const feedback = query.isError ? (
    <div className="py-2 text-sm text-muted-foreground" role="alert">
      {t("documentUi.documentLoadError")}
      <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>{t("documentUi.retry")}</Button>
    </div>
  ) : null;
  if (query.isError && !query.data) return feedback;
  const document = query.data;
  if (!document) {
    return (
      <div className="flex items-start gap-3 py-8 text-sm" role="status">
        <FileQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">{t("documentUi.documentMissing")}</p>
          <p className="text-muted-foreground">
            {t("documentUi.documentMissingHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="space-y-4">
      {feedback}
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{documentDisplayTitle(document)}</h2>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{t("documentUi.revision", { revision: formatNumber(document.latestRevisionNumber ?? 1) })}</span>
          <span aria-hidden>·</span>
          <span>{t("documentUi.updated", { date: formatDate(new Date(document.updatedAt), { dateStyle: "medium", timeStyle: "short" }) })}</span>
          <DocumentAnnotationsCountChip
            issueId={issueId}
            docKey={document.key}
            panelOpen={annotationPanelOpen}
            onToggle={() => setAnnotationPanelOpen((open) => !open)}
          />
        </div>
      </header>
      {document.body.trim() ? (
        <IssueDocumentAnnotations
          issueId={issueId}
          doc={document}
          bodyMarkdown={document.body}
          draftDirty={false}
          draftConflicted={false}
          historicalPreview={false}
          locationHash={location.hash}
          panelOpen={annotationPanelOpen}
          onPanelOpenChange={setAnnotationPanelOpen}
          panelPlacement="popover"
        >
          <MarkdownBody>{document.body}</MarkdownBody>
        </IssueDocumentAnnotations>
      ) : (
        <p className="text-sm text-muted-foreground">{t("documentUi.documentEmpty")}</p>
      )}
    </article>
  );
}
