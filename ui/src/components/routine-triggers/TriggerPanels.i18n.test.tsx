// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, formatDate } from "@/i18n";
import { ManagementUiError } from "@/i18n/management-errors";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { agentSetupPromptMessages, routineTriggerPanelMessages } from "@/i18n/routine-trigger-panels-test-resources";
import { AgentSetupPrompt } from "../AgentSetupPrompt";
import { RoutineTriggerCard } from "./TriggerCard";
import { CopyField } from "./WebhookFields";
import { WebhookUrlWarning } from "./WebhookUrlWarning";
import { defaultTriggerDraft, describeSchedule, RoutineTriggerWizard, webhookAgentInstructions, type TriggerDraft } from "./TriggerWizard";

const { copy, setBreadcrumbs } = vi.hoisted(() => ({ copy: vi.fn(), setBreadcrumbs: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: copy }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false, setSidebarOpen: () => {} }) }));
vi.mock("@/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));
let root: Root;
let container: HTMLDivElement;
const locales = ["en", "zh-CN", "es", "ja"] as const;
const rawUrl = "https://paperclip.example/api/routine-triggers/public/raw-ID/fire?fixture=KEEP";
const rawSecret = "秘密/secret +日本語<&>==";
const rawTitle = "客户例行任务 / Customer workflow";
const noop = () => {};
const key = (name: string) => i18n.t(`routineTriggerPanelsUi.${name}`);
const promptKey = (name: string) => i18n.t(`agentSetupPromptUi.${name}`);
function button(label: string) {
  const result = [...document.querySelectorAll("button")].find(el => el.textContent === label || el.getAttribute("aria-label") === label);
  expect(result, `button ${label}`).toBeDefined();
  return result!;
}
async function locale(language: string) { await act(async () => { await i18n.changeLanguage(language); }); }
async function renderDraft(draft: Partial<TriggerDraft>, props: Partial<ComponentProps<typeof RoutineTriggerWizard>> = {}, renderKey = "wizard") {
  await act(async () => root.render(<RoutineTriggerWizard key={renderKey} initialDraft={{ ...defaultTriggerDraft, ...draft }} routineTitle={rawTitle} routineId="raw-routine-id" onSaveExit={noop} onFinish={noop} webhookUrl={rawUrl} {...props} />));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  copy.mockReset().mockResolvedValue(undefined);
  setBreadcrumbs.mockClear();
  await i18n.changeLanguage("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); vi.unstubAllGlobals();
});

it.each(locales)("validates every panel and shared prompt translation in %s", language => {
  expect(validateLocaleMessages(routineTriggerPanelMessages[language], routineTriggerPanelMessages.en)).toEqual([]);
  expect(validateLocaleMessages(agentSetupPromptMessages[language], agentSetupPromptMessages.en)).toEqual([]);
});

it.each(locales)("renders all setup steps, outcomes, cards and URL warnings in %s", async language => {
  await locale(language);
  for (const kind of ["schedule", "webhook"] as const) for (const step of [0, 1, 2]) {
    await renderDraft({ kind, step, availableStep: 2, frequency: "weekly", created: step > 0 }, { webhookSecret: rawSecret, routineActive: false }, `${kind}-${step}`);
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(key("progress"));
    expect(container.textContent).not.toMatch(/routineTriggerPanelsUi\.|agentSetupPromptUi\./);
    if (step === 0) expect(container.textContent).toContain(rawTitle);
    if (kind === "schedule" && step === 1) {
      expect(container.textContent).toContain(key("timezoneHelp"));
      expect(container.querySelector<HTMLSelectElement>("#run-day")?.value).toBe("Monday");
    }
    if (kind === "schedule" && step === 2) expect(container.textContent).toContain(key("pausedScheduleHelp"));
    if (kind === "webhook" && step === 1) {
      expect(container.textContent).toContain(rawSecret); expect(container.textContent).toContain(rawUrl);
      expect(container.textContent).toContain(key("signingHelp"));
    }
  }
  for (const checkResult of ["received", "rejected", "no_event", "waiting"] as const) {
    await renderDraft({ kind: "webhook", step: 2, availableStep: 2, created: true }, { checkResult }, checkResult);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(key(checkResult === "no_event" ? "noEvent" : checkResult));
    expect(container.textContent).toContain(key("finishActiveHelp"));
  }
  for (const [url, reason] of [["http://localhost:3100/webhook", "loopback"], ["https://192.168.1.2/webhook", "private"], ["https://host.test.ts.net/webhook", "tailscale"], ["http://example.com/webhook", "https"], ["invalid", "invalid"]]) {
    await act(async () => root.render(<WebhookUrlWarning url={url} />));
    expect(container.textContent).toContain(key(`warning_${reason}_title`));
    expect(container.textContent).toContain(key(`warning_${reason}_message`));
  }
  for (const kind of ["schedule", "webhook", "api"] as const) {
    await act(async () => root.render(<RoutineTriggerCard kind={kind} icon={null} title={rawTitle} summary="raw summary" expanded={false} onEdit={noop} onRemove={noop}><span /></RoutineTriggerCard>));
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe(key(`card_${kind}`));
    expect(button(key(`remove_${kind}`)).title).toBe(key(`remove_${kind}`));
    expect(container.textContent).toContain(rawTitle);
  }
});

it("changes language in-place without changing schedule values or firing actions", async () => {
  const onSaveExit = vi.fn(); const onFinish = vi.fn(); const onCreateWebhook = vi.fn(); const onRotateKey = vi.fn();
  await renderDraft({ kind: "schedule", step: 1, availableStep: 2, frequency: "weekly", weekday: "Tuesday", time: "21:15", timezone: "Asia/Tokyo" }, { onSaveExit, onFinish, onCreateWebhook, onRotateKey });
  const originalSelect = container.querySelector("#run-day");
  for (const language of locales) {
    await locale(language);
    expect(container.querySelector("#run-day")).toBe(originalSelect);
    expect(container.querySelector<HTMLSelectElement>("#run-day")?.value).toBe("Tuesday");
    expect(container.querySelector<HTMLInputElement>("#run-time")?.value).toBe("21:15");
    expect(container.querySelector<HTMLSelectElement>("#timezone")?.value).toBe("Asia/Tokyo");
    expect(container.querySelector<HTMLOptionElement>('#run-day option[value="Tuesday"]')?.textContent).toBe(formatDate(new Date(Date.UTC(2026, 0, 6)), { weekday: "long", timeZone: "UTC" }));
    for (const action of [onSaveExit, onFinish, onCreateWebhook, onRotateKey]) expect(action).not.toHaveBeenCalled();
  }
  await act(async () => button(key("reviewSchedule")).click());
  expect(container.textContent).toContain(describeSchedule({ ...defaultTriggerDraft, frequency: "weekly", weekday: "Tuesday", time: "21:15" }));
  await act(async () => button(key("addSchedule")).click());
  expect(onFinish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ frequency: "weekly", weekday: "Tuesday", time: "21:15", timezone: "Asia/Tokyo", step: 2 }));
});

