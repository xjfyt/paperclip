import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n } from "./index";
import { AgentStatusBadge, IssueStatusBadge, StatusBadge } from "../components/StatusBadge";
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each([["zh-CN", "进行中", "运行中"], ["es", "En curso", "En ejecución"], ["ja", "進行中", "実行中"]])("renders system state in %s without changing state values", async (locale, issue, agent) => {
  await i18n.changeLanguage(locale);
  expect(renderToStaticMarkup(<IssueStatusBadge status="in_progress" />)).toContain(issue);
  expect(renderToStaticMarkup(<AgentStatusBadge status="running" />)).toContain(agent);
  expect(renderToStaticMarkup(<StatusBadge status="approved" label="User-provided Approved 标题" />)).toContain("User-provided Approved 标题");
});
