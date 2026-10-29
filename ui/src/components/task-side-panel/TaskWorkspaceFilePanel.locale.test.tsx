// @vitest-environment jsdom
import "@/i18n/document-test-resources";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { TaskWorkspaceFilePanel } from "./TaskWorkspaceFilePanel";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { TaskSidePanelTabPayload } from "@/lib/task-side-panel-state";
const mock = vi.hoisted(() => ({ company: "one", announce: null as null | ((value: string) => void) }));
vi.mock("@/context/CompanyContext", () => ({ useOptionalCompany: () => ({ selectedCompanyId: mock.company }) }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: vi.fn() }));
vi.mock("@/api/file-resources", () => ({ fileResourcesApi: { resolve: async () => ({ title: "report.md", contentType: "text/markdown", capabilities: { preview: true, download: false } }), content: async () => ({ content: { data: "Raw 原文 1234", encoding: "utf8" } }) } }));
vi.mock("@/components/FileViewerSheet", () => ({ FileViewerMetadataRow: () => null, FileViewerBody: ({ onSetAnnouncement }: { onSetAnnouncement: (value: string) => void }) => { mock.announce = onSetAnnouncement; return <p>Raw 原文 1234</p>; } }));
let root: Root; let container: HTMLDivElement; let client: QueryClient;
const payload: Extract<TaskSidePanelTabPayload, { kind: "workspace-file" }> = { kind: "workspace-file", path: "same/report.md", workspace: "auto", workspaceId: null, projectId: null, line: null, column: null };
async function render(issueId = "one") {
  await act(async () => root.render(<QueryClientProvider client={client}><TaskWorkspaceFilePanel issueId={issueId} payload={payload} /></QueryClientProvider>));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(client.isFetching()).toBe(0);
    expect(container.querySelector('button[aria-label="Copy file contents"]')).not.toBeNull();
  });
}
beforeEach(async () => { await i18n.changeLanguage("en"); mock.company = "one"; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.resetAllMocks(); });
it.each(["issue", "company"])("ignores late clipboard and announcement after changing %s with the same path", async field => {
  let resolve!: () => void; vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>(done => { resolve = done; }));
  await render(); const announce = mock.announce!;
  await act(async () => (container.querySelector('button[aria-label="Copy file contents"]') as HTMLButtonElement).click());
  if (field === "company") mock.company = "two";
  await render(field === "issue" ? "two" : "one");
  await act(async () => { resolve(); announce("Stale announcement"); });
  expect(container.textContent).not.toContain("Copied"); expect(container.textContent).not.toContain("Stale announcement");
});
it("reports rejection without unhandled errors and translates chrome without touching raw content", async () => {
  vi.mocked(copyTextToClipboard).mockRejectedValue(new Error("provider raw failure"));
  await render();
  await act(async () => (container.querySelector('button[aria-label="Copy file contents"]') as HTMLButtonElement).click());
  expect(container.textContent).toContain("Copy failed. Try again.");
  await act(async () => { await i18n.changeLanguage("es"); });
  expect(container.textContent).toContain("No se pudo copiar");
  expect(container.querySelector('button[aria-label="Copiar contenido del archivo"]')).not.toBeNull();
  expect(container.textContent).toContain("Raw 原文 1234");
});

it("ignores late clipboard and announcements after the displayed source changes", async () => {
  let resolve!: () => void; vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>(done => { resolve = done; }));
  await render(); const announce = mock.announce!;
  await act(async () => (container.querySelector('button[aria-label="Copy file contents"]') as HTMLButtonElement).click());
  const { kind: _kind, ...state } = payload;
  await act(async () => { client.setQueryData(queryKeys.issues.fileResourceContent("one", state), { content: { data: "new raw source", encoding: "utf8" } }); });
  await render();
  await act(async () => { resolve(); announce("Old source status"); });
  expect(container.textContent).not.toContain("Copied"); expect(container.textContent).not.toContain("Old source status");
});
