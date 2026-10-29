import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandArgs, execute, sessionIdentity, sessionCodec, createServerAdapter } from "../index.mjs";
import { resultAccounting, parseEvent } from "../parse.mjs";
const posixTest = (name, run) => test(name, { skip: process.platform === "win32" ? "Qoder execution is explicitly unsupported on Windows; POSIX process-group and permission contract required." : false }, run);

async function fixture(script) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qoder-fixture-"));
  const executable = path.join(root, "qodercn");
  await writeFile(executable, `#!/usr/bin/env node\n${script}\n`, { mode: 0o755 });
  const logs = [], spawned = [], stopped = [];
  return { root, logs, spawned, stopped, ctx: {
    runId: "run-one", agent: { companyId: "company", id: "agent", name: "Test" },
    runtime: { sessionParams: null, taskKey: "task" }, context: { prompt: "请修复 fixture" },
    config: { executablePath: executable, cwd: root, configRoot: path.join(root, "config"), accountId: "user", timeoutSec: 3 },
    onLog: async (stream, chunk) => logs.push([stream, chunk]), onSpawn: async meta => spawned.push(meta), onProviderStopped: async () => stopped.push(true),
  } };
}
test("argv keeps prompts separate and never skips permissions", () => {
  const args = commandArgs({}, "session-one", "--yolo; echo evil");
  assert.equal(args.at(-1), "--yolo; echo evil"); assert.equal(args.at(-2), "--");
  assert.ok(args.includes("--resume")); assert.ok(!args.includes("--continue"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "default");
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { general: { enableAutoUpdate: false } });
});
test("identity fences company, account, workspace and task", () => {
  const value = { companyId: "c", agentId: "a", cwd: "/one", accountId: "u", taskKey: "t" };
  for (const key of Object.keys(value)) assert.notEqual(sessionIdentity(value), sessionIdentity({ ...value, [key]: "other" }));
  assert.equal(sessionCodec.deserialize({ sessionId: "s", identity: "bad" }), null);
});
test("missing credits are unknown and cumulative credits never become USD", () => {
  assert.equal(resultAccounting({}).costUsd, null); assert.equal(resultAccounting({}).creditsCumulative, undefined);
  assert.equal(resultAccounting({ total_credits: 5 }).creditsCumulative, 5);
  assert.equal(resultAccounting({ total_credits: 5 }).costStatus, "unpriced");
  assert.equal(resultAccounting({ usage: { input_tokens: 10, output_tokens: 2 } }).usage, undefined);
  assert.equal(parseEvent("bad json"), null);
});
posixTest("real child streaming preserves Unicode, session and spawn receipt", async () => {
  const f = await fixture(`console.log(JSON.stringify({type:"system",session_id:"s1"})); console.log(JSON.stringify({type:"result",session_id:"s1",result:"完成中文任务",total_credits:2}));`);
  const result = await execute(f.ctx);
  assert.equal(result.exitCode, 0); assert.equal(result.summary, "完成中文任务");
  assert.equal(result.sessionParams.sessionId, "s1"); assert.equal(f.spawned.length, 1); assert.equal(f.stopped.length, 1);
  assert.ok(f.logs.some(([,line]) => line.includes("完成中文任务")));
});
posixTest("session reuse rejects a changed account before dispatch", async () => {
  const f = await fixture(`console.log(JSON.stringify({type:"result",session_id:"s",result:"ok"}));`);
  const first = await execute(f.ctx); f.ctx.runtime.sessionParams = first.sessionParams; f.ctx.config.accountId = "another";
  const result = await execute(f.ctx); assert.equal(result.errorCode, "qoder_session_identity_mismatch"); assert.equal(f.spawned.length, 1);
});
posixTest("pre-abort never dispatches", async () => {
  const f = await fixture("process.exit(0)"); f.ctx.signal = AbortSignal.abort();
  assert.equal((await execute(f.ctx)).errorCode, "qoder_cancelled_before_dispatch"); assert.equal(f.spawned.length, 0);
});
posixTest("timeout terminates a real process and is never success", async () => {
  const f = await fixture("setInterval(()=>{},100)"); f.ctx.config.timeoutSec = .1;
  const result = await execute(f.ctx); assert.equal(result.timedOut, true); assert.notEqual(result.exitCode, 0); assert.equal(f.stopped.length, 1);
});
posixTest("split stderr secrets are redacted before logging", async () => {
  const f = await fixture(`process.stderr.write("test-sec"); setTimeout(()=>{process.stderr.write("ret\\n");console.log(JSON.stringify({type:"result",result:"ok"}));},20)`);
  f.ctx.config.env = { QODERCN_PERSONAL_ACCESS_TOKEN: "test-secret" };
  await execute(f.ctx); const text = f.logs.map(([,s])=>s).join(""); assert.ok(!text.includes("test-secret")); assert.ok(text.includes("[REDACTED]"));
});
posixTest("missing terminal receipt cannot be success", async () => {
  const f = await fixture("console.log('just text')"); assert.notEqual((await execute(f.ctx)).exitCode, 0);
});
test("factory exposes config and test-environment protocol", async () => {
  const f = await fixture(`console.log(process.argv.includes("--version")?"fixture 1":"--output-format --config-dir --settings --max-turns --resume")`);
  const module = createServerAdapter(); assert.equal(module.type, "qoder_cn"); assert.ok(module.getConfigSchema().fields.length);
  const readiness = await module.testEnvironment({config:f.ctx.config});
  assert.equal(readiness.status, process.platform === "win32" ? "fail" : "warn");
  if (process.platform === "win32") {
    assert.deepEqual(readiness.checks.map(check => check.code), ["qoder_platform_unverified"]);
    assert.equal((await execute(f.ctx)).errorCode, "qoder_platform_unverified");
    assert.equal(f.spawned.length, 0); assert.equal(f.logs.length, 0); assert.equal(f.stopped.length, 0);
    await assert.rejects(stat(f.ctx.config.configRoot), { code: "ENOENT" });
  }
});
posixTest("missing task identity refuses dispatch and issue context is a stable fallback", async () => {
  const f = await fixture(`console.log(JSON.stringify({type:"result",session_id:"s",result:"ok"}));`);
  f.ctx.runtime.taskKey = null;
  assert.equal((await execute(f.ctx)).errorCode, "qoder_task_context_required"); assert.equal(f.spawned.length, 0);
  f.ctx.context.issueId = "issue-one";
  const first = await execute(f.ctx); assert.equal(first.exitCode, 0); f.ctx.runtime.sessionParams = first.sessionParams; f.ctx.context.issueId = "issue-two";
  assert.equal((await execute(f.ctx)).errorCode, "qoder_session_identity_mismatch"); assert.equal(f.spawned.length, 1);
});

