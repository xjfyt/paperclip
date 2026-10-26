// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { i18n } from "./index";
import "./agent-setup-test-resources";
import { agentSetupSharedMessages } from "./agent-setup-shared-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { RuntimeTestCard } from "../components/RuntimeTestCard";
import { LocalProviderLoginInstructions, OnboardingCardField, OnboardingLoginCard, OnboardingLoginCodeRow, ProviderSubscriptionCard } from "../components/AdapterLoginChrome";
import { SecretPicker } from "../components/environment-variables-editor/SecretPicker";
import type { CompanySecret } from "@paperclipai/shared";

const states = ["idle", "running", "pass", "warn", "fail"] as const;
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(Object.entries(agentSetupSharedMessages))("validates shared setup translations and interpolation in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, agentSetupSharedMessages.en)).toEqual([]);
  if (locale !== "en") for (const key of Object.keys(messages) as Array<keyof typeof messages>) {
    expect(messages[key], `${locale}:${key}`).not.toBe(agentSetupSharedMessages.en[key]);
  }
});
it.each(["en", "zh-CN", "es", "ja"])("renders all runtime states and preserves raw diagnostic content in %s", async locale => {
  await i18n.changeLanguage(locale);
  for (const variant of ["connection", "prerequisites"] as const) for (const state of states) {
    const html = renderToStaticMarkup(<RuntimeTestCard variant={variant} state={state} result={{
      adapterType: "codex_local", status: "warn", testedAt: "2026-10-26T00:00:00Z",
      checks: [{ code: "provider_fixture", level: "warn", message: "Provider original diagnostic", detail: "model/id", hint: "run fixture --test" }],
    }} onTest={() => {}} />);
    expect(html).toContain(i18n.t("agentSetupSharedUi.runtimeTest"));
    expect(html).toContain(i18n.t("agentSetupSharedUi.testDetails"));
    expect(html).toContain("Provider original diagnostic");
    expect(html).toContain("model/id");
    expect(html).toContain("run fixture --test");
    expect(html).not.toContain("agentSetupSharedUi.");
    if (locale !== "en") expect(html).not.toContain("Test details");
  }
});
it.each(["en", "zh-CN", "es", "ja"])("renders login prompts and accessible fields without translating codes, URLs or commands in %s", async locale => {
  await i18n.changeLanguage(locale);
  const html = renderToStaticMarkup(<>
    <OnboardingLoginCard instruction="fixture" loading><span /></OnboardingLoginCard>
    <OnboardingCardField value="AUTH-CODE-123" onChange={() => {}} onSubmit={() => {}} />
    <OnboardingLoginCodeRow code="COPY-CODE-456" />
    <ProviderSubscriptionCard providerName="OpenAI" authorizationUrl="https://example.test/authorize?code=KEEP" mode="submitted_code"><span /></ProviderSubscriptionCard>
    <LocalProviderLoginInstructions adapterType="grok_local" login={{ preparing: false, command: "grok login --fixture", status: "sign_in_required", error: null, retry: () => {} }} />
    <LocalProviderLoginInstructions adapterType="codex_local" login={{ preparing: false, status: "ready", error: null, retry: () => {} }} />
  </>);
  for (const key of ["preparingSignIn", "authorizationCode", "pasteAuthorizationCode", "copyCode", "terminalLoginHelp", "differentAccount"]) {
    expect(html).toContain(i18n.t(`agentSetupSharedUi.${key}`));
  }
  expect(html).toContain("AUTH-CODE-123");
  expect(html).toContain("COPY-CODE-456");
  expect(html).toContain("https://example.test/authorize?code=KEEP");
  expect(html).toContain("grok login --fixture");
  expect(html).toContain("Codex CLI");
  expect(html).not.toContain("agentSetupSharedUi.");
});
it.each(["en", "zh-CN", "es", "ja"])("renders missing and disabled secrets in %s without changing names or IDs", async locale => {
  await i18n.changeLanguage(locale);
  const missing = renderToStaticMarkup(<SecretPicker secretId="customer-secret-123" secrets={[]} onSelect={() => {}} />);
  expect(missing).toContain(i18n.t("agentSetupSharedUi.missingSecret", { id: "customer…" }));
  const secret = { id: "secret-raw-id", name: "Customer/API_KEY", key: "API_KEY", status: "disabled" } as CompanySecret;
  const selected = renderToStaticMarkup(<SecretPicker secretId={secret.id} secrets={[secret]} onSelect={() => {}} />);
  expect(selected).toContain("Customer/API_KEY");
  expect(selected).toContain(i18n.t("agentSetupSharedUi.secretDisabled"));
  expect(selected).not.toContain("agentSetupSharedUi.");
});
