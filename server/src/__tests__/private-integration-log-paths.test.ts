import { expect, it, vi } from "vitest";
vi.mock("pino", () => ({ default: Object.assign(() => ({}), { transport: () => ({}) }) }));
vi.mock("pino-http", () => ({ pinoHttp: (options: unknown) => options }));
import { createHttpLogger } from "../middleware/logger.js";
import { privateIntegrationHttpLogUrl } from "../middleware/http-log-policy.js";
const options = createHttpLogger({} as never) as unknown as {
  serializers: { req: (req: unknown) => unknown };
  customSuccessMessage: (req: unknown, res: unknown) => string;
  customErrorMessage: (req: unknown, res: unknown, error: unknown) => string;
  customProps: (req: unknown, res: unknown) => unknown;
  customErrorObject: (req: unknown, res: unknown, error: unknown, value: unknown) => unknown;
};
const namespaces = ["feedback-wecom", "cost-routing", "capability-evidence", "notifications", "coding", "feedback-inbox", "feedback-langfuse", "data-operations", "research-candidates", "research-routines", "skill-evaluations", "prompt-registry", "integrations/workbuddy", "agent-commentary"];
const canaries = ["COMPANY_CANARY", "PATH_CANARY", "QUERY_CANARY", "BODY_CANARY", "ERROR_CANARY", "HEADER_CANARY", "HOST_CANARY"];
it.each(namespaces)("keeps only static %s namespace in every request logging surface", namespace => {
  const path = `/api/companies/COMPANY_CANARY/${namespace}/PATH_CANARY/%2F..%2FPATH_CANARY?beforeId=QUERY_CANARY`;
  for (const url of [path, path.toUpperCase(), `https://HOST_CANARY${path}`, `HTTPS://HOST_CANARY${path.toUpperCase()}`]) {
    for (const statusCode of [200, 400, 403, 404, 422, 500]) {
      const error = new Error("ERROR_CANARY");
      const req = { id: 1, method: "POST", url, originalUrl: url, body: { text: "BODY_CANARY" }, params: { id: "PATH_CANARY" }, query: { beforeId: "QUERY_CANARY" }, headers: { arbitrary: "HEADER_CANARY" } };
      const res = { statusCode, err: error, __errorContext: { reqBody: req.body, error } };
      const projected = options.serializers.req(req);
      const output = JSON.stringify([projected, options.customSuccessMessage(req, res), options.customErrorMessage(req, res, error), options.customProps(req, res), options.customErrorObject(req, res, error, { err: error })]);
      for (const canary of canaries) expect(output).not.toContain(canary);
      expect(projected).toEqual({ id: 1, method: "POST", url: `/api/companies/:companyId/${namespace}/:redacted` });
      // Express may temporarily rewrite url while originalUrl remains authoritative.
      expect(options.customErrorMessage({ ...req, url: "/PATH_CANARY" }, res, error)).toContain(`/api/companies/:companyId/${namespace}/:redacted`);
    }
  }
});
it("redacts malformed tails before URL dot-segment normalization and accepts a namespace without a tail", () => {
  for (const suffix of ["", "/../../PATH_CANARY", "/%ZZPATH_CANARY", "?key=QUERY_CANARY"]) {
    expect(privateIntegrationHttpLogUrl(`https://HOST_CANARY/api/companies/COMPANY_CANARY/prompt-registry${suffix}`))
      .toBe("/api/companies/:companyId/prompt-registry/:redacted");
  }
});
it("does not misclassify namespace-prefix lookalikes or change ordinary diagnostics", () => {
  expect(privateIntegrationHttpLogUrl("/api/companies/id/prompt-registry-other/route")).toBeNull();
  expect(options.serializers.req({ id: 1, method: "GET", url: "/api/health?key=QUERY_CANARY" }))
    .toMatchObject({ url: "/api/health" });
});
