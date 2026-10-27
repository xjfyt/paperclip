// @vitest-environment jsdom
import "../i18n/management-test-resources";

import type { ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent, AgentInstructionsBundle, AgentInstructionsFileDetail, AgentInstructionsFileSummary,
  AgentInstructionCandidate, AgentInstructionRevision, AgentInstructionHistory, AgentInstructionDiff,
} from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentFileRunNotice, PromptsTab } from "./AgentDetail";
import { queryKeys } from "../lib/queryKeys";
import { TooltipProvider } from "../components/ui/tooltip";
import { i18n } from "../i18n";
import { ManagementUiError } from "../i18n/management-errors";
import { validateLocaleMessages } from "../i18n/locale-validation";
import instructionEn from "../i18n/contributions/agentInstructionEditorUi/en.json";
import instructionZh from "../i18n/contributions/agentInstructionEditorUi/zh-CN.json";
import instructionEs from "../i18n/contributions/agentInstructionEditorUi/es.json";
import instructionJa from "../i18n/contributions/agentInstructionEditorUi/ja.json";

// Runtime locale generation remains owned by integration; this composes only test resources.
const locales = ["en", "zh-CN", "es", "ja"] as const;
const instructionMessages = { en: instructionEn, "zh-CN": instructionZh, es: instructionEs, ja: instructionJa };
for (const locale of locales) {
  i18n.addResourceBundle(locale, "translation", { agentInstructionEditorUi: instructionMessages[locale] }, true, true);
}

const mockAgentsApi = vi.hoisted(() => ({
  instructionsBundle: vi.fn(),
  instructionsFile: vi.fn(),
  updateInstructionsBundle: vi.fn(),
  saveInstructionsFile: vi.fn(),
  deleteInstructionsFile: vi.fn(),
  instructionHistory: vi.fn(),
  instructionCandidates: vi.fn(),
  resolveInstructionCandidate: vi.fn(),
  instructionDiff: vi.fn(),
  restoreInstructions: vi.fn(),
}));

const markdownEditorRenderMock = vi.hoisted(() => vi.fn());
const copyTextToClipboardMock = vi.hoisted(() => vi.fn(async (_text: string) => {}));

vi.mock("../lib/clipboard", () => ({ copyTextToClipboard: copyTextToClipboardMock }));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/assets", () => ({
  assetsApi: {
    uploadImage: vi.fn(async () => ({ contentPath: "/assets/uploaded-image.png" })),
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("@/adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => () => ({
    supportsInstructionsBundle: true,
    supportsSkills: true,
    supportsLocalAgentJwt: true,
    requiresMaterializedRuntimeSkills: false,
  }),
}));

vi.mock("../components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
    contentClassName,
    imageUploadHandler,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    contentClassName?: string;
    imageUploadHandler?: (file: File) => Promise<string>;
  }) => {
    markdownEditorRenderMock({
      value,
      onChange,
      contentClassName,
      hasImageUploadHandler: Boolean(imageUploadHandler),
    });
    return (
      <textarea
        data-testid="markdown-editor"
        aria-label="Markdown editor"
        className={contentClassName}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
}));

vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div data-testid="markdown-body">{children}</div>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor<T>(assertion: () => T): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await flushReact();
    }
  }
  throw lastError;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Codex Coder",
    urlKey: "codexcoder",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeSummary(
  path: string,
  entryFile: string,
  overrides: Partial<AgentInstructionsFileSummary> = {},
): AgentInstructionsFileSummary {
  const markdown = path.toLowerCase().endsWith(".md");
  return {
    path,
    size: 24,
    language: markdown ? "markdown" : "text",
    markdown,
    isEntryFile: path === entryFile,
    editable: true,
    deprecated: false,
    virtual: false,
    ...overrides,
  };
}

function makeDetail(
  summary: AgentInstructionsFileSummary,
  content = "# Agent instructions",
  overrides: Partial<AgentInstructionsFileDetail> = {},
): AgentInstructionsFileDetail {
  return {
    ...summary,
    content,
    ...overrides,
  };
}

function makeBundle(
  entryFile: string,
  files: AgentInstructionsFileSummary[],
  overrides: Partial<AgentInstructionsBundle> = {},
): AgentInstructionsBundle {
  return {
    agentId: "agent-1",
    companyId: "company-1",
    mode: "managed",
    rootPath: "/paperclip/agents/agent-1/instructions",
    managedRootPath: "/paperclip/agents/agent-1/instructions",
    entryFile,
    resolvedEntryPath: `/paperclip/agents/agent-1/instructions/${entryFile}`,
    editable: true,
    warnings: [],
    legacyPromptTemplateActive: false,
    legacyBootstrapPromptTemplateActive: false,
    files,
    ...overrides,
  };
}

