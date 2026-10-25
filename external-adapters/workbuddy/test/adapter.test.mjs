import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../index.mjs";
const ctx = () => ({ runId: "run", authToken: "fixture", config: { connectionId: "connection" }, agent: { companyId: "company" }, runtime: { sessionParams: null, taskKey: "task" }, context: { prompt: "research" }, onLog: async () => {} });
process.env.PAPERCLIP_API_URL = "https://app.example/api";
test("created remote task is not reported as completed", async () => {
  const result = await execute(ctx(), async () => Response.json({ id: "job", providerJobId: "remote", dispatchState: "created", remoteState: "working", report: "" }));
  assert.equal(result.exitCode, 1); assert.equal(result.sessionParams.jobId, "job");
});
test("resume queries the durable job instead of creating another", async () => {
  const input = ctx();
  const first = await execute(input, async () => Response.json({ id: "job", remoteState: "working", report: "" }));
  input.runtime.sessionParams = first.sessionParams; let called;
  const result = await execute(input, async url => { called = String(url); return Response.json({ id: "job", remoteState: "completed", report: "Verified report" }); });
  assert.ok(called.endsWith("/jobs/job/refresh")); assert.equal(result.exitCode, 0);
});
test("rejects a different account/session binding before any request", async () => {
  const input = ctx(); input.runtime.sessionParams = { jobId: "job", companyId: "other", connectionId: "connection" };
  const result = await execute(input, async () => { throw Error("must not dispatch"); }); assert.equal(result.errorCode, "workbuddy_session_identity_mismatch");
});

test("lost creation response keeps the same request key across new run IDs", async () => {
  const first = ctx(); let keyOne;
  const lost = await execute(first, async (_url, init) => { keyOne = JSON.parse(init.body).requestKey; throw Error("lost"); });
  const second = ctx(); second.runId = "different-run"; second.runtime.sessionParams = lost.sessionParams; let keyTwo;
  await execute(second, async (_url, init) => { keyTwo = JSON.parse(init.body).requestKey; return Response.json({ id: "job", remoteState: "unknown", dispatchState: "indeterminate" }); });
  assert.equal(keyOne, keyTwo);
});
test("provider completion with stale report diagnostics is not a successful run", async () => {
  for (const extra of [{ report: "old report", lastCode: "artifact_http_401" }, { report: "", lastCode: null }]) {
    const result = await execute(ctx(), async () => Response.json({ id: "job", dispatchState: "created", remoteState: "completed", ...extra }));
    assert.equal(result.exitCode, 1); assert.equal(result.resultJson.businessCompleted, false);
  }
});
