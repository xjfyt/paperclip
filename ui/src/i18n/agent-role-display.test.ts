import "./agent-directory-test-resources";
import { afterEach, expect, it } from "vitest";
import { AGENT_ROLE_LABELS } from "@paperclipai/shared";
import { i18n } from "./index";
import { agentRoleLabel } from "./agent-role-display";

afterEach(async () => { await i18n.changeLanguage("en"); });
it.each([
  ["en", ["Security", "Engineer", "Designer", "Researcher", "General"]],
  ["zh-CN", ["安全", "工程师", "设计师", "研究员", "通用"]],
  ["es", ["Seguridad", "Ingeniero", "Diseñador", "Investigador", "General"]],
  ["ja", ["セキュリティ", "エンジニア", "デザイナー", "リサーチャー", "汎用"]],
] as const)("localizes human role labels in %s without translating wire or technical names", async (locale, expected) => {
  const before = JSON.stringify(AGENT_ROLE_LABELS);
  await i18n.changeLanguage(locale);
  expect(["security", "engineer", "designer", "researcher", "general"].map(agentRoleLabel)).toEqual(expected);
  expect(["ceo", "cto", "cmo", "cfo", "pm", "qa", "devops"].map(agentRoleLabel)).toEqual(["CEO", "CTO", "CMO", "CFO", "PM", "QA", "DevOps"]);
  for (const raw of ["Custom role 用户", "constructor", "__proto__", ""]) expect(agentRoleLabel(raw)).toBe(raw);
  expect(JSON.stringify(AGENT_ROLE_LABELS)).toBe(before);
});