function makeRevision(id: string, entryFile: string): AgentInstructionRevision {
  return {
    id, companyId: "company-1", agentId: "agent-1", entryFile,
    contentHash: "revision-hash", byteLength: 24, parentRevisionId: null,
    baseRevisionId: null, restoredFromRevisionId: null, actorAgentId: null,
    actorUserId: "user-1", responsibleUserId: "user-1", sourceRunId: null,
    source: "board", createdAt: "2026-01-01T00:00:00Z",
  };
}

function makeCandidate(overrides: Partial<AgentInstructionCandidate> = {}): AgentInstructionCandidate {
  return {
    contract: "legacy", runId: "preserved-run", entryFile: "AGENTS.md",
    baseRevisionId: "older-base", baseHash: "base-hash", state: "conflict",
    candidateHash: "candidate-hash", content: "preserved edit", errorCode: null,
    errorMessage: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PromptsTab instruction editor", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient;
  let saveAction: (() => void) | null;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    saveAction = null;
    markdownEditorRenderMock.mockClear();
    Object.values(mockAgentsApi).forEach((mock) => mock.mockReset());
    mockAgentsApi.instructionCandidates.mockResolvedValue([]);
    mockAgentsApi.updateInstructionsBundle.mockResolvedValue({});
    mockAgentsApi.saveInstructionsFile.mockImplementation(async (_agentId, data) => ({
      path: data.path,
      size: data.content.length,
      language: "markdown",
      markdown: true,
      isEntryFile: true,
      editable: true,
      deprecated: false,
      virtual: false,
      content: data.content,
    }));
    mockAgentsApi.deleteInstructionsFile.mockResolvedValue({});
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  async function renderPromptsTab(
    bundle: AgentInstructionsBundle,
    details: Record<string, AgentInstructionsFileDetail>,
    props: Partial<ComponentProps<typeof PromptsTab>> = {},
  ) {
    mockAgentsApi.instructionsBundle.mockResolvedValue(bundle);
    mockAgentsApi.instructionsFile.mockImplementation(async (_agentId: string, path: string) => {
      const detail = details[path];
      if (!detail) throw new Error(`Missing detail for ${path}`);
      return detail;
    });

    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <PromptsTab
              agent={props.agent ?? makeAgent()}
              companyId={props.companyId ?? "company-1"}
              onDirtyChange={props.onDirtyChange ?? vi.fn()}
              onSaveActionChange={props.onSaveActionChange ?? ((next) => { saveAction = next; })}
              onCancelActionChange={props.onCancelActionChange ?? vi.fn()}
              onSavingChange={props.onSavingChange ?? vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  async function selectInstructionMode(mode: "Read" | "Edit" | "Raw") {
    await act(async () => {
      buttonByText(container, i18n.t(`agentInstructionEditorUi.view.${mode.toLowerCase()}`)).click();
    });
    await flushReact();
  }

  it.each(locales)("validates instruction-editor message shapes and placeholders in %s", (locale) => {
    expect(validateLocaleMessages(instructionMessages[locale], instructionMessages.en)).toEqual([]);
  });

  it.each(locales)("localizes metadata without translating file paths, language IDs or contents in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    const language = "custom-<code>&language";
    const summary = makeSummary("AGENTS.md", "AGENTS.md", { language });
    const legacy = makeSummary("legacy.md", "AGENTS.md", { deprecated: true, virtual: true });
    await renderPromptsTab(makeBundle("AGENTS.md", [summary, legacy], { rootPath: null, managedRootPath: "" }), {
      "AGENTS.md": makeDetail(summary, "# Literal instructions 保持そのまま"),
      "legacy.md": makeDetail(legacy, "Legacy prompt content stays verbatim"),
    });
    await waitFor(() => expect(container.textContent).toContain(i18n.t("agentInstructionEditorUi.languageFile", { language })));
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector('[data-file-tree-path="AGENTS.md"]')?.textContent).toContain(instructionMessages[locale].entryBadge);
    expect(container.querySelector('[data-testid="markdown-body"]')?.textContent).toBe("# Literal instructions 保持そのまま");
    await act(async () => { buttonByText(container, i18n.t("workflow.advanced")).click(); });
    expect(container.textContent).toContain(instructionMessages[locale].managedPathFallback);
    for (const label of Object.values(instructionMessages[locale].view)) expect(buttonByText(container, label)).toBeDefined();
    const copy = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.getAttribute("aria-label") === instructionMessages[locale].copyInstructionsLabel)!;
    await act(async () => { copy.click(); });
    expect(copyTextToClipboardMock).toHaveBeenCalledWith("# Literal instructions 保持そのまま");
    await selectInstructionMode("Edit");
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]')?.placeholder).toBe(instructionMessages[locale].editorPlaceholder);
    expect(saveAction).toBeNull();
    await act(async () => { container.querySelector<HTMLElement>('[data-file-tree-path="legacy.md"]')!.click(); });
    await waitFor(() => expect(container.textContent).toContain(instructionMessages[locale].deprecatedVirtualFile));
    await waitFor(() => expect(container.querySelector('[data-testid="markdown-body"]')?.textContent).toBe("Legacy prompt content stays verbatim"));
    await act(async () => { buttonByText(container, "+").click(); });
    const newPath = "新增-新規.md";
    await act(async () => {
      setNativeValue(container.querySelector<HTMLInputElement>('input[placeholder="TOOLS.md"]')!, newPath);
    });
    await act(async () => { buttonByText(container, i18n.t("commonUi.create")).click(); });
    expect(container.textContent).toContain(instructionMessages[locale].newFile);
    expect(container.querySelectorAll("h4")[1]?.textContent).toBe(newPath);
    expect(mockAgentsApi.instructionsFile).not.toHaveBeenCalledWith("agent-1", newPath, "company-1");
    expect(mockAgentsApi.saveInstructionsFile).not.toHaveBeenCalled();
    expect(mockAgentsApi.updateInstructionsBundle).not.toHaveBeenCalled();
  });

  it.each(locales)("localizes delete confirmation while preserving explicit consent and the path in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    const entry = makeSummary("AGENTS.md", "AGENTS.md");
    const path = "原稿-<literal>&.txt";
    const other = makeSummary(path, "AGENTS.md", { contentHash: "delete-base-hash" });
    await renderPromptsTab(makeBundle("AGENTS.md", [entry, other]), {
      "AGENTS.md": makeDetail(entry), [path]: makeDetail(other, "Exact original file"),
    });
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLElement>("[data-file-tree-path]"))
        .find(row => row.dataset.fileTreePath === path)!.click();
    });
    await waitFor(() => expect(container.textContent).toContain("Exact original file"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await act(async () => { buttonByText(container, i18n.t("commonUi.delete")).click(); });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(i18n.t("agentInstructionEditorUi.confirmDelete", { path }));
      expect(mockAgentsApi.deleteInstructionsFile).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      await act(async () => { buttonByText(container, i18n.t("commonUi.delete")).click(); });
      await waitFor(() => expect(mockAgentsApi.deleteInstructionsFile).toHaveBeenCalledExactlyOnceWith("agent-1", path, "company-1", "delete-base-hash"));
    } finally {
      confirm.mockRestore();
    }
  });

  // MarkdownEditor is a textarea mock here: this proves PromptsTab keeps its mounted
  // editor, draft and composition-event state. Real MDXEditor/browser IME behavior
  // still needs the manual Chinese/Japanese composition + locale-switch check.
  it.each([true, false])("keeps composition drafts and pinned save metadata across all locales (Markdown=%s)", async (markdown) => {
    const path = "指示-<draft>&.md";
    const rootPath = "/private/原始/agent-instructions";
    const summary = makeSummary(path, path, { markdown, contentHash: "original-content-hash" });
    const revision = makeRevision("original-revision-id", path);
    const onDirtyChange = vi.fn();
    await renderPromptsTab(makeBundle(path, [summary], { persistence: "agent_files", rootPath, managedRootPath: rootPath }), {
      [path]: makeDetail(summary, "# Original instructions", { revision }),
    }, { onDirtyChange });
    await waitFor(() => expect(container.textContent).toContain("# Original instructions"));
    await act(async () => { buttonByText(container, i18n.t("workflow.advanced")).click(); });
    await selectInstructionMode("Edit");
    const editor = container.querySelector<HTMLTextAreaElement>(markdown ? '[data-testid="markdown-editor"]' : "textarea")!;
    const content = "# 未保存的中文草稿\n日本語の編集中 <strong>literal</strong>\n";
    editor.focus();
    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
      editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      setNativeValue(editor, content);
      editor.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "中文 日本語" }));
    });
    editor.setSelectionRange(3, 9);
    await waitFor(() => expect(saveAction).toEqual(expect.any(Function)));
    const reads = {
      bundle: mockAgentsApi.instructionsBundle.mock.calls.length,
      file: mockAgentsApi.instructionsFile.mock.calls.length,
      candidates: mockAgentsApi.instructionCandidates.mock.calls.length,
    };
    await act(async () => {
      queryClient.setQueryData(queryKeys.agents.instructionsFile("agent-1", path), makeDetail(summary, "Newer server text", {
        contentHash: "newer-content-hash", revision: { ...revision, id: "newer-revision-id" },
      }));
    });
    for (const locale of locales) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.querySelector("textarea")).toBe(editor);
      expect(document.activeElement).toBe(editor);
      expect(editor.value).toBe(content);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 9]);
      expect(editor.placeholder).toBe(markdown ? instructionMessages[locale].editorPlaceholder : i18n.t("workflow.fileContents"));
      expect(container.textContent).toContain(rootPath);
      expect(container.querySelectorAll("h4")[1]?.textContent).toBe(path);
      expect(container.querySelector("input")?.value).toBe(path);
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(mockAgentsApi.instructionsBundle).toHaveBeenCalledTimes(reads.bundle);
      expect(mockAgentsApi.instructionsFile).toHaveBeenCalledTimes(reads.file);
      expect(mockAgentsApi.instructionCandidates).toHaveBeenCalledTimes(reads.candidates);
      expect(mockAgentsApi.saveInstructionsFile).not.toHaveBeenCalled();
      expect(mockAgentsApi.resolveInstructionCandidate).not.toHaveBeenCalled();
      expect(mockAgentsApi.updateInstructionsBundle).not.toHaveBeenCalled();
    }
    await act(async () => { editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文 日本語" })); });
    await act(async () => { saveAction?.(); });
    await waitFor(() => expect(mockAgentsApi.saveInstructionsFile).toHaveBeenCalledExactlyOnceWith("agent-1", {
      path, content, baseHash: "original-content-hash", baseRevisionId: "original-revision-id", clearLegacyPromptTemplate: false,
    }, "company-1"));
  });

  it.each(locales)("renders local error keys live while preserving opaque server errors in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const key = "agentInstructionEditorUi.editsNotRetrieved";
    mockAgentsApi.instructionCandidates.mockRejectedValue(new ManagementUiError(key));
    await renderPromptsTab(makeBundle("AGENTS.md", [summary]), { "AGENTS.md": makeDetail(summary) });
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain(instructionMessages[locale].editsNotRetrieved));
    const reads = mockAgentsApi.instructionCandidates.mock.calls.length;
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(i18n.t(key));
    expect(mockAgentsApi.instructionCandidates).toHaveBeenCalledTimes(reads);
    // Even an English error identical to a known local fallback, or a key-looking
    // server string, must stay literal: error class, not text, selects localization.
    for (const rawError of [instructionEn.editsNotRetrieved, key, "Remote diagnostic <strong>原文</strong>"]) {
      mockAgentsApi.instructionCandidates.mockRejectedValue(new Error(rawError));
      await act(async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.agents.instructionCandidates("agent-1") }); });
      await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe(`${rawError} ${i18n.t("workflowHelp.preservedAvailable")}`));
      expect(container.querySelector('[role="alert"] strong')).toBeNull();
    }
    expect(saveAction).toBeNull();
    expect(mockAgentsApi.saveInstructionsFile).not.toHaveBeenCalled();
  });

  it("uses server markdown metadata for extensionless files and saves MarkdownEditor drafts", async () => {
    const summary = makeSummary("AGENTS", "AGENTS", {
      language: "markdown",
      markdown: true,
    });
    await renderPromptsTab(
      makeBundle("AGENTS", [summary]),
      { AGENTS: makeDetail(summary, "# Current") },
    );

    await waitFor(() => {
      expect(container.querySelector('[data-testid="markdown-body"]')?.textContent).toBe("# Current");
    });
    await selectInstructionMode("Raw");
    expect(container.querySelector('[data-testid="instructions-raw-source"]')?.textContent?.trim()).toBe("# Current");
    await selectInstructionMode("Edit");

    const editor = await waitFor(() => {
      const candidate = container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]');
      expect(candidate).not.toBeNull();
      return candidate!;
    });
    expect(markdownEditorRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
      contentClassName: expect.not.stringContaining("font-mono"),
      hasImageUploadHandler: true,
      value: "# Current",
    }));

    await act(async () => {
      editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      setNativeValue(editor, "# Updated");
    });
    await waitFor(() => {
      expect(saveAction).toEqual(expect.any(Function));
    });

    saveAction?.();
    await waitFor(() => {
      expect(mockAgentsApi.saveInstructionsFile).toHaveBeenCalledWith(
        "agent-1",
        {
          path: "AGENTS",
          content: "# Updated",
          baseRevisionId: null,
          clearLegacyPromptTemplate: false,
        },
        "company-1",
      );
    });
  });

  it("loads preserved edits against the displayed head and retains their pinned base after a conflict", async () => {
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const revision = makeRevision("head-1", "AGENTS.md");
    mockAgentsApi.instructionCandidates.mockResolvedValue([makeCandidate({ runId: "preserved-run", entryFile: "AGENTS.md", baseRevisionId: "older-base", baseHash: "base-hash", state: "conflict", candidateHash: "candidate-hash", content: "preserved edit", errorCode: "INSTRUCTION_REVISION_CONFLICT", errorMessage: "Instructions changed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })]);
    await renderPromptsTab(makeBundle("AGENTS.md", [summary]), { "AGENTS.md": makeDetail(summary, "current content", { revision }) });
    await waitFor(() => expect(buttonByText(container, "Review preserved edits")).toBeDefined());
    await act(async () => { buttonByText(container, "Review preserved edits").click(); });
    const editor = await waitFor(() => {
      const element = container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]');
      expect(element?.value).toBe("preserved edit"); return element!;
    });
    mockAgentsApi.resolveInstructionCandidate.mockRejectedValue(new Error("Instructions changed since the base revision"));
    await waitFor(() => expect(saveAction).toEqual(expect.any(Function)));
    await act(async () => { saveAction?.(); });
    await waitFor(() => expect(mockAgentsApi.resolveInstructionCandidate).toHaveBeenCalledWith("agent-1", "preserved-run", { content: "preserved edit", baseRevisionId: "head-1" }, "company-1"));
    expect(mockAgentsApi.saveInstructionsFile).not.toHaveBeenCalled();
    expect(editor.value).toBe("preserved edit");
    await act(async () => { queryClient.setQueryData(["agents", "instructions-bundle", "agent-1", "file", "AGENTS.md"], makeDetail(summary, "newer content", { revision: { ...revision, id: "head-2" } })); });
    await act(async () => { saveAction?.(); });
    await waitFor(() => expect(mockAgentsApi.resolveInstructionCandidate).toHaveBeenCalledTimes(2));
    expect(mockAgentsApi.resolveInstructionCandidate.mock.lastCall?.[2].baseRevisionId).toBe("head-1");
    expect(editor.value).toBe("preserved edit");
    mockAgentsApi.instructionsFile.mockResolvedValue(makeDetail(summary, "latest content", { revision: { ...revision, id: "head-3" } }));
    await waitFor(() => expect(buttonByText(container, "Refresh current revision").disabled).toBe(false));
    await act(async () => { buttonByText(container, "Refresh current revision").click(); });
    await waitFor(() => expect(container.textContent).toContain("latest content"));
    expect(editor.value).toBe("preserved edit");
    expect(mockAgentsApi.resolveInstructionCandidate).toHaveBeenCalledTimes(2);
    await act(async () => { saveAction?.(); });
    await waitFor(() => expect(mockAgentsApi.resolveInstructionCandidate).toHaveBeenCalledTimes(3));
    expect(mockAgentsApi.resolveInstructionCandidate.mock.lastCall?.[2].baseRevisionId).toBe("head-3");
  });

  it("keeps historical whole-folder failures out of the current editor while preserving legacy review", async () => {
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const failures = [1, 2, 3].map(attempt => makeCandidate({ contract: "agent_files", runId: `failed-auth-${attempt}`,
      entryFile: "AGENTS.md", state: "unavailable", content: null,
      errorMessage: "The registered instruction copy could not be retrieved safely before environment release. No instruction save is claimed." }));
    mockAgentsApi.instructionCandidates.mockResolvedValue(failures);
    await renderPromptsTab(makeBundle("AGENTS.md", [summary], { persistence: "agent_files" }), {
      "AGENTS.md": makeDetail(summary, "Successfully saved agent instructions"),
    });
    await waitFor(() => expect(container.textContent).toContain("Successfully saved agent instructions"));
    expect(container.textContent).not.toContain("could not be retrieved");
    expect(container.textContent).not.toContain("Preserved instruction edits");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      queryClient.setQueryData(queryKeys.agents.instructionCandidates("agent-1"), [...failures, makeCandidate({
        contract: "legacy", runId: "preserved-run", entryFile: "AGENTS.md", state: "conflict",
        content: "Legacy edits to review", createdAt: "2026-01-01T00:00:00Z",
      })]);
    });
    await waitFor(() => expect(buttonByText(container, "Review preserved edits").disabled).toBe(false));
    expect(container.textContent).toContain("Preserved instruction edits");
    expect(container.textContent).not.toContain("could not be retrieved");
  });

  it("scopes sync warnings to the affected run and displays a storage warning only once", async () => {
    root = createRoot(container);
    const render = async (instructionSave: Record<string, unknown>) => act(async () => {
      root?.render(<AgentFileRunNotice resultJson={{ instructionSave }} />);
    });
    await render({ contract: "agent_files", state: "unavailable", errorMessage: "This run's files were not saved." });
    expect(container.textContent).toContain("Agent file sync failed for this run");
    expect(container.textContent).toContain("This run's files were not saved.");
    await render({ contract: "agent_files", state: "unavailable", errorCode: "AGENT_FILES_LIMIT_EXCEEDED", errorMessage: "Save rejected", storageWarning: "Agent storage is full. Runs can continue." });
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
    expect(container.textContent).toContain("Runs can continue");
    expect(container.textContent).not.toContain("Save rejected");
    await render({ contract: "agent_files", state: "unavailable", errorCode: "AGENT_FILES_SAVE_FAILED", errorMessage: "An I/O failure prevented saving this run's files.", storageWarning: "Agent storage is full. Runs can continue." });
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(2);
    expect(container.textContent).toContain("Runs can continue");
    expect(container.textContent).toContain("An I/O failure prevented saving this run's files.");
    await render({ contract: "agent_files", state: "saved" });
    expect(container.textContent).toBe("");
    await render({ state: "conflict", errorMessage: "Legacy candidate needs review" });
    expect(container.textContent).toBe("");
  });

  it.each(locales)("keeps changed-entry preserved edits readable and copyable without enabling a save in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    const summary = makeSummary("CURRENT.md", "CURRENT.md");
    const revision = makeRevision("current-head", "CURRENT.md");
    const preserved = "# Original entry\n保留这些精确修改。日本語の下書き。 <strong>literal</strong>\n";
    mockAgentsApi.instructionCandidates.mockResolvedValue([makeCandidate({ runId: "old-entry-run", entryFile: "OLD.md", baseRevisionId: "old-head", baseHash: "base-hash", state: "conflict", candidateHash: "candidate-hash", content: preserved, errorCode: "INSTRUCTION_ENTRY_CHANGED", errorMessage: "The instruction entry changed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })]);
    await renderPromptsTab(makeBundle("CURRENT.md", [summary]), { "CURRENT.md": makeDetail(summary, "Current instructions", { revision }) });
    await waitFor(() => expect(buttonByText(container, i18n.t("workflowHelp.reviewPreserved")).disabled).toBe(false));
    await act(async () => { buttonByText(container, i18n.t("workflowHelp.reviewPreserved")).click(); });
    const review = await waitFor(() => {
      const region = container.querySelector<HTMLElement>('[role="region"]');
      expect(region?.getAttribute("aria-label")).toBe(i18n.t("agentInstructionEditorUi.preservedRegionLabel", { path: "OLD.md" }));
      expect(region?.querySelector("pre")?.textContent).toBe(preserved);
      return region!;
    });
    expect(review.textContent).toContain(i18n.t("agentInstructionEditorUi.preservedReadOnly", { originalPath: "OLD.md", currentPath: "CURRENT.md" }));
    expect(review.querySelector("strong")).toBeNull();
    expect(review.textContent).toContain("CURRENT.md");
    expect(review.querySelector("textarea, input, [contenteditable=true]")).toBeNull();
    expect(saveAction).toBeNull();
    expect(mockAgentsApi.instructionsFile.mock.calls.every((call) => call[1] === "CURRENT.md")).toBe(true);
    const copyButton = review.querySelector<HTMLButtonElement>("button")!;
    expect(copyButton.getAttribute("aria-label")).toBe(i18n.t("agentInstructionEditorUi.copyPreservedLabel", { path: "OLD.md" }));
    const requestsBeforeSwitch = mockAgentsApi.instructionsFile.mock.calls.length;
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(container.querySelector('[role="region"]')).toBe(review);
    expect(review.getAttribute("aria-label")).toBe(i18n.t("agentInstructionEditorUi.preservedRegionLabel", { path: "OLD.md" }));
    expect(review.textContent).toContain(i18n.t("agentInstructionEditorUi.preservedReadOnly", { originalPath: "OLD.md", currentPath: "CURRENT.md" }));
    expect(copyButton.getAttribute("aria-label")).toBe(i18n.t("agentInstructionEditorUi.copyPreservedLabel", { path: "OLD.md" }));
    expect(review.querySelector("pre")?.textContent).toBe(preserved);
    expect(mockAgentsApi.instructionsFile).toHaveBeenCalledTimes(requestsBeforeSwitch);
    await act(async () => { copyButton.click(); });
    await waitFor(() => expect(review.textContent).toContain(i18n.t("agentInstructionEditorUi.copied")));
    expect(copyTextToClipboardMock).toHaveBeenCalledWith(preserved);
    expect(saveAction).toBeNull();
    expect(mockAgentsApi.resolveInstructionCandidate).not.toHaveBeenCalled();
    expect(mockAgentsApi.saveInstructionsFile).not.toHaveBeenCalled();

    // Choosing to edit and paste into the current entry is a separate ordinary save.
    await selectInstructionMode("Edit");
    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]')!;
    expect(editor.value).toBe("Current instructions");
    await act(async () => { editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); setNativeValue(editor, preserved); });
    await waitFor(() => expect(saveAction).toEqual(expect.any(Function)));
    await act(async () => { saveAction?.(); });
    await waitFor(() => expect(mockAgentsApi.saveInstructionsFile).toHaveBeenCalledWith("agent-1", { path: "CURRENT.md", content: preserved, baseRevisionId: "current-head", clearLegacyPromptTemplate: false }, "company-1"));
    expect(mockAgentsApi.resolveInstructionCandidate).not.toHaveBeenCalled();
  });

  it("retains the draft and its base when a concurrent save conflicts", async () => {
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const revision = makeRevision("base-1", "AGENTS.md");
    await renderPromptsTab(makeBundle("AGENTS.md", [summary]), { "AGENTS.md": makeDetail(summary, "original", { revision }) });
    mockAgentsApi.saveInstructionsFile.mockRejectedValue(new Error("Instructions changed since the base revision"));
    await selectInstructionMode("Edit");
    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]')!;
    await act(async () => { editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); setNativeValue(editor, "my unsaved edit"); });
    await waitFor(() => expect(saveAction).toEqual(expect.any(Function)));
    await act(async () => { saveAction?.(); });
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("base revision"));
    expect(editor.value).toBe("my unsaved edit");
    expect(mockAgentsApi.saveInstructionsFile).toHaveBeenCalledWith("agent-1", expect.objectContaining({ content: "my unsaved edit", baseRevisionId: "base-1" }), "company-1");
  });

  it("shows revision content and restores against the displayed current head", async () => {
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const revision = makeRevision("current-1", "AGENTS.md");
    const oldRevision = makeRevision("old-revision", "AGENTS.md");
    mockAgentsApi.instructionHistory.mockResolvedValue({ revisions: [oldRevision], nextCursor: null } satisfies AgentInstructionHistory);
    mockAgentsApi.instructionDiff.mockResolvedValue({
      from: { revision: oldRevision, content: "old text" }, to: { revision, content: "new text" },
      prefix: "", removed: "old", added: "new", suffix: " text",
    } satisfies AgentInstructionDiff);
    mockAgentsApi.restoreInstructions.mockResolvedValue(makeDetail(summary, "old text", { revision: { ...revision, id: "restored-1" } }));
    await renderPromptsTab(makeBundle("AGENTS.md", [summary]), { "AGENTS.md": makeDetail(summary, "new text", { revision }) });
    await waitFor(() => expect(buttonByText(container, "History")).toBeDefined());
    await act(async () => { buttonByText(container, "History").click(); });
    await waitFor(() => expect(buttonByText(container, "old-revi")).toBeDefined());
    await act(async () => { buttonByText(container, "old-revi").click(); });
    await waitFor(() => expect(container.textContent).toContain("old text"));
    await act(async () => { buttonByText(container, "Restore as new revision").click(); });
    await waitFor(() => expect(mockAgentsApi.restoreInstructions).toHaveBeenCalledWith("agent-1", { path: "AGENTS.md", revisionId: "old-revision", baseRevisionId: "current-1" }, "company-1"));
  });

  it("ignores rich-editor mount normalization until the user interacts", async () => {
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const onDirtyChange = vi.fn();
    await renderPromptsTab(
      makeBundle("AGENTS.md", [summary]),
      { "AGENTS.md": makeDetail(summary, "# Current") },
      { onDirtyChange },
    );
    await selectInstructionMode("Edit");

    const editorProps = await waitFor(() => {
      const latest = markdownEditorRenderMock.mock.calls.at(-1)?.[0] as
        | { onChange?: (value: string) => void }
        | undefined;
      expect(latest?.onChange).toEqual(expect.any(Function));
      return latest!;
    });

    await act(async () => {
      editorProps.onChange?.("# Current\n");
    });
    await flushReact();

    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    expect(saveAction).toBeNull();
    expect(mockAgentsApi.saveInstructionsFile).not.toHaveBeenCalled();
  });

  it("releases dirty state and save controls when the instructions tab unmounts", async () => {
    const summary = makeSummary("AGENTS.md", "AGENTS.md");
    const onDirtyChange = vi.fn();
    const onSavingChange = vi.fn();
    let cancelAction: (() => void) | null = null;
    await renderPromptsTab(
      makeBundle("AGENTS.md", [summary]),
      { "AGENTS.md": makeDetail(summary, "# Current") },
      {
        onDirtyChange,
        onSavingChange,
        onSaveActionChange: (next) => { saveAction = next; },
        onCancelActionChange: (next) => { cancelAction = next; },
      },
    );
    await selectInstructionMode("Edit");

    const editor = await waitFor(() => {
      const candidate = container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]');
      expect(candidate).not.toBeNull();
      return candidate!;
    });
    await act(async () => {
      editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      setNativeValue(editor, "# Updated");
    });
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(saveAction).toEqual(expect.any(Function));
      expect(cancelAction).toEqual(expect.any(Function));
    });

    await act(async () => {
      root?.unmount();
    });
    root = null;

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
    expect(saveAction).toBeNull();
    expect(cancelAction).toBeNull();
  });

  it("uses the Markdown editor for pending new .md files before server metadata exists", async () => {
    const summary = makeSummary("settings.json", "settings.json", {
      language: "json",
      markdown: false,
    });
    await renderPromptsTab(
      makeBundle("settings.json", [summary]),
      { "settings.json": makeDetail(summary, "{\n  \"ok\": true\n}") },
    );

    await selectInstructionMode("Edit");
    await waitFor(() => {
      expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder="File contents"]')).not.toBeNull();
    });

    await act(async () => {
      buttonByText(container, "+").click();
    });
    await flushReact();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="TOOLS.md"]');
    expect(input).not.toBeNull();

    await act(async () => {
      setNativeValue(input!, "notes.md");
      buttonByText(container, "Create").click();
    });

    await selectInstructionMode("Edit");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="markdown-editor"]')).not.toBeNull();
    });
    expect(mockAgentsApi.instructionsFile).not.toHaveBeenCalledWith("agent-1", "notes.md", "company-1");
  });

  it("falls back to extension detection for existing .md files when metadata is missing", async () => {
    const summary = makeSummary("FALLBACK.md", "FALLBACK.md", {
      language: "text",
      markdown: undefined,
    });
    await renderPromptsTab(
      makeBundle("FALLBACK.md", [summary]),
      { "FALLBACK.md": makeDetail(summary, "# Fallback", { markdown: undefined }) },
    );

    await selectInstructionMode("Edit");
    await waitFor(() => {
      expect(container.querySelector("[data-testid=\"markdown-editor\"]")).not.toBeNull();
      expect(markdownEditorRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
        value: "# Fallback",
      }));
    });
  });

  it("keeps the raw textarea when server metadata marks an .md file as non-Markdown", async () => {
    const summary = makeSummary("NOTES.md", "NOTES.md", {
      language: "text",
      markdown: false,
    });
    await renderPromptsTab(
      makeBundle("NOTES.md", [summary]),
      { "NOTES.md": makeDetail(summary, "raw instructions") },
    );

    await selectInstructionMode("Edit");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="markdown-editor"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder="File contents"]')?.value).toBe("raw instructions");
    });
  });
});