it.each([null, new ManagementUiError("routineTriggerPanelsUi.saveFailed"), new Error("raw backend diagnostic / 原文")])("retains semantic local errors but raw server errors across locale switches: %s", async error => {
  const onFinish = vi.fn().mockRejectedValue(error);
  await renderDraft({ kind: "schedule", step: 2, availableStep: 2 }, { onFinish });
  await act(async () => button(key("addSchedule")).click());
  for (const language of locales) {
    await locale(language);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(error instanceof Error && !(error instanceof ManagementUiError) ? error.message : key("saveFailed"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  }
});

it("keeps copy fallback and its secret through language changes without copying again", async () => {
  copy.mockRejectedValue(new Error("denied"));
  await act(async () => root.render(<CopyField label="raw secret label" value={rawSecret} />));
  await act(async () => button(key("copy")).click());
  for (const language of locales) {
    await locale(language);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(key("copyFailed"));
    expect(container.querySelector("textarea")?.value).toBe(rawSecret);
    expect(copy).toHaveBeenCalledExactlyOnceWith(rawSecret);
  }
});

it("keeps execution instructions byte-identical in all languages and authentication modes", async () => {
  for (const sender of ["custom", "github"] as const) for (const signingMode of ["bearer", "app_webhook", "fireflies_hmac"] as const) {
    const original = webhookAgentInstructions(sender, rawTitle, rawUrl, rawSecret, true, signingMode);
    for (const language of locales) {
      await locale(language);
      expect(webhookAgentInstructions(sender, rawTitle, rawUrl, rawSecret, true, signingMode)).toBe(original);
      expect(original).toContain(rawUrl); expect(original).toContain(rawSecret); expect(original).toContain(JSON.stringify(rawTitle));
    }
  }
});

it("updates shared agent-prompt chrome without rewriting or recopying its payload", async () => {
  const prompt = webhookAgentInstructions("custom", rawTitle, rawUrl, rawSecret);
  await act(async () => root.render(<AgentSetupPrompt prompt={prompt} agent={{ name: "Customer/Agent", src: "/fixture.svg" }} />));
  await act(async () => button(promptKey("label")).click());
  for (const language of locales) {
    await locale(language);
    expect(document.querySelector("pre")?.textContent).toBe(prompt);
    expect(document.querySelector("pre")?.getAttribute("aria-label")).toBe(promptKey("prompt"));
    expect(button(promptKey("close"))).toBeDefined();
    expect(document.body.textContent).toContain("Customer/Agent");
    expect(document.body.textContent).toContain(promptKey("copiedClipboard"));
    expect(copy).toHaveBeenCalledExactlyOnceWith(prompt);
  }
  await act(async () => button(promptKey("close")).click());
  expect(document.querySelector("pre")).toBeNull(); expect(copy).toHaveBeenCalledTimes(1);
});

it("localizes the shared prompt clipboard failure and retry without altering the payload", async () => {
  copy.mockRejectedValueOnce(new Error("denied"));
  await act(async () => root.render(<AgentSetupPrompt prompt={rawSecret} />));
  await act(async () => button(promptKey("label")).click());
  for (const language of locales) {
    await locale(language);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(promptKey("failed"));
    expect(document.querySelector("textarea")?.value).toBe(rawSecret);
    expect(copy).toHaveBeenCalledTimes(1);
  }
  await act(async () => button(promptKey("retry")).click());
  expect(copy).toHaveBeenNthCalledWith(2, rawSecret);
  expect(document.body.textContent).toContain(promptKey("copiedClipboard"));
});

it("retains an existing webhook, secret and current step without requests on locale changes", async () => {
  const onSaveExit = vi.fn(); const onFinish = vi.fn(); const onCreateWebhook = vi.fn(); const onRotateKey = vi.fn();
  const draft = { ...defaultTriggerDraft, kind: "webhook" as const, step: 1, availableStep: 2, created: true, sender: "github" as const };
  await renderDraft(draft, { onSaveExit, onFinish, onCreateWebhook, onRotateKey, webhookSecret: rawSecret });
  const originalCode = [...container.querySelectorAll("code")].find(el => el.textContent === rawSecret);
  for (const language of locales) {
    await locale(language);
    expect(container.querySelector("h1")?.textContent).toBe(key("connectGithub"));
    expect([...container.querySelectorAll("code")].find(el => el.textContent === rawSecret)).toBe(originalCode);
    for (const action of [onSaveExit, onFinish, onCreateWebhook, onRotateKey, copy]) expect(action).not.toHaveBeenCalled();
  }
  await act(async () => button(i18n.t("remoteMcpFormUi.saveExit")).click());
  expect(onSaveExit).toHaveBeenCalledExactlyOnceWith(draft);
});

it("retains an expanded card editor and arbitrary input through locale changes", async () => {
  const onEdit = vi.fn(); const onRemove = vi.fn();
  await act(async () => root.render(<RoutineTriggerCard kind="webhook" icon={null} title={rawTitle} summary="raw summary" expanded onEdit={onEdit} onRemove={onRemove}><input defaultValue={rawSecret} /></RoutineTriggerCard>));
  const editor = container.querySelector("input");
  for (const language of locales) {
    await locale(language);
    expect(container.querySelector("input")).toBe(editor);
    expect(editor?.value).toBe(rawSecret);
    expect(button(key("close")).getAttribute("aria-expanded")).toBe("true");
    expect(onEdit).not.toHaveBeenCalled(); expect(onRemove).not.toHaveBeenCalled();
  }
});

it("localizes an in-flight clipboard action without starting a second copy", async () => {
  let resolve!: () => void;
  copy.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await act(async () => root.render(<AgentSetupPrompt prompt={rawSecret} />));
  await act(async () => button(promptKey("label")).click());
  for (const language of locales) {
    await locale(language);
    expect(button(promptKey("copying")).getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector("pre")?.textContent).toBe(rawSecret);
    expect(copy).toHaveBeenCalledExactlyOnceWith(rawSecret);
  }
  await act(async () => resolve());
  expect(document.body.textContent).toContain(promptKey("copiedClipboard"));
});
