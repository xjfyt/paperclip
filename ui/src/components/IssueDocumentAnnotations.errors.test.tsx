// @vitest-environment jsdom
import "@/i18n/annotation-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { annotationMessages } from "@/i18n/annotation-test-resources";
import { documentAnnotationsApi } from "@/api/document-annotations";
import { queryKeys } from "@/lib/queryKeys";
import { IssueDocumentAnnotations, DocumentAnnotationsCountChip } from "./IssueDocumentAnnotations";
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => null } }));
vi.mock("./DocumentAnnotationLayer", () => ({ DocumentAnnotationLayer: () => null }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));
const anchor = { selectedText: "Original quote", selector: { quote: { exact: "Original quote", prefix: "", suffix: "" }, position: { normalizedStart: 0, normalizedEnd: 14, markdownStart: 0, markdownEnd: 14 } } };
afterEach(async () => { vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
it("does not turn annotation read errors into zero comments and preserves the mounted draft through locale switches and retry", async () => {
  const load = vi.spyOn(documentAnnotationsApi, "list").mockResolvedValue([]);
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><DocumentAnnotationsCountChip issueId="task" docKey="plan" panelOpen onToggle={() => {}} /><IssueDocumentAnnotations issueId="task" doc={{ key: "plan", latestRevisionId: "rev", latestRevisionNumber: 1 }} bodyMarkdown="Original quote" draftDirty={false} draftConflicted={false} historicalPreview={false} locationHash="" panelOpen onPanelOpenChange={() => {}} panelPlacement="inline" initialComposerAnchor={anchor}><p>Raw document 原文</p></IssueDocumentAnnotations></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const composer = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, "Unsaved comment 原文 001234");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    load.mockRejectedValue(new Error("Original raw diagnostics"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documentAnnotations("task", "plan", "all") }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    for (const [locale, messages] of Object.entries(annotationMessages)) {
      await act(async () => { await i18n.changeLanguage(locale); });
      const alert = host.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toContain(messages.loadError);
      expect(host.querySelector('[data-testid="document-annotation-count-plan"]')?.textContent).toContain("—");
      expect(host.querySelector('textarea')).toBe(composer);
      expect(composer.value).toBe("Unsaved comment 原文 001234");
      expect(host.textContent).toContain("Raw document 原文");
    }
    load.mockResolvedValue([]);
    await act(async () => (host.querySelector('[role="alert"] button') as HTMLButtonElement).click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(composer.value).toBe("Unsaved comment 原文 001234");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
