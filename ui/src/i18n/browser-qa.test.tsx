// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { systemLabel, useSystemLabels } from "./system-labels";
import { approvalLabel, ApprovalPayloadRenderer } from "../components/ApprovalPayload";
import { RunButton, PauseResumeButton } from "../components/AgentActionButtons";
// This suite checks label/content boundaries, not the separately tested Markdown renderer.
vi.mock("../components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("localizes approval and action framework labels in %s but preserves user text", async locale => {
  await i18n.changeLanguage(locale);
  const subject = "中文自定义名称 / Overview";
  expect(approvalLabel("request_board_approval", { title: subject })).toBe(`${systemLabel("Board Approval")}: ${subject}`);
  expect(approvalLabel("custom_approval_type", { title: subject })).toBe(`custom_approval_type: ${subject}`);
  const payload = renderToStaticMarkup(<ApprovalPayloadRenderer type="request_board_approval" payload={{ title: subject, summary: "用户内容，不翻译" }} />);
  expect(payload).toContain(systemLabel("Title")); expect(payload).toContain(subject); expect(payload).toContain("用户内容，不翻译");
  const buttons = renderToStaticMarkup(<><RunButton onClick={() => {}} /><PauseResumeButton isPaused onPause={() => {}} onResume={() => {}} /></>);
  expect(buttons).toContain(systemLabel("Run now")); expect(buttons).toContain(systemLabel("Resume"));
  expect(renderToStaticMarkup(<RunButton onClick={() => {}} label="客户指定运行" />)).toContain("客户指定运行");
});
it("updates mounted labels when language changes without replacing custom text", async () => {
  function View() { const label = useSystemLabels(); return <span>{label("Inbox")} / {label("客户正文")}</span>; }
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<View />)); expect(host.textContent).toBe("Inbox / 客户正文");
    await act(async () => { await i18n.changeLanguage("zh-CN"); }); expect(host.textContent).toBe("收件箱 / 客户正文");
    await act(async () => { await i18n.changeLanguage("ja"); }); expect(host.textContent).toBe("受信トレイ / 客户正文");
  } finally { await act(async () => root.unmount()); }
});

it.each(["constructor", "toString", "__proto__", "客户正文"])("does not translate inherited-object or user labels: %s", async label => {
  await i18n.changeLanguage("zh-CN"); expect(systemLabel(label)).toBe(label);
});
