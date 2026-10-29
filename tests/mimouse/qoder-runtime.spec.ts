import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { agents, companies, issues, heartbeatRuns } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));

test(process.platform === "win32" ? "registered Qoder adapter refuses unsupported Windows readiness and execution before dispatch" : "real Paperclip task dispatch uses the registered Qoder adapter with a fake CLI", async ({ request }) => {
  test.setTimeout(90000);
  if (process.platform === "win32") {
    const root = await mkdtemp(path.join(os.tmpdir(), "pqa-"));
    const config = { executablePath: path.join(root, "must-not-execute.exe"), cwd: root, configRoot: path.join(root, "must-not-create"), accountId: "fixture-account", allowHelloProbe: true };
    const installed = await request.post("/api/adapters/install", { data: { packageName: path.resolve(import.meta.dirname, "../../external-adapters/qoder-cn"), isLocalPath: true } });
    expect(installed.status(), await installed.text()).toBe(201);
    const response = await request.post("/api/companies", { data: { name: "Qoder Windows refusal fixture" } });
    expect(response.ok()).toBe(true); const company = await response.json();
    const tested = await request.post(`/api/companies/${company.id}/adapters/qoder_cn/test-environment`, { data: { adapterConfig: config } });
    expect(tested.ok(), await tested.text()).toBe(true);
    const readiness = await tested.json();
    expect(readiness).toMatchObject({ adapterType: "qoder_cn", status: "fail" });
    expect(readiness.checks).toEqual(expect.arrayContaining([expect.objectContaining({ code: "qoder_platform_unverified", level: "error" })]));
    const { execute } = await import("../../external-adapters/qoder-cn/index.mjs");
    let spawned = false;
    const result = await execute({ config, onSpawn: () => { spawned = true; } });
    expect(result).toMatchObject({ exitCode: 1, errorCode: "qoder_platform_unverified" });
    expect(spawned).toBe(false);
    await expect(stat(config.configRoot)).rejects.toMatchObject({ code: "ENOENT" });
    const db = await createFixtureDb(); try {
      expect(await db.select().from(agents).where(eq(agents.companyId, company.id))).toHaveLength(0);
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, company.id))).toHaveLength(0);
    } finally { await db.$client.end({ timeout: 1 }); }
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-qoder-e2e-")); const receipts = path.join(root, "receipts"); await mkdir(receipts);
  const executable = path.join(root, "fake-qodercn.mjs");
  await writeFile(executable, `#!/usr/bin/env node\nimport {writeFileSync} from "node:fs";import path from "node:path";\nif(process.argv.includes("--version")){console.log("fixture 1");process.exit(0)}\nif(process.argv.includes("--help")){console.log("--output-format --config-dir --settings --max-turns --resume");process.exit(0)}\nconst diagnostic=process.argv.at(-1).match(/PAPERCLIP_QODER_[a-zA-Z0-9_]+/);if(diagnostic){console.log(JSON.stringify({type:"result",result:diagnostic[0]}));process.exit(0)}\nwriteFileSync(path.join(${JSON.stringify(receipts)},process.env.PAPERCLIP_RUN_ID+".json"),JSON.stringify({companyId:process.env.PAPERCLIP_COMPANY_ID,agentId:process.env.PAPERCLIP_AGENT_ID,runId:process.env.PAPERCLIP_RUN_ID,cwd:process.cwd()}));\nconsole.log(JSON.stringify({type:"system",session_id:"fixture-session"}));console.log(JSON.stringify({type:"result",session_id:"fixture-session",result:"受控假 CLI 完成；没有调用模型",total_credits:1}));\n`, { mode: 0o755 });
  const installed = await request.post("/api/adapters/install", { data: { packageName: path.resolve(import.meta.dirname, "../../external-adapters/qoder-cn"), isLocalPath: true } });
  expect(installed.status(), await installed.text()).toBe(201); expect((await installed.json()).type).toBe("qoder_cn");
  const company = await (await request.post("/api/companies", { data: { name: `Qoder runtime fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb(); let agentId: string | undefined;
  try {
    await db.update(companies).set({ requireBoardApprovalForNewAgents: false }).where(eq(companies.id, company.id));
    const created = await request.post(`/api/companies/${company.id}/agents`, { data: { name: "Qoder fixture only", role: "qa", adapterType: "qoder_cn", adapterConfig: { executablePath: executable, cwd: root, configRoot: path.join(root, "config"), accountId: "fixture-account", allowHelloProbe: true, timeoutSec: 5, maxTurns: 2 }, runtimeConfig: { heartbeat: { enabled: false } }, desiredSkills: [] } });
    expect(created.status(), await created.text()).toBe(201); const agent = await created.json(); agentId = agent.id;
    const issued = await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Controlled Qoder runtime fixture", status: "backlog", assigneeAgentId: null } }); expect(issued.ok(), await issued.text()).toBe(true); const issue = await issued.json();
    await db.update(issues).set({ status: "todo", assigneeAgentId: agent.id }).where(eq(issues.id, issue.id));
    const invoked = await request.post(`/api/agents/${agent.id}/heartbeat/invoke`, { data: { reason: "mimouse_fixture", payload: { issueId: issue.id, taskId: issue.id } } });
    expect(invoked.status(), await invoked.text()).toBe(202); const queued = await invoked.json(); expect(typeof queued.id).toBe("string");
    let finished: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request.get(`/api/heartbeat-runs/${queued.id}`); expect(response.ok()).toBe(true); finished = await response.json();
      if (!["queued", "running"].includes(finished.status)) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    expect(finished.status, JSON.stringify({ status: finished.status, error: finished.error, errorCode: finished.errorCode })).toBe("succeeded");
    const receipt = JSON.parse(await readFile(path.join(receipts, `${queued.id}.json`), "utf8")); expect(receipt).toMatchObject({ companyId: company.id, agentId: agent.id, runId: queued.id }); expect(path.isAbsolute(receipt.cwd)).toBe(true);
    expect(finished.resultJson?.providerStopped).toBe(true);
  } finally {
    if (agentId) { await request.post(`/api/agents/${agentId}/pause`, { data: {} }); await db.update(agents).set({ status: "paused" }).where(eq(agents.id, agentId)); }
    await db.$client.end({ timeout: 1 });
  }
});
