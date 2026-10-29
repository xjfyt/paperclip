import { useAuthSessionFence } from "./useAuthSessionFence";
import { t, useTranslation } from "@/i18n";
import { useOptionalCompany } from "@/context/CompanyContext";
import { useCommittedResourceScope } from "./useCommittedResourceScope";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentAnnotationComment, DocumentAnnotationThreadStatus, DocumentAnnotationThreadWithComments } from "@paperclipai/shared";
import { authApi } from "@/api/auth";
import { documentAnnotationsApi, type DocumentAnnotationTarget } from "@/api/document-annotations";
import { queryKeys } from "@/lib/queryKeys";
import type { PendingAnchor } from "@/components/DocumentAnnotationLayer";

interface MutationOptions {
  target: DocumentAnnotationTarget;
  baseRevisionId: string | null;
  baseRevisionNumber: number;
  pendingAnchor: PendingAnchor | null;
  onFocusThread: (threadId: string | null) => void;
  onThreadCreated?: (thread: DocumentAnnotationThreadWithComments, submittedBody: string) => void;
  onReplyAdded?: (threadId: string) => void;
}

export function useDocumentAnnotationMutations(options: MutationOptions) {
  useTranslation();
  const queryClient = useQueryClient();
  const company = useOptionalCompany();
  const auth = useAuthSessionFence();
  const [error, setError] = useState<{ scope: string; message: string; isCurrent: () => boolean } | null>(null);
  const scope = JSON.stringify([auth.key, company?.selectedCompanyId, options.target, options.baseRevisionId, options.pendingAnchor?.selector]);
  const isResourceCurrent = useCommittedResourceScope(scope);
  const isCurrent = () => isResourceCurrent() && auth.isCurrent();
  const { data: session } = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession(), staleTime: 5 * 60_000 });
  const currentUser = {
    id: session?.user?.id ?? null,
    name: session?.user?.name?.trim() || session?.user?.email?.trim() || t("annotationUi.you"),
    image: session?.user?.image ?? null,
  };
  const queryKey = useMemo(() => options.target.kind === "routine"
    ? queryKeys.routines.documentAnnotations(options.target.routineId, options.target.documentKey, "all")
    : options.target.kind === "case"
      ? queryKeys.cases.documentAnnotations(options.target.caseId, options.target.documentKey, "all")
      : queryKeys.issues.documentAnnotations(options.target.issueId, options.target.documentKey, "all"), [options.target]);
  // Capture before mutate: React Query may replace observer options while an
  // async onMutate is awaiting cancellation. The request and cache must retain
  // the clicked target even when a different document commits meanwhile.
  const snapshot = () => ({ options, queryKey, isCurrent, isAuthCurrent: auth.isCurrent, scope, user: currentUser });
  type Snapshot = ReturnType<typeof snapshot>;
  const clearError = (source: Snapshot) => { if (source.isCurrent()) setError(null); };
  const fail = (source: Snapshot, error: unknown, fallback: string) => {
    if (source.isCurrent()) setError({ scope: source.scope, message: messageFor(error, t(fallback)), isCurrent: source.isCurrent });
  };
  const invalidate = (source: Snapshot) => source.isAuthCurrent() ? queryClient.invalidateQueries({
    predicate: query => source.queryKey.slice(0, 4).every((part, index) => query.queryKey[index] === part),
  }) : Promise.resolve();

  const createThread = useMutation({
    mutationFn: async ({ body, source }: { body: string; source: Snapshot }) => {
      if (!source.isAuthCurrent()) throw new Error("Session changed");
      const captured = source.options;
      if (!captured.pendingAnchor) throw new Error("No selection to anchor to.");
      if (!captured.baseRevisionId) throw new Error("Document has no revision yet.");
      return documentAnnotationsApi.createForTarget(captured.target, {
        baseRevisionId: captured.baseRevisionId, baseRevisionNumber: captured.baseRevisionNumber,
        selector: captured.pendingAnchor.selector, body,
      });
    },
    onMutate: async ({ body, source }) => {
      if (!source.options.pendingAnchor || !source.options.baseRevisionId) return undefined;
      clearError(source);
      await queryClient.cancelQueries({ queryKey: source.queryKey });
      if (!source.isAuthCurrent()) return undefined;
      const previous = queryClient.getQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey);
      const optimistic = buildOptimisticThread(body, source.options, source.user);
      queryClient.setQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey, current => [...(current ?? []), optimistic]);
      if (source.isCurrent()) source.options.onFocusThread(optimistic.id);
      return { previous, optimisticId: optimistic.id };
    },
    onError: (error, { source }, context) => {
      if (context && source.isAuthCurrent()) queryClient.setQueryData(source.queryKey, context.previous ?? []);
      fail(source, error, "annotationUi.createFailed");
    },
    onSuccess: (thread, { source, body }, context) => {
      if (!source.isAuthCurrent()) return;
      queryClient.setQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey, current =>
        (current ?? []).map(entry => entry.id === context?.optimisticId ? thread : entry));
      if (!source.isCurrent()) return;
      clearError(source); source.options.onFocusThread(thread.id); source.options.onThreadCreated?.(thread, body);
    },
    onSettled: (_data, _error, { source }) => invalidate(source),
  });
  const addReply = useMutation({
    mutationFn: ({ threadId, body, source }: { threadId: string; body: string; source: Snapshot }) => { if (!source.isAuthCurrent()) throw new Error("Session changed"); return documentAnnotationsApi.addCommentForTarget(source.options.target, threadId, { body }); },
    onMutate: async ({ threadId, body, source }) => {
      clearError(source); await queryClient.cancelQueries({ queryKey: source.queryKey });
      if (!source.isAuthCurrent()) return undefined;
      const previous = queryClient.getQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey);
      const optimistic = buildOptimisticComment(body, threadId, source.options.target, source.user.id);
      queryClient.setQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey, current => (current ?? []).map(thread =>
        thread.id === threadId ? { ...thread, comments: [...thread.comments, optimistic], updatedAt: optimistic.createdAt } : thread));
      return { previous };
    },
    onError: (error, { source }, context) => {
      if (context && source.isAuthCurrent()) queryClient.setQueryData(source.queryKey, context.previous ?? []);
      fail(source, error, "annotationUi.replyFailed");
    },
    onSuccess: (_comment, { source, threadId }) => {
      if (!source.isCurrent()) return;
      clearError(source); source.options.onReplyAdded?.(threadId);
    },
    onSettled: (_data, _error, { source }) => invalidate(source),
  });
  const updateStatus = useMutation({
    mutationFn: ({ threadId, status, source }: { threadId: string; status: DocumentAnnotationThreadStatus; source: Snapshot }) => { if (!source.isAuthCurrent()) throw new Error("Session changed"); return documentAnnotationsApi.updateStatusForTarget(source.options.target, threadId, status); },
    onMutate: async ({ threadId, status, source }) => {
      clearError(source); await queryClient.cancelQueries({ queryKey: source.queryKey });
      if (!source.isAuthCurrent()) return undefined;
      const previous = queryClient.getQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey);
      queryClient.setQueryData<DocumentAnnotationThreadWithComments[]>(source.queryKey, current => (current ?? []).map(thread => thread.id === threadId ? { ...thread, status } : thread));
      return { previous };
    },
    onError: (error, { source }, context) => {
      if (context && source.isAuthCurrent()) queryClient.setQueryData(source.queryKey, context.previous ?? []);
      fail(source, error, "annotationUi.statusFailed");
    },
    onSuccess: (_data, { source }) => clearError(source),
    onSettled: (_data, _error, { source }) => invalidate(source),
  });
  return {
    createThread: { ...createThread, isPending: createThread.isPending && createThread.variables?.source.scope === scope && createThread.variables.source.isCurrent(), mutate: (body: string) => { if (auth.isCurrent()) createThread.mutate({ body, source: snapshot() }); } },
    addReply: { ...addReply, isPending: addReply.isPending && addReply.variables?.source.scope === scope && addReply.variables.source.isCurrent(), mutate: (variables: { threadId: string; body: string }) => { if (auth.isCurrent()) addReply.mutate({ ...variables, source: snapshot() }); } },
    updateStatus: { ...updateStatus, isPending: updateStatus.isPending && updateStatus.variables?.source.scope === scope && updateStatus.variables.source.isCurrent(), mutate: (variables: { threadId: string; status: DocumentAnnotationThreadStatus }) => { if (auth.isCurrent()) updateStatus.mutate({ ...variables, source: snapshot() }); } },
    mutationError: error?.scope === scope && error.isCurrent() ? error.message : null, currentUser,
  };
}