posixTest("diagnostics recognize the official hidden turn limit without running a task", async () => {
  const f = await fixture(`if(process.argv.includes("paperclip-invalid-limit")){console.error("error: option '--max-turns <count>' argument 'paperclip-invalid-limit' is invalid. --max-turns must be a non-negative integer (0 disables the limit)");process.exit(1)}console.log(process.argv.includes("--version")?"fixture 1":"--output-format --config-dir --settings --resume")`);
  assert.equal((await createServerAdapter().testEnvironment({ config: f.ctx.config })).status, "warn"); assert.equal(f.spawned.length, 0);
});
posixTest("timeout stops a real descendant process group before releasing its session", async () => {
  const f = await fixture(`const {spawn}=await import("node:child_process");const {writeFileSync}=await import("node:fs");let stopping=false;const child=spawn(process.execPath,["-e","setInterval(()=>{},100)"],{stdio:"ignore"});child.on("exit",()=>{writeFileSync("child-stopped","yes");if(stopping)process.exit(0)});process.on("SIGTERM",()=>{stopping=true;if(child.exitCode!==null||child.signalCode!==null)process.exit(0)});setInterval(()=>{},100);`);
  f.ctx.config.timeoutSec = .2; const result = await execute(f.ctx);
  assert.equal(result.timedOut, true); assert.notEqual(result.exitCode, 0); assert.equal(result.resultJson.providerStopped, true); assert.equal(await readFile(path.join(f.root,"child-stopped"),"utf8"), "yes");
});
posixTest("an opt-in hello probe earns readiness only after a bounded nonce response", async () => {
  const f = await fixture(`if(process.argv.includes("--version")){console.log("fixture 1");process.exit(0)}if(process.argv.includes("--help")){console.log("--output-format --config-dir --settings --max-turns --resume");process.exit(0)}const nonce=process.argv.at(-1).match(/PAPERCLIP_QODER_[a-zA-Z0-9_]+/)[0];console.log(JSON.stringify({type:"result",result:nonce}));`);
  const result = await createServerAdapter().testEnvironment({ companyId: "company", config: { ...f.ctx.config, allowHelloProbe: true } });
  assert.ok(result.checks.some(check => check.code === "qoder_hello_probe_passed")); assert.equal(result.status, "warn");
  const args = commandArgs({maxTurns:1}, null, "probe", true); assert.equal(args[args.indexOf("--tools")+1], ""); assert.ok(args.includes("--strict-mcp-config")); assert.ok(args.includes("--no-session-persistence"));
});
posixTest("changing a PAT fences session reuse even if its account label is unchanged", async () => {
  const f = await fixture(`console.log(JSON.stringify({type:"result",session_id:"s",result:"ok"}));`); f.ctx.config.env = { QODERCN_PERSONAL_ACCESS_TOKEN: "fixture-one" };
  const first = await execute(f.ctx); f.ctx.runtime.sessionParams = first.sessionParams; f.ctx.config.env.QODERCN_PERSONAL_ACCESS_TOKEN = "fixture-two";
  assert.equal((await execute(f.ctx)).errorCode, "qoder_session_identity_mismatch"); assert.equal(f.spawned.length, 1);
});

posixTest("new account configuration directories are owner-only", async () => {
  const f = await fixture(`console.log(JSON.stringify({type:"result",session_id:"s",result:"ok"}));`);
  const result = await execute(f.ctx); assert.equal(result.exitCode, 0);
  const folder = path.join(f.ctx.config.configRoot, result.sessionParams.identity);
  assert.equal((await stat(folder)).mode & 0o077, 0);
});
posixTest("shared or symlinked account directories refuse dispatch without changing permissions", async () => {
  for (const variant of ["shared", "symlink"]) {
    const f = await fixture(`process.exit(99)`);
    const identity = sessionIdentity({companyId:"company", agentId:"agent", cwd:f.root, accountId:"user", taskKey:"task"});
    const folder = path.join(f.ctx.config.configRoot, identity);
    await mkdir(f.ctx.config.configRoot, {recursive:true});
    if (variant === "shared") await mkdir(folder, {mode:0o755});
    else await symlink(f.root, folder);
    assert.equal((await execute(f.ctx)).errorCode, "qoder_config_not_private"); assert.equal(f.spawned.length, 0);
    if (variant === "shared") assert.notEqual((await stat(folder)).mode & 0o077, 0);
  }
});
