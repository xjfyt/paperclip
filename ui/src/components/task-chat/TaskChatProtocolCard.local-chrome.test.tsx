// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "@/lib/router";
import { ThemeProvider } from "@/context/ThemeContext";
import { i18n, providerChromeMessages } from "@/i18n/provider-chrome-test-resources";
import { parsePaperclipRunnerStdoutLine } from "@/adapters/paperclip-runner";
import { transcriptToTaskChatItems } from "./transcript-adapter";
import { TaskChatProtocolCard } from "./TaskChatProtocolCard";
import type { TaskChatProviderActivityItem } from "./task-chat-model";
let root: Root; let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
async function render(item: TaskChatProviderActivityItem) { await act(async () => { root.render(<MemoryRouter><ThemeProvider><TaskChatProtocolCard item={item} /></ThemeProvider></MemoryRouter>); }); }
const families = [["plan", "plan"], ["tool.execution", "tool"], ["provider.notice", "notice"]] as const;
it.each(Object.entries(providerChromeMessages))("carries local family provenance through projection and coalescing in %s", async (locale, messages) => {
  await act(async () => { await i18n.changeLanguage(locale); });
  for (const [event, key] of families) {
    const entries = ["started", "completed"].flatMap((state, index) => parsePaperclipRunnerStdoutLine(JSON.stringify({ type: "paperclip.prp.event", event: { eventType: `${event}.${state}`, payload: { [event === "plan" ? "planId" : event === "tool.execution" ? "executionId" : "noticeId"]: "stable", name: "Original name Ω", summary: "Original provider summary Ω", status: state === "started" ? "running" : "completed" } } }), `2026-10-27T00:00:0${index}Z`));
    const raw = JSON.stringify(entries);
    const items = transcriptToTaskChatItems(entries, { runId: "original-run", agentName: "Original agent", running: false });
    expect(items).toHaveLength(1);
    const item = items.findLast((entry): entry is TaskChatProviderActivityItem => entry.kind === "protocol" && entry.surface === "provider_activity")!;
    expect(item).toBeDefined(); const itemRaw = JSON.stringify(item);
    await render(item); expect(host.textContent).toContain(messages[key]); expect(host.textContent).toContain("Original provider summary Ω");
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(JSON.stringify(entries)).toBe(raw); expect(JSON.stringify(item)).toBe(itemRaw);
    await act(async () => { await i18n.changeLanguage(locale); });
    // Same shape/text copied from outside the local projection has no proof.
    const copied = structuredClone(item); await render(copied);
    expect(host.textContent).toContain(item.title);
    expect(JSON.stringify(copied)).toBe(itemRaw);
  }
});
