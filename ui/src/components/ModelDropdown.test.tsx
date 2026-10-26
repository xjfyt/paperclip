// @vitest-environment jsdom
import "@/i18n/agent-setup-test-resources";
import { i18n } from "@/i18n";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelDropdown } from "./AgentConfigForm";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  await i18n.changeLanguage("en");
});

function renderOpenDropdown(
  models: AdapterModel[],
  { groupByProvider = false, preserveOrder = false }: { groupByProvider?: boolean; preserveOrder?: boolean } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <TooltipProvider>
        <ModelDropdown
          models={models}
          value=""
          onChange={() => {}}
          open
          onOpenChange={() => {}}
          allowDefault={false}
          required
          groupByProvider={groupByProvider}
          preserveOrder={preserveOrder}
        />
      </TooltipProvider>,
    );
  });
}

function shownModelIds(): string[] {
  return Array.from(document.body.querySelectorAll("span[title]")).map((span) => span.getAttribute("title") ?? "");
}

const curated = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
];

describe("ModelDropdown", () => {
  it("keeps a hand-ordered list in the adapter's order when preserveOrder is set", () => {
    renderOpenDropdown(curated, { preserveOrder: true });

    expect(shownModelIds()).toEqual(curated.map((model) => model.id));
  });

  it("still sorts a discovered list by id by default", () => {
    renderOpenDropdown(curated);

    expect(shownModelIds()).toEqual(["claude-fable-5-1", "claude-haiku-4-5", "claude-opus-4-8", "claude-opus-5-5"]);
  });

  it("still sorts provider groups by id", () => {
    renderOpenDropdown(
      [
        { id: "openai/gpt-6-sol", label: "gpt-6-sol" },
        { id: "openai/gpt-6-astra", label: "gpt-6-astra" },
      ],
      { groupByProvider: true },
    );

    expect(shownModelIds()).toEqual(["openai/gpt-6-astra", "openai/gpt-6-sol"]);
  });
});


it.each(["en", "zh-CN", "es", "ja"])("localizes native model selection and custom placeholders in %s without changing model IDs", async locale => {
  await i18n.changeLanguage(locale);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = () => <TooltipProvider><ModelDropdown models={curated} value="claude-opus-5-5" onChange={() => {}} open={false} onOpenChange={() => {}} allowDefault required={false} groupByProvider={false} creatable presentation="native" /></TooltipProvider>;
  await act(async () => root.render(render()));
  const select = container.querySelector<HTMLSelectElement>("select")!;
  expect(select.getAttribute("aria-label")).toBe(i18n.t("workflow.model"));
  expect(select.value).toBe("claude-opus-5-5");
  expect(select.textContent).toContain("Claude Opus 5.5");
  expect(select.textContent).toContain(i18n.t("agentSetupSharedUi.customModel"));
  await act(async () => {
    select.value = "__paperclip_custom_model__";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = container.querySelector<HTMLInputElement>("input")!;
  expect(input.getAttribute("aria-label")).toBe(i18n.t("agentSetupSharedUi.modelId"));
  expect(input.placeholder).toBe(i18n.t("agentSetupSharedUi.modelIdPlaceholder"));
  expect(input.value).toBe("claude-opus-5-5");
  await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
  expect(input.placeholder).toBe(i18n.t("agentSetupSharedUi.modelIdPlaceholder"));
  expect(input.value).toBe("claude-opus-5-5");
});


it.each(["en", "zh-CN", "es", "ja"])("localizes searchable-model empty state in %s", async locale => {
  await i18n.changeLanguage(locale);
  renderOpenDropdown([]);
  expect(document.body.textContent).toContain(i18n.t("agentSetupSharedUi.noModels"));
  expect(document.querySelector<HTMLInputElement>("input")?.placeholder).toBe(i18n.t("agentSetupSharedUi.searchModels"));
  expect(document.body.textContent).not.toContain("agentSetupSharedUi.");
});
