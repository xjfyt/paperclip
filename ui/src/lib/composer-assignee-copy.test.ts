import { afterEach, describe, expect, it } from "vitest";
import { i18n, composerAssigneeMessages } from "../i18n/composer-assignee-test-resources";
import { commentSelfAssigneeOption, composerModePlaceholder } from "./composer-assignee-copy";

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("composer identity copy", () => {
  it.each(Object.entries(composerAssigneeMessages))("uses identity, never a name sentinel, in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    expect(commentSelfAssigneeOption("user-id")).toEqual({ id: "user:user-id", label: messages.self, searchText: "Me" });
    for (const mode of ["standard", "ask", "planning"] as const) {
      const key = mode === "planning" ? "plan" : mode === "ask" ? "ask" : "message";
      for (const mobile of [false, true]) {
        expect(composerModePlaceholder(mode, null, mobile)).toBe(messages[`${key}Unassigned`]);
        for (const name of ["Me", "Unassigned", "未分配", "Alice", "Agent Alpha"]) {
          expect(composerModePlaceholder(mode, name, mobile)).toBe(i18n.t(`browserQa.${key}${mobile ? "Mobile" : ""}`, { agent: name }));
        }
      }
    }
  });
});
