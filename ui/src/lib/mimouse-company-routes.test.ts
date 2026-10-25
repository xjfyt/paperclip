import { expect, it } from "vitest";
import { applyCompanyPrefix, extractCompanyPrefixFromPath } from "./company-routes";
it.each(["/notifications", "/integrations/workbuddy", "/coding?issueId=one"])("scopes extension route %s to the selected company", route => {
  expect(applyCompanyPrefix(route, "MIM")).toBe(`/MIM${route}`);
  expect(extractCompanyPrefixFromPath(route.split("?")[0])).toBeNull();
  expect(extractCompanyPrefixFromPath(`/MIM${route}`)).toBe("MIM");
});
