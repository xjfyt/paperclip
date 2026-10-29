// @vitest-environment jsdom
import "@/i18n/annotation-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocumentAnnotationThreadWithComments } from "@paperclipai/shared";
import { expect, it, vi } from "vitest";
import { documentAnnotationsApi, type DocumentAnnotationTarget } from "@/api/document-annotations";
import { queryKeys } from "@/lib/queryKeys";
import { useDocumentAnnotationMutations } from "./useDocumentAnnotationMutations";
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => null } }));
const anchor = { selectedText: "Original quote", selector: { quote: { exact: "Original quote", prefix: "", suffix: "" }, position: { normalizedStart: 0, normalizedEnd: 14, markdownStart: 0, markdownEnd: 14 } } };
const first = { kind: "issue", issueId: "same-id", documentKey: "description" } as const satisfies DocumentAnnotationTarget;
const second = { kind: "routine", routineId: "same-id", documentKey: "description" } as const satisfies DocumentAnnotationTarget;
it("captures the clicked source before async onMutate and never clears a newer document draft", async () => {
  const host = document.createElement("div"); const root = createRoot(host); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current!: ReturnType<typeof useDocumentAnnotationMutations>;
  let resume!: () => void; const cancelled = new Promise<void>(resolve => { resume = resolve; });
  const cancel = vi.spyOn(client, "cancelQueries").mockReturnValueOnce(cancelled);
  const created: DocumentAnnotationThreadWithComments = {
    id: "created-first", companyId: "company", issueId: first.issueId, documentId: "issue-description", documentKey: first.documentKey,
    status: "open", anchorState: "active", anchorConfidence: "exact",
    originalRevisionId: "revision", originalRevisionNumber: 1, currentRevisionId: "revision", currentRevisionNumber: 1,
    selectedText: anchor.selectedText, prefixText: "", suffixText: "", ...anchor.selector.position, anchorSelector: anchor.selector,
    createdByAgentId: null, createdByUserId: "user", resolvedByAgentId: null, resolvedByUserId: null, resolvedAt: null,
    createdAt: new Date("2026-10-29T00:00:00Z"), updatedAt: new Date("2026-10-29T00:00:00Z"), comments: [],
  };
  const newerCache: DocumentAnnotationThreadWithComments[] = [{
    ...created, id: "keep-newer-cache", issueId: null, routineId: second.routineId, documentId: "routine-description", documentKey: second.documentKey,
  }];
  const create = vi.spyOn(documentAnnotationsApi, "createForTarget").mockResolvedValue(created);
  const createdCallback = vi.fn(); const focus = vi.fn();
  function Harness({ target }: { target: DocumentAnnotationTarget }) {
    current = useDocumentAnnotationMutations({ target, baseRevisionId: "revision", baseRevisionNumber: 1, pendingAnchor: anchor, onFocusThread: focus, onThreadCreated: createdCallback });
    return <p>{current.createThread.isPending ? "pending" : "ready"}</p>;
  }
  const render = async (target: DocumentAnnotationTarget) => { await act(async () => root.render(<QueryClientProvider client={client}><Harness target={target} /></QueryClientProvider>)); };
  const keyA = queryKeys.issues.documentAnnotations(first.issueId, first.documentKey, "all");
  const keyB = queryKeys.routines.documentAnnotations(second.routineId, second.documentKey, "all");
  client.setQueryData(keyA, []); client.setQueryData(keyB, newerCache);
  try {
    await render(first); await act(async () => current.createThread.mutate("Keep raw comment 原文"));
    await render(second); expect(host.textContent).toBe("ready");
    await act(async () => { resume(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(create).toHaveBeenCalledWith(first, expect.objectContaining({ body: "Keep raw comment 原文" }));
    expect(createdCallback).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
    expect(client.getQueryData(keyA)).toEqual([created]);
    expect(client.getQueryData(keyB)).toEqual(newerCache);
  } finally { await act(async () => root.unmount()); client.clear(); cancel.mockRestore(); create.mockRestore(); }
});
it("ignores a previous target's late mutation error", async () => {
  const host = document.createElement("div"); const root = createRoot(host); const client = new QueryClient();
  let current!: ReturnType<typeof useDocumentAnnotationMutations>; let reject!: (error: Error) => void;
  const update = vi.spyOn(documentAnnotationsApi, "updateStatusForTarget").mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  function Harness({ target }: { target: DocumentAnnotationTarget }) {
    current = useDocumentAnnotationMutations({ target, baseRevisionId: "revision", baseRevisionNumber: 1, pendingAnchor: null, onFocusThread: () => {} });
    return <p>{current.mutationError ?? "no error"}</p>;
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness target={first} /></QueryClientProvider>));
    await act(async () => current.updateStatus.mutate({ threadId: "thread", status: "resolved" }));
    await act(async () => root.render(<QueryClientProvider client={client}><Harness target={second} /></QueryClientProvider>));
    await act(async () => { reject(new Error("Original provider failure")); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.textContent).toBe("no error");
  } finally { await act(async () => root.unmount()); client.clear(); update.mockRestore(); }
});

it("never dispatches a queued annotation under a replacement real session with the same public ID", async () => {
  const root = createRoot(document.createElement("div")), client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const session = (scopeKey: string) => ({ user: { id: "owner" }, session: { id: "paperclip:session:owner", userId: "owner", scopeKey } });
  client.setQueryData(queryKeys.auth.session, session("a".repeat(64)));
  let current!: ReturnType<typeof useDocumentAnnotationMutations>, resume!: () => void;
  const cancel = vi.spyOn(client, "cancelQueries").mockReturnValueOnce(new Promise<void>(resolve => { resume = resolve; }));
  const create = vi.spyOn(documentAnnotationsApi, "createForTarget").mockResolvedValue({ id: "old" } as DocumentAnnotationThreadWithComments);
  const callback = vi.fn();
  function Host() { current = useDocumentAnnotationMutations({ target: first, baseRevisionId: "revision", baseRevisionNumber: 1, pendingAnchor: anchor, onFocusThread: callback, onThreadCreated: callback }); return null; }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>));
    await act(async () => current.createThread.mutate("private old body"));
    await act(async () => { client.setQueryData(queryKeys.auth.session, session("b".repeat(64))); resume(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(create).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.issues.documentAnnotations(first.issueId, first.documentKey, "all"))).toBeUndefined();
  } finally { await act(async () => root.unmount()); client.clear(); cancel.mockRestore(); create.mockRestore(); }
});
