// @vitest-environment jsdom
import "@/i18n/document-test-resources";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue, IssueDocument } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { IssuePropertiesPlansTab } from "./IssuePropertiesPlansTab";
import { TaskDocumentPanel } from "../task-side-panel/TaskDocumentPanel";

vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));
vi.mock("@/components/IssueDocumentAnnotations", () => ({ DocumentAnnotationsCountChip: () => null, IssueDocumentAnnotations: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/IssuePlanDecompositionsSection", () => ({ IssuePlanDecompositionsSection: () => <p>history content</p> }));
vi.mock("@/lib/router", () => ({ useLocation: () => ({ hash: "" }) }));
const issue = { id: "task-1", companyId: "company-1", workMode: "standard" } as Issue;
const doc = { id: "doc-1", key: "plan", body: "Keep raw plan: 原文 1234", updatedAt: new Date(), latestRevisionNumber: 1234 } as IssueDocument;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render(element: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)); await settle(); }
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(issuesApi, "getDocument").mockResolvedValue(doc);
  vi.spyOn(issuesApi, "listAcceptedPlanDecompositions").mockResolvedValue([]);
  vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });
describe("plan read failures", () => {
  it("treats only plan document 404 as no plan", async () => {
    vi.mocked(issuesApi.getDocument).mockRejectedValue(new ApiError("missing", 404, null));
    await render(<IssuePropertiesPlansTab issue={issue} />);
    expect(container.textContent).toContain("No plan yet");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it.each([403, 404, 500])("does not report failed history %s as an empty plan", async status => {
    vi.mocked(issuesApi.getDocument).mockRejectedValue(new ApiError("missing", 404, null));
    vi.mocked(issuesApi.listAcceptedPlanDecompositions).mockRejectedValue(new ApiError("raw diagnostics", status, null));
    await render(<IssuePropertiesPlansTab issue={issue} />);
    expect(container.textContent).toContain("Plan history could not be loaded");
    expect(container.textContent).not.toContain("No plan yet");
    vi.mocked(issuesApi.listAcceptedPlanDecompositions).mockResolvedValue([]);
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click()); await settle();
    expect(container.textContent).toContain("No plan yet");
  });
  it("keeps the cached plan when refresh fails and hot-switches chrome only", async () => {
    await render(<IssuePropertiesPlansTab issue={issue} />);
    vi.mocked(issuesApi.getDocument).mockRejectedValue(new ApiError("raw diagnostics", 500, null));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) }); }); await settle();
    expect(container.textContent).toContain(doc.body);
    expect(container.textContent).toContain("The plan could not be loaded");
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(container.textContent).toContain("无法加载计划"); expect(container.textContent).toContain(doc.body);
  });
  it("keeps a cached document visible with retry after a background read failure", async () => {
    await render(<TaskDocumentPanel issueId={issue.id} documentKey="plan" initialDocument={doc} />);
    vi.mocked(issuesApi.getDocument).mockRejectedValue(new ApiError("raw diagnostics", 403, null));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) }); }); await settle();
    expect(container.textContent).toContain(doc.body);
    expect(container.textContent).toContain("The document could not be loaded");
    expect(container.querySelector('button')?.textContent).toBe("Retry");
  });
});
