// @vitest-environment jsdom
import "@/i18n/artifact-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Issue, IssueDocument, IssueWorkProduct } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { artifactMessages } from "@/i18n/artifact-test-resources";
import { IssuePropertiesArtifactsTab } from "../issue-properties/IssuePropertiesArtifactsTab";
import { TaskChatPlanPreviewCard } from "../task-chat/TaskChatPlanPreviewCard";
import { IssuePlanDecompositionsSection } from "../IssuePlanDecompositionsSection";
import { queryKeys } from "@/lib/queryKeys";
import { DataCard } from "./RichArtifactCards";
const doc = { id: "document", key: "report", title: "User report 原文", body: "Exact user draft: 001234.50", latestRevisionNumber: 1234, updatedAt: new Date(), createdAt: new Date() } as IssueDocument;
const file = { id: "file", originalFilename: "Original report.txt", contentType: "text/plain", byteSize: 123456, contentPath: "/api/attachments/file/content", createdAt: new Date(), createdByAgentId: "agent" };
const workProduct = { id: "pr", type: "pull_request", title: "Provider title 原文", status: "ready_for_review", reviewState: "needs_board_review", healthStatus: "unknown", url: "https://example.com/original", metadata: { number: 1234, state: "open", checks: "passed", additions: 1234 }, updatedAt: new Date(), createdAt: new Date() } as unknown as IssueWorkProduct;
vi.mock("@/hooks/useIssueDocuments", () => ({ useIssueDocuments: () => ({ data: [doc] }) }));
vi.mock("@/hooks/useIssueWorkProducts", () => ({ useIssueWorkProducts: () => ({ data: [workProduct] }) }));
vi.mock("@/api/issues", () => ({ issuesApi: { listAttachments: async () => [file] } }));
vi.mock("@/api/activity", () => ({ activityApi: { runsForIssue: async () => [] } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("@/lib/router", () => ({ useLocation: () => ({ hash: "" }), Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a> }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));
vi.mock("@/components/IssueDocumentAnnotations", () => ({ DocumentAnnotationsCountChip: () => null, IssueDocumentAnnotations: ({ children }: { children: React.ReactNode }) => children }));
afterEach(async () => { await i18n.changeLanguage("en"); });
it("hot-switches the actual sidebar artifacts, keeping expansion, URLs, IDs and authored content", async () => {
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => { await i18n.changeLanguage("en"); root.render(<QueryClientProvider client={client}><IssuePropertiesArtifactsTab issue={{ id: "task", companyId: "company" } as Issue} /></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    await act(async () => (Array.from(container.querySelectorAll('button')).find(button => button.textContent === "Read document") as HTMLButtonElement).click());
    for (const [locale, messages] of Object.entries(artifactMessages)) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.textContent).toContain(messages.closeDocument);
      expect(container.textContent).toContain(messages.openFile);
      expect(container.textContent).toContain(messages.review);
      expect(container.textContent).toContain(doc.body);
      expect(container.textContent).toContain(workProduct.title);
      expect(container.textContent).toContain("#" + "1234"); // Provider identifier, not a localized quantity.
      expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
      expect(container.querySelector('a[href="https://example.com/original"]')).not.toBeNull();
      expect(container.textContent).toContain(new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(123456 / 1024));
    }
  } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
});
it("localizes default timeline plan chrome but leaves user text and CSV values/export exact", async () => {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<><TaskChatPlanPreviewCard source={{ kind: "saved", document: { ...doc, body: "- Original step 001234.50" } }} /><DataCard title="Raw dataset" summary="" author="" updatedAt="" filename="raw.csv" columns={["Amount"]} rows={[["001234.50"], [1234.5]]} /></>));
    for (const [locale, messages] of Object.entries(artifactMessages)) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(host.querySelector('h3')?.textContent).toBe(messages.plan);
      expect(host.textContent).toContain("Original step 001234.50");
      expect(host.querySelector('td')?.textContent).toBe("001234.50");
      expect(host.querySelectorAll('td')[1]?.textContent).toBe("1234.5");
    }
    await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === artifactMessages.ja.viewData) as HTMLButtonElement).click());
    expect(decodeURIComponent(document.querySelector('a[download="raw.csv"]')!.getAttribute("href")!)).toBe('data:text/csv;charset=utf-8,"Amount"\n"001234.50"\n"1234.5"');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("localizes the actual accepted plan history quantities without formatting revision IDs", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.issues.acceptedPlanDecompositions("task"), [{ id: "record", status: "completed", acceptedPlanRevisionNumber: 1234, acceptedPlanRevisionId: "revision-id", requestedChildCount: 1234, childIssueIds: ["child"], createdAt: new Date(), updatedAt: new Date() }]);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><IssuePlanDecompositionsSection issueId="task" issueIdentifier="RAW-1234" /></QueryClientProvider>));
    for (const [locale, messages] of Object.entries(artifactMessages)) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(host.textContent).toContain(messages.decomposition);
      expect(host.textContent).toContain(messages.completed);
      expect(host.textContent).toContain(new Intl.NumberFormat(locale).format(1234));
      expect(host.querySelector('a')?.getAttribute("href")).toBe("/issues/RAW-1234#document-plan");
    }
  } finally { await act(async () => root.unmount()); client.clear(); }
});
