import { afterEach, expect, it } from "vitest";
import { i18n } from "./index";
import { validateLocaleMessages } from "./locale-validation";
import { agentSetupMessages } from "./agent-setup-test-resources";

afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(Object.entries(agentSetupMessages))("validates setup keys, interpolation and safe text in %s", async (locale, messages) => {
  expect(validateLocaleMessages(messages, agentSetupMessages.en)).toEqual([]);
  await i18n.changeLanguage(locale);
  expect(i18n.t("agentSetupUi.assignTask", { name: "R&D <Agent>" })).toContain("R&D <Agent>");
  expect(i18n.t("agentSetupUi.provideApiKey", { provider: "OpenAI" })).toContain("OpenAI");
  expect(i18n.t("agentSetupUi.keyOrSecretRequired", { key: "API_SERVER_KEY" })).toContain("API_SERVER_KEY");
  expect(i18n.t("agentSetupUi.providerModelHint", { provider: "openrouter" })).toContain("openrouter/model");
  for (const [key, command] of [["loginHintCursor", "agent login"], ["loginHintKimi", "kimi login"], ["loginHintGrok", "grok login"]]) {
    expect(i18n.t(`agentSetupUi.${key}`)).toContain(command);
  }
  for (const count of [1, 2]) {
    expect(i18n.t("agentSetupUi.savedKeys", { count })).toContain(String(count));
    expect(i18n.t("agentSetupUi.savedKeys", { count })).not.toContain("{{");
  }
  if (locale !== "en") {
    for (const key of Object.keys(messages) as Array<keyof typeof messages>) {
      expect(messages[key], `${locale}:${key}`).not.toBe(agentSetupMessages.en[key]);
    }
  }
});
