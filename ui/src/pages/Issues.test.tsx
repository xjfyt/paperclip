// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { i18n, agentTaskQuotaMessages } from "../i18n/agent-task-quota-test-resources";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import type { Issue } from "@paperclipai/shared";
import {
  Issues,
  ISSUES_ROW_PRESENTATION,
  ISSUES_TOOLBAR_PRESENTATION,
  buildIssuesSearchUrl,
  getNextIssuesPageOffset,
  mergeIssuePagesStable,
  resolveIssuesPresentation,
} from "./Issues";

const scopeState = vi.hoisted(() => ({ streamlined: true }));
const setBreadcrumbs = vi.hoisted(() => vi.fn());
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs }) }));
vi.mock("../hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: scopeState.streamlined }) }));
vi.mock("../hooks/useCombinedInboxTasksEnabled", () => ({ useCombinedInboxTasksEnabled: () => ({ enabled: false }) }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => { vi.restoreAllMocks(); await i18n.changeLanguage("en"); });

describe.each([true, false])("localized no-company Tasks (streamlined=%s)", (streamlined) => {
  it.each(Object.entries(agentTaskQuotaMessages))("renders actual empty state in %s without scoped requests or URL changes", async (locale, copy) => {
    await i18n.changeLanguage(locale);
    scopeState.streamlined = streamlined;
    const spies = [vi.spyOn(agentsApi, "list"), vi.spyOn(issuesApi, "listCompact"), vi.spyOn(projectsApi, "list"), vi.spyOn(heartbeatsApi, "liveRunsForCompany")];
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const url = window.location.href;
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={["/issues?q=raw-query&workspace=raw-workspace"]}><QueryClientProvider client={client}><Issues /></QueryClientProvider></MemoryRouter>));
      expect(container.textContent).toContain(streamlined ? copy.selectOrganizationTasks : copy.selectCompanyTasks);
      const next = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(next); });
      expect(container.textContent).toContain(streamlined ? agentTaskQuotaMessages[next].selectOrganizationTasks : agentTaskQuotaMessages[next].selectCompanyTasks);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(window.location.href).toBe(url);
      expect(container.querySelector("button")).toBeNull();
    } finally { act(() => root.unmount()); client.clear(); container.remove(); }
  });
});

function createIssue(id: string, title: string): Issue {
  return { id, title } as Issue;
}

describe("buildIssuesSearchUrl", () => {
  it("preserves trailing spaces in the synced search param", () => {
    expect(buildIssuesSearchUrl("http://localhost:3100/issues?q=bug", "bug ")).toBe("/issues?q=bug+");
  });

  it("removes the search param when the input is cleared", () => {
    expect(buildIssuesSearchUrl("http://localhost:3100/issues?q=bug#details", "")).toBe("/issues#details");
  });

  it("returns null when the URL already matches the current search", () => {
    expect(buildIssuesSearchUrl("http://localhost:3100/issues?q=bug+", "bug ")).toBeNull();
  });
});

describe("issues page pagination helpers", () => {
  it("opts the Tasks route into the canonical shared task-row presentation", () => {
    expect(ISSUES_ROW_PRESENTATION).toBe("task");
  });

  it("opts the Tasks route into the shared collection toolbar", () => {
    expect(ISSUES_TOOLBAR_PRESENTATION).toBe("collection");
  });

  it("restores the retained legacy list and toolbar when Streamlined UI is off", () => {
    expect(resolveIssuesPresentation(false)).toEqual({
      rowPresentation: "legacy",
      toolbarPresentation: "legacy",
    });
    expect(resolveIssuesPresentation(true)).toEqual({
      rowPresentation: "task",
      toolbarPresentation: "collection",
    });
  });

  it("advances to the next offset when the current page is full", () => {
    expect(getNextIssuesPageOffset(100, 0)).toBe(100);
    expect(getNextIssuesPageOffset(100, 100)).toBe(200);
    expect(getNextIssuesPageOffset(1000, 2000, 1000)).toBe(3000);
  });

  it("stops requesting issue pages when the current page is partial", () => {
    expect(getNextIssuesPageOffset(99, 0)).toBeUndefined();
    expect(getNextIssuesPageOffset(999, 2000, 1000)).toBeUndefined();
  });

  it("dedupes overlapping pages without moving the original issue position", () => {
    const first = createIssue("issue-1", "Original first");
    const second = createIssue("issue-2", "Second");
    const duplicateFirst = createIssue("issue-1", "Duplicate first");
    const third = createIssue("issue-3", "Third");

    expect(mergeIssuePagesStable([[first, second], [duplicateFirst, third]])).toEqual([
      first,
      second,
      third,
    ]);
  });
});
