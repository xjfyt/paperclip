// @vitest-environment jsdom
import { act } from "react";
import { i18n } from "@/i18n";
import { agentTrustMessages } from "@/i18n/agent-trust-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPermissions } from "@paperclipai/shared";
import { TrustPresetSection } from "./TrustPresetSection";
import { TooltipProvider } from "@/components/ui/tooltip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderSection(permissions: Partial<AgentPermissions>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const createdRoot = createRoot(container);
  root = createdRoot;
  flushSync(() => {
    createdRoot.render(
      <TooltipProvider>
        <TrustPresetSection
          permissions={permissions}
          onChange={onChange}
          companyId="company-1"
          projectCandidates={[{ id: "project-1", label: "Paperclip App" }]}
          issueCandidates={[{ id: "issue-1", label: "PAP-1 · Review PR" }]}
        />
      </TooltipProvider>,
    );
  });
  return { onChange, text: () => container?.textContent ?? "" };
}

afterEach(async () => {
  if (root) {
    flushSync(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  await i18n.changeLanguage("en");
});

describe("TrustPresetSection", () => {
  it("hides the CE boundary editor under Standard", () => {
    const view = renderSection({ canCreateAgents: false, trustPreset: "standard" });

    expect(view.text()).toContain("Trust preset");
    expect(view.text()).not.toContain("Boundary type");
    expect(view.text()).not.toContain("Get Paperclip EE.");
  });

  it("shows a selectable CE boundary editor for low-trust review", () => {
    const view = renderSection({
      canCreateAgents: false,
      trustPreset: "low_trust_review",
      authorizationPolicy: {
        trustPreset: "low_trust_review",
        trustBoundary: {
          mode: "low_trust_review",
          companyId: "company-1",
          projectIds: ["project-1"],
        },
      },
    });

    expect(view.text()).toContain("Containment active");
    expect(view.text()).toContain("Boundary type");
    expect(view.text()).toContain("Paperclip App");
    expect(view.text()).toContain("Get Paperclip EE.");
    expect(view.text()).not.toContain("Managed by EE/API");
  });

  it("renders multi-boundary policies as read-only", () => {
    const view = renderSection({
      canCreateAgents: false,
      trustPreset: "low_trust_review",
      authorizationPolicy: {
        trustPreset: "low_trust_review",
        trustBoundary: {
          mode: "low_trust_review",
          companyId: "company-1",
          projectIds: ["project-1", "project-2"],
        },
      },
    });

    expect(view.text()).toContain("Managed by EE/API");
    expect(view.text()).toContain("2 boundaries");
    expect(view.text()).not.toContain("Clear boundary");
  });
});


describe.each(Object.entries(agentTrustMessages))("localized trust policy (%s)", (locale, messages) => {
  it("validates translations and plural count messages", async () => {
    expect(validateLocaleMessages(messages, agentTrustMessages.en)).toEqual([]);
    await i18n.changeLanguage(locale);
    for (const kind of ["project", "issue", "agent", "binding"]) for (const count of [0, 1, 2]) {
      const key = `${kind}Count_${count === 1 && ["en", "es"].includes(locale) ? "one" : "other"}` as keyof typeof messages;
      expect(i18n.t(`agentTrustUi.${kind}Count`, { count, total: String(count) })).toBe(messages[key].replace("{{total}}", String(count)));
    }
    if (locale !== "en") for (const key of Object.keys(messages) as (keyof typeof messages)[]) expect(messages[key]).not.toBe(agentTrustMessages.en[key]);
  });
  it("keeps boundary selection and focus, submitting only original policy keys and IDs", async () => {
    const permissions = { trustPreset: "low_trust_review", authorizationPolicy: { trustPreset: "low_trust_review", trustBoundary: { mode: "low_trust_review", companyId: "company-1", projectIds: ["project-1"] } } } as Partial<AgentPermissions>;
    const original = JSON.stringify(permissions); const view = renderSection(permissions);
    const [preset, type, target] = [...container!.querySelectorAll("select")];
    await act(async () => { type.value = "root_issue"; type.dispatchEvent(new Event("change", { bubbles: true })); });
    type.focus();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container!.querySelectorAll("select")[1]).toBe(type); expect(document.activeElement).toBe(type);
    expect(type.value).toBe("root_issue"); expect(preset.value).toBe("low_trust_review");
    expect(view.text()).toContain(messages.active); expect(view.text()).toContain(messages.rootIssue);
    expect(view.text()).toContain("PAP-1 · Review PR"); expect(view.onChange).not.toHaveBeenCalled();
    await act(async () => { target.value = "issue-1"; target.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(view.onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ trustPreset: "low_trust_review", authorizationPolicy: expect.objectContaining({ trustBoundary: expect.objectContaining({ mode: "low_trust_review", companyId: "company-1", rootIssueId: "issue-1" }) }) }));
    expect(view.onChange.mock.calls[0][0].authorizationPolicy.trustBoundary.projectIds).toBeUndefined();
    expect(JSON.stringify(permissions)).toBe(original);
  });
  it("preserves the open read-only policy, raw tool IDs and count scope", async () => {
    const permissions = { trustPreset: "low_trust_review", authorizationPolicy: { trustPreset: "low_trust_review", trustBoundary: { mode: "low_trust_review", projectIds: ["project-1", "project-2"], allowedAgentIds: ["agent-1"], allowedToolClasses: ["custom_wire_tool"], allowedSecretBindingIds: ["binding-1", "binding-2"], outputPromotionTarget: { issueId: "promotion-raw-id" } } } } as unknown as Partial<AgentPermissions>;
    const view = renderSection(permissions);
    const toggle = [...container!.querySelectorAll("button")].find(button => button.textContent === "View policy")!;
    await act(async () => toggle.click()); toggle.focus();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true"); expect(document.activeElement).toBe(toggle);
    expect(view.text()).toContain(messages.managedPolicy.replace("{{total}}", "2"));
    expect(view.text()).toContain(i18n.t("agentTrustUi.projectCount", { count: 2, total: "2" }));
    expect(view.text()).toContain(i18n.t("agentTrustUi.agentCount", { count: 1, total: "1" }));
    expect(view.text()).toContain("custom_wire_tool"); expect(view.text()).toContain("promotio");
    expect(view.text()).not.toContain(messages.clearBoundary); expect(view.onChange).not.toHaveBeenCalled();
    expect(container!.querySelector('a')!.href).toBe("https://paperclip.ing/ee");
  });
});
