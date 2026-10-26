import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { coreTaskMessages } from "./core-task-test-resources";
import appEn from "./contributions/app/en.json";
import appZh from "./contributions/app/zh-CN.json";
import appEs from "./contributions/app/es.json";
import appJa from "./contributions/app/ja.json";
import onboardingZh from "./contributions/optionalOnboarding/zh-CN.json";
import wecomEs from "./contributions/wecomUi/es.json";

const richSlots = (value: string) => [...value.matchAll(/<\/?(\d+)>/g)].map(match => match[0]).sort();

describe("core task contribution contracts", () => {
  it.each(Object.entries(coreTaskMessages))("keeps keys, interpolation, and rich-text slots aligned in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, coreTaskMessages.en)).toEqual([]);
    for (const [key, value] of Object.entries(messages)) {
      expect(value.trim()).not.toBe("");
      expect(richSlots(value)).toEqual(richSlots(coreTaskMessages.en[key as keyof typeof coreTaskMessages.en]));
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });

  it.each(Object.entries({ en: appEn, "zh-CN": appZh, es: appEs, ja: appJa }))(
    "supplies the live cloud-creation fallback without translating Paperclip Cloud in %s",
    (_locale, messages) => {
      expect(validateLocaleMessages(messages, appEn)).toEqual([]);
      expect(messages.cloudCreateUnavailable).toContain("Paperclip Cloud");
    },
  );

  it("preserves Agent terminology in Chinese onboarding and unambiguous Spanish redaction", () => {
    expect(Object.values(onboardingZh).join(" ")).not.toContain("智能体");
    for (const key of ["organizationHelp", "agentHelp", "addAgentTitle", "noAgents", "configureAgent"] as const) {
      expect(onboardingZh[key]).toContain("Agent");
    }
    expect(wecomEs.limit).toContain("estado con datos ocultos");
    expect(wecomEs.unknown).toContain("lista con datos ocultos");
  });
});
