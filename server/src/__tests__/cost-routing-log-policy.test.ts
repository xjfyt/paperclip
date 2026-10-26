import { expect, it, vi } from "vitest";
vi.mock("pino", () => ({ default: Object.assign(() => ({}), { transport: () => ({}) }) }));
vi.mock("pino-http", () => ({ pinoHttp: (options: unknown) => options }));
import { createHttpLogger } from "../middleware/logger.js";
import { isPrivateIntegrationHttpRequest, isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";
const options = createHttpLogger({} as never) as unknown as {
  serializers: { req: (req: unknown) => unknown };
  customProps: (req: unknown, res: unknown) => unknown;
  customErrorObject: (req: unknown, res: unknown, error: unknown, value: unknown) => unknown;
  customErrorMessage: (req: unknown, res: unknown, error: unknown) => string;
};
it.each([400, 401, 403, 404, 422, 500])("hides malformed/rejected cost-routing payloads from %s logs", statusCode => {
  for (const url of ["/api/companies/company/cost-routing/policy", "/api/companies/company/cost-routing/previews/invalid",
    "https://host/API/companies/company/COST-ROUTING/unknown?raw=secret-query"]) {
    const body = { model: "secret-model-canary", config: { token: "secret-key-canary" }, receipt: "secret-source-url-canary" };
    const error = new Error(JSON.stringify(body)), req = { method: "POST", url, body, headers: { custom: "secret-header-canary" } };
    expect(isPrivateIntegrationHttpRequest(url)).toBe(true); expect(isSecretSensitiveHttpRequest("GET", url)).toBe(true);
    for (const res of [{ statusCode }, { statusCode, __errorContext: { reqBody: body, error }, err: error }]) {
      const props = options.customProps(req, res); expect(props).toMatchObject({ reqBody: "[REDACTED]" });
      const logged = JSON.stringify([props, options.serializers.req(req), options.customErrorObject(req, res, error, { err: error }), options.customErrorMessage(req, res, error)]);
      for (const canary of ["secret-model-canary", "secret-key-canary", "secret-source-url-canary", "secret-query", "secret-header-canary"]) expect(logged).not.toContain(canary);
    }
  }
});
it("does not classify a lookalike unrelated namespace as cost-routing", () => {
  expect(isPrivateIntegrationHttpRequest("/api/companies/company/cost-routing-public")).toBe(false);
});
