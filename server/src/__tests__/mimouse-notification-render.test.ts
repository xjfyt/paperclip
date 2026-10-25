import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENT_TYPES, renderNotification, renderTemplateData } from "../services/mimouse-notifications/render.js";
describe("minimal localized notifications", () => {
  it.each(["en", "zh-CN", "es", "ja"])("renders all six events in %s with company-scoped links", locale => {
    for (const type of NOTIFICATION_EVENT_TYPES) {
      const result = renderNotification(type, "resource-123", locale, "acme", "https://paperclip.example");
      expect(result.title.length).toBeGreaterThan(5); expect(result.text).toContain("resource-123"); expect(result.detailUrl).toMatch(/^https:\/\/paperclip.example\/ACME\//);
    }
  });
  it("falls back to English and rejects URL or markdown reference injection", () => {
    expect(renderNotification("run.failed", "run-1", "xx", "PAP").title).toBe("Agent run failed");
    expect(() => renderNotification("run.failed", "@all\nsecret", "en", "PAP")).toThrow();
    expect(() => renderNotification("run.failed", "run-1", "en", "PAP", "https://user:secret@host.example")).toThrow();
  });
});

it("renders official-account template fields once and rejects arbitrary placeholders", () => {
  expect(renderTemplateData({ thing1: { value: "{{title}}" }, character_string2: { value: "{{resourceId}}" } }, { title: "{{resourceId}}", text: "Body" }, "task-1")).toEqual({ thing1: { value: "{{resourceId}}" }, character_string2: { value: "task-1" } });
  expect(() => renderTemplateData({ first: { value: "{{secret}}" } }, { title: "Title", text: "Body" }, "task-1")).toThrow("unsupported_template_placeholder");
  expect(() => renderTemplateData({ first: { value: "{{title" } }, { title: "Title", text: "Body" }, "task-1")).toThrow("invalid_template_placeholder");
});
