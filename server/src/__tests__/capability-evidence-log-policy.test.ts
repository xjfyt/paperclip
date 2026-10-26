import { expect, it, vi } from "vitest";
vi.mock("pino", () => ({ default: Object.assign(() => ({}), { transport: () => ({}) }) }));
vi.mock("pino-http", () => ({ pinoHttp: (options: unknown) => options }));
import { createHttpLogger } from "../middleware/logger.js";
import { isPrivateIntegrationHttpRequest } from "../middleware/http-log-policy.js";
const options = createHttpLogger({} as never) as unknown as {
  customProps: (req: unknown, res: unknown) => unknown;
  customErrorObject: (req: unknown, res: unknown, error: unknown, value: unknown) => unknown;
};
it.each([400, 403, 422])("omits alias payloads from %s diagnostics before or after validation", statusCode => {
  for (const url of ["/api/companies/company/capability-evidence", "https://host/API/companies/company/capability-evidence?ignored=value"]) {
    const body = { receipt: { sourceResourceId: "private-source-secret", accountAlias: "private-account-secret" } };
    const error = new Error(JSON.stringify(body));
    const req = { method: "POST", url, body };
    expect(isPrivateIntegrationHttpRequest(url)).toBe(true);
    for (const res of [{ statusCode }, { statusCode, __errorContext: { reqBody: body, error }, err: error }]) {
      const props = options.customProps(req, res);
      expect(props).toMatchObject({ reqBody: "[REDACTED]" });
      const logged = JSON.stringify([props, options.customErrorObject(req, res, error, { err: error })]);
      expect(logged).not.toContain("private-source-secret"); expect(logged).not.toContain("private-account-secret");
    }
  }
});
