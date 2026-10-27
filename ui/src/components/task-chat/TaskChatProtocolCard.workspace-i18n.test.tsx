// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/adapters";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import { i18n, taskProtocolWorkspaceMessages } from "@/i18n/task-protocol-workspace-test-resources";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { buildTurnTimelineRows, transcriptToTaskChatItems } from "./transcript-adapter";
import type { TaskChatWorkspaceChangeFile } from "./task-chat-model";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove();
  await act(async () => { await i18n.changeLanguage("en"); });
});
const operations = ["create", "modify", "delete", "rename", "mode_change"] as const;
function workspaceEntry(count: number, complete = true): Extract<TranscriptEntry, { kind: "workspace_change" }> {
  const files: TaskChatWorkspaceChangeFile[] = operations.slice(0, count).map((operation, index) => ({
    path: `src/Original ${index} Ω.ts`, operation, previousPath: operation === "rename" ? "old/Original Ω.ts" : null,
    additions: index + 1, deletions: index, binary: index === 1,
    diff: index === 2 ? null : `@@ original ${index} @@\n-raw <tag>\n+raw {{count}}`,
  }));
  return { kind: "workspace_change", ts: "2026-10-27T00:00:00Z", changeSetId: "original-change", revision: 7,
    source: "runner_verified", complete, files, totals: { files: count, additions: count ? 17 : null, deletions: count ? 5 : null },
    patchArtifactRef: "original-patch-artifact" };
}
async function render(entry: Extract<TranscriptEntry, { kind: "workspace_change" }>) {
  const items = transcriptToTaskChatItems([entry], { runId: "original-run", agentName: "Original agent", running: false });
  const rows = buildTurnTimelineRows(items, false);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "protocol", surface: "workspace_change", changeSetId: entry.changeSetId, revision: 7 });
  const onDecision = vi.fn();
  await act(async () => { root.render(<MemoryRouter><ThemeProvider><TaskChatRunnerTurn
    runId="original-run" agentName="Original agent" items={items} status="succeeded" onRuntimeRequestDecision={onDecision}
  /></ThemeProvider></MemoryRouter>); });
  return onDecision;
}
function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find(node => node.textContent === text);
  expect(found, text).toBeDefined(); return found!;
}
const copy = (key: string, options: { count?: number; stats?: string } = {}) => i18n.t(`taskProtocolWorkspaceUi.${key}`, options);

it.each(Object.entries(taskProtocolWorkspaceMessages))("localizes actual workspace rows, counts and diff recovery in %s", async (locale, messages) => {
  await act(async () => { await i18n.changeLanguage(locale); });
  for (const count of [0, 1, 4, 5]) {
    const entry = workspaceEntry(count); const original = JSON.stringify(entry);
    const onDecision = await render(entry);
    const card = host.querySelector('[data-testid="task-chat-workspace-change"]')!;
    expect(card.textContent).toContain(messages.title);
    expect(card.textContent).toContain(messages.completed);
    expect(card.textContent).toContain(copy(count ? "filesChangedWithStats" : "filesChanged", { count, stats: "+17 −5" }));
    if (count === 0) { expect(card.querySelector("button")).toBeNull(); continue; }
    if (count > 3) {
      await act(async () => { button(copy("showMore", { count: count - 3 })).click(); });
      expect(card.textContent).toContain(messages.showFewer);
    }
    for (const file of entry.files) {
      expect(card.textContent).toContain(file.path);
      expect(card.textContent).toContain(messages[`operation_${file.operation}`]);
    }
    if (count > 1) expect(card.textContent).toContain(messages.binaryOperation.replace("{{operation}}", messages.operation_modify));
    await act(async () => { button(messages.reviewDiff).click(); });
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(entry.files[0].diff);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("tag")).toBeNull();
    if (count > 1) {
      expect(dialog.querySelector(`[aria-label="${messages.changedFiles}"]`)).not.toBeNull();
      await act(async () => { button(entry.files[1].path, dialog).click(); });
      expect(dialog.textContent).toContain(messages.binaryDiffUnavailable);
      await act(async () => { button(entry.files[2].path, dialog).click(); });
      expect(dialog.textContent).toContain(messages.noInlinePatch);
    }
    const nextLocale = locale === "ja" ? "es" : "ja";
    await act(async () => { await i18n.changeLanguage(nextLocale); });
    const translated = taskProtocolWorkspaceMessages[nextLocale];
    expect(card.textContent).toContain(translated.title);
    if (count > 3) expect(card.textContent).toContain(translated.showFewer);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(entry.files[count > 1 ? 2 : 0].path);
    if (count > 1) expect(document.querySelector('[role="dialog"]')?.textContent).toContain(translated.noInlinePatch);
    expect(JSON.stringify(entry)).toBe(original);
    expect(onDecision).not.toHaveBeenCalled();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { await i18n.changeLanguage(locale); });
    if (count > 3) {
      await act(async () => { button(messages.showFewer).click(); });
      expect(card.textContent).not.toContain(entry.files[3].path);
    }
  }
  await render(workspaceEntry(0, false));
  expect(host.textContent).toContain(messages.inProgress);
  expect(host.textContent).toContain(messages.running);
});

it.each(Object.entries(taskProtocolWorkspaceMessages))("keeps complete workspace templates and numeric values in %s", (locale, messages) => {
  expect(Object.keys(messages).sort()).toEqual(Object.keys(taskProtocolWorkspaceMessages.en).sort());
  for (const count of [0, 1, 3]) {
    const text = i18n.t("taskProtocolWorkspaceUi.filesChangedWithStats", { lng: locale, count, stats: "+123 −456" });
    expect(text).toContain(String(count)); expect(text).toContain("+123 −456"); expect(text).not.toMatch(/\{\{|taskProtocolWorkspaceUi\./);
  }
});
