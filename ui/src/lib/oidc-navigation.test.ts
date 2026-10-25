import { describe, expect, it } from "vitest";
import { oidcNavigationUrl, safeOidcReturnPath } from "./oidc-navigation";
describe("OIDC redirects", () => {
  it.each(["javascript:alert(1)", "data:text/html,x", "http://id.example", "https://user:pass@id.example", "//evil.example", null])("rejects %s", value => expect(oidcNavigationUrl(value)).toBeNull());
  it("allows HTTPS IdP and loopback fixtures", () => {
    expect(oidcNavigationUrl("https://id.example/authorize")).toBe("https://id.example/authorize");
    expect(oidcNavigationUrl("http://127.0.0.1:4000/logout")).toBe("http://127.0.0.1:4000/logout");
  });
  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "/x\nfoo"])("rejects unsafe return path %s", value => expect(safeOidcReturnPath(value)).toBe("/"));
  it("retains local callback intent", () => expect(safeOidcReturnPath("/issues?status=todo")).toBe("/issues?status=todo"));
});
