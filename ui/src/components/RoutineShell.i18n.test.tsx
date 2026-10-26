// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import en from "../i18n/contributions/routineShellUi/en.json";
import zh from "../i18n/contributions/routineShellUi/zh-CN.json";
import es from "../i18n/contributions/routineShellUi/es.json";
import ja from "../i18n/contributions/routineShellUi/ja.json";
import { RoutineContextualSidebar } from "./RoutineContextualSidebar";
import { RoutineSubSidebar, RoutineSectionPicker } from "./RoutineSubSidebar";
import { RoutineSectionHeading } from "./RoutineSectionHeading";
const copy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: copy }));
vi.mock("@/lib/router", () => ({
  useParams: () => ({ routineId: "routine-original" }),
  Link: ({ to, replace: _replace, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/api/routines", () => ({ routinesApi: { get: vi.fn() } }));
vi.mock("./ContextualSidebarFrame", () => ({ ContextualSidebarFrame: ({ title, children }: { title: string; children: ReactNode }) => <aside data-title={title}>{children}</aside> }));
vi.mock("./SidebarNavItem", () => ({ SidebarNavItem: ({ to, label }: { to: string; label: string }) => <a href={to}>{label}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); copy.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
const locales = [["en", en], ["zh-CN", zh], ["es", es], ["ja", ja]] as const;
const labels = { overview: "commonUi.overview", triggers: "routineScheduleUi.triggers", variables: "stabilizationUi.variables", delivery: "routineShellUi.delivery", secrets: "settingsUi.secrets", runs: "browserQa.runs", activity: "workflow.activity", history: "workflow.history" };

describe.each(locales)("routine shell in %s", (locale, strings) => {
  it("has exact resource and interpolation parity without fallback keys", async () => {
    await i18n.changeLanguage(locale);
    expect(Object.keys(strings).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(strings)) {
      expect(i18n.getResource(locale, "translation", `routineShellUi.${key}`)).toBe(value);
      expect(i18n.t(`routineShellUi.${key}`)).toBe(value);
      expect(value.match(/{{.*?}}/g)).toEqual(en[key as keyof typeof en].match(/{{.*?}}/g));
    }
    for (const key of [...Object.values(labels), "statuses.draft", "statuses.paused", "propertyLabels.archived"]) {
      expect(i18n.getResource(locale, "translation", key)).toBeTypeOf("string");
      expect(i18n.t(key)).not.toBe(key);
    }
  });
  it("renders contextual navigation translated and keeps route IDs and custom routine title", async () => {
    await i18n.changeLanguage(locale);
    await act(async () => root.render(<QueryClientProvider client={client}><RoutineContextualSidebar routineId="routine-original" title="客户计划 Ω" /></QueryClientProvider>));
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe(strings.navigation);
    expect(host.querySelector("aside")?.getAttribute("data-title")).toBe("客户计划 Ω");
    expect(host.textContent).toContain(strings.operate);
    for (const [section, key] of Object.entries(labels).filter(([section]) => section !== "history")) {
      expect(host.querySelector(`a[href="/routines/routine-original/${section}"]`)?.textContent).toBe(i18n.t(key));
    }
    await act(async () => { await i18n.changeLanguage(locale === "en" ? "ja" : "en"); });
    expect(host.querySelector('a[href="/routines/routine-original/overview"]')?.textContent).toBe(i18n.t(labels.overview));
    expect(host.querySelector("aside")?.getAttribute("data-title")).toBe("客户计划 Ω");
  });
  it("renders desktop/mobile sections and preserves dirty state and navigation targets", async () => {
    await i18n.changeLanguage(locale); const onNavigate = vi.fn();
    await act(async () => root.render(<><RoutineSubSidebar activeSection="overview" hrefFor={s => `/routines/routine-original/${s}`} isSectionDirty={s => s === "delivery"} hasLiveRun={false} onNavigate={onNavigate} /><RoutineSectionPicker activeSection="delivery" isSectionDirty={() => false} onNavigate={onNavigate} /></>));
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe(strings.sections);
    expect(host.querySelector(`[aria-label="${strings.unsaved}"]`)).not.toBeNull();
    expect(host.querySelector(`[aria-label="${strings.section}"]`)?.textContent).toContain(strings.delivery);
    for (const [section, key] of Object.entries(labels)) expect(host.querySelector(`a[href="/routines/routine-original/${section}"]`)?.textContent).toBe(i18n.t(key));
    await act(async () => host.querySelector<HTMLAnchorElement>('a[href="/routines/routine-original/triggers"]')!.click());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("triggers");
  });
  it("copies original description with localized action and success label", async () => {
    await i18n.changeLanguage(locale);
    await act(async () => root.render(<RoutineSectionHeading title="客户自定义标题 Ω" copyText="**原始 markdown Ω**" />));
    expect(host.querySelector("h2")?.textContent).toBe("客户自定义标题 Ω");
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${strings.copy}"]`)!;
    expect(button.title).toBe(strings.copy);
    await act(async () => button.click());
    expect(copy).toHaveBeenCalledExactlyOnceWith("**原始 markdown Ω**");
    expect(document.body.textContent).toContain(strings.copied);
  });
});
