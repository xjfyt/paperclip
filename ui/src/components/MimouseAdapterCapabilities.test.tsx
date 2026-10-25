// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { i18n } from "@/i18n";
import { adapterQualifications, capabilityNames, MimouseAdapterCapabilities } from "./MimouseAdapterCapabilities";
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(["qoder_cn", "workbuddy", "process", "unknown", "__proto__"])("always returns all seven capability states without promoting %s to live tested", type => {
  const values = adapterQualifications(type); expect(Object.keys(values)).toEqual([...capabilityNames]);
  expect(Object.values(values).every(value => ["fixture", "unsupported", "unknown"].includes(value.status))).toBe(true);
  if (!["qoder_cn", "workbuddy"].includes(type)) expect(Object.values(values).every(value => value.status === "unknown")).toBe(true);
});
it("does not claim remote cancellation, tool approval, code round trip or USD usage for WorkBuddy", () => {
  const v = adapterQualifications("workbuddy");
  for (const name of ["confirmedCancellation", "toolApproval", "workspaceRoundTrip"] as const) expect(v[name].status).toBe("unsupported");
  expect(v.usageReporting.status).toBe("unknown"); expect(v.usageReporting.note).toBe("unpricedUsage");
});
it.each(["en", "zh-CN", "es", "ja"])("renders evidence boundaries and exactly seven fields in %s", async locale => {
  await i18n.changeLanguage(locale); const markup = renderToStaticMarkup(<MimouseAdapterCapabilities adapterType="qoder_cn" />);
  const host = document.createElement("div"); host.innerHTML = markup;
  expect(host.querySelectorAll('[data-capability]')).toHaveLength(7);
  expect(host.textContent).toContain(i18n.t("adapterCapabilities.disclaimer", { adapter: "qoder_cn" }));
  expect(host.textContent).toContain(i18n.t("adapterCapabilities.qoderStop"));
});
