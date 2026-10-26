// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import "./agent-setup-test-resources";
import { agentSetupConnectionMessages } from "./agent-setup-connection-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { AiConnectionSelect } from "../components/ai-connections/AiConnectionSelect";
import { SavedProviderKeySelect } from "../components/onboarding/SavedProviderKeySelect";
import { savedManagedProviderAccounts } from "../lib/saved-provider-credentials";
import type { AiManagedConnectionSummary } from "@paperclipai/shared";
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
afterEach(async () => { await i18n.changeLanguage("en"); });
const account = { id: "c", grantId: "grant", companyId: "company", provider: "openai", method: "subscription", name: "Customer (Your default)", ownership: "personal", ownerUserId: "owner", isDefault: true, status: "connected" } as const;
it.each(Object.entries(agentSetupConnectionMessages))("validates connection resources and placeholders in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, agentSetupConnectionMessages.en)).toEqual([]);
  if (locale !== "en") for (const key of Object.keys(messages) as Array<keyof typeof messages>) {
    expect(messages[key], `${locale}:${key}`).not.toBe(agentSetupConnectionMessages.en[key]);
  }
});
it.each(["en", "zh-CN", "es", "ja"])("renders connection status and saved-account labels in %s while preserving source names", async locale => {
  await i18n.changeLanguage(locale);
  const options = savedManagedProviderAccounts("company", "openai", "owner", [account]);
  const html = renderToStaticMarkup(<SavedProviderKeySelect options={options} value="ai:grant" onChange={() => {}} loading={false} error={false} kind="subscription" />);
  expect(html).toContain(i18n.t("agentSetupConnectionUi.yourDefault", { name: account.name }));
  expect(html).toContain("Customer (Your default)");
  expect(options[0].aiConnection).toEqual({ provider: "openai", method: "subscription", mode: "responsible_user" });
  const render = (connections: AiManagedConnectionSummary[]) => renderToStaticMarkup(<AiConnectionSelect
    adapterType="codex_local" requirement={{ companyId: "company", provider: "openai" }} connections={connections}
    value={{ provider: "openai", method: "subscription", mode: "responsible_user" }} currentUserId="owner" agentId="agent" agentName="Customer Agent"
    onChange={() => {}} onConnect={() => {}} onRetry={() => {}} />);
  expect(render([])).toContain(i18n.t("agentSetupConnectionUi.noDefaultAccount"));
  expect(render([{ ...account, status: "expired" }])).toContain(i18n.t("agentSetupConnectionUi.reconnectProblem", { status: i18n.t("agentSetupConnectionUi.expired") }));
  const raw = render([{ ...account, status: "expired", unavailableReason: "Provider raw unavailable reason" }]);
  expect(raw).toContain("Provider raw unavailable reason");
  expect(raw).not.toContain("agentSetupConnectionUi.");
});
