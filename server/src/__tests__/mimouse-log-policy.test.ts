import { expect, it } from "vitest";
import { isPrivateIntegrationHttpRequest, isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";
it.each(["/api/companies/company/notifications/endpoints", "/api/companies/company/coding", "/api/companies/company/integrations/workbuddy/callback?code=fixture", "https://app.example/API/companies/company/integrations/workbuddy/jobs"])("keeps integration inputs private: %s", url => {
  expect(isPrivateIntegrationHttpRequest(url)).toBe(true); expect(isSecretSensitiveHttpRequest("GET", url)).toBe(true); expect(isSecretSensitiveHttpRequest("POST", url)).toBe(true);
});
it("does not silence unrelated route diagnostics", () => expect(isPrivateIntegrationHttpRequest("/api/companies/company/issues")).toBe(false));