function messageFor(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
function optimisticId(prefix: string) { return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`; }
function buildOptimisticComment(body: string, threadId: string, target: DocumentAnnotationTarget, userId: string | null): DocumentAnnotationComment {
  const now = new Date();
  return { id: optimisticId("optimistic-comment"), companyId: "", threadId, issueId: target.kind === "issue" ? target.issueId : null, routineId: target.kind === "routine" ? target.routineId : null, caseId: target.kind === "case" ? target.caseId : null, documentId: "", body, authorType: "user", authorAgentId: null, authorUserId: userId, createdByRunId: null, issueCommentId: null, createdAt: now, updatedAt: now };
}
function buildOptimisticThread(body: string, options: MutationOptions, user: { id: string | null }): DocumentAnnotationThreadWithComments {
  const id = optimisticId("optimistic-thread");
  const now = new Date();
  return { id, issueId: options.target.kind === "issue" ? options.target.issueId : null, routineId: options.target.kind === "routine" ? options.target.routineId : null, caseId: options.target.kind === "case" ? options.target.caseId : null, documentKey: options.target.documentKey, status: "open", anchorState: "active", selectedText: options.pendingAnchor!.selectedText, normalizedStart: options.pendingAnchor!.selector.position.normalizedStart, markdownStart: options.pendingAnchor!.selector.position.markdownStart, originalRevisionId: options.baseRevisionId!, originalRevisionNumber: options.baseRevisionNumber, currentRevisionId: options.baseRevisionId!, currentRevisionNumber: options.baseRevisionNumber, createdByUserId: user.id, createdAt: now, updatedAt: now, comments: [buildOptimisticComment(body, id, options.target, user.id)] } as unknown as DocumentAnnotationThreadWithComments;
}
