import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, mkdir, open, unlink, mkdtemp, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parseEvent, resultAccounting } from "./parse.mjs";
const exec = promisify(execFile);
const pinnedSettings = JSON.stringify({ general: { enableAutoUpdate: false } });
export const type = "qoder_cn";
export const label = "Qoder CN";
export const capabilities = Object.freeze({ localExecution: "contract_tested", remoteExecution: "unsupported", sessionResume: "contract_tested", confirmedCancellation: "unknown", toolApproval: "unsupported", workspaceRoundTrip: "unsupported", usageReporting: "contract_tested", liveVerified: false });
const nonempty = value => typeof value === "string" && value.trim() ? value.trim() : null;
export function sessionIdentity({ companyId, agentId, cwd, accountId, taskKey, credentialFingerprint = null }) {
  return createHash("sha256").update(JSON.stringify([companyId, agentId, cwd, accountId, taskKey, credentialFingerprint])).digest("hex");
}
export function commandArgs(config, session, prompt, diagnostic = false) {
  const maxTurns = config.maxTurns ?? 20;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw Error("maxTurns must be 1..100");
  const args = ["--settings", pinnedSettings, "--output-format", "stream-json", "--max-turns", String(maxTurns), "--permission-mode", "default"];
  if (session) args.push("--resume", session);
  if (nonempty(config.model)) args.push("--model", config.model);
  if (config.allowedTools !== undefined) {
    if (!Array.isArray(config.allowedTools) || config.allowedTools.some(tool => !nonempty(tool) || tool.startsWith("-"))) throw Error("allowedTools must be a list of tool names");
    args.push("--allowed-tools", config.allowedTools.join(","));
  }
  if (diagnostic) args.push("--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--max-output-tokens", "64", "--max-model-request-retries", "0");
  // -- separates untrusted prompt text from options; never invoke a shell.
  args.push("-p", "--", prompt);
  return args;
}
export const sessionCodec = {
  deserialize(raw) {
    return raw && typeof raw === "object" && nonempty(raw.sessionId) && /^[a-f0-9]{64}$/.test(raw.identity)
      ? { sessionId: raw.sessionId, identity: raw.identity } : null;
  },
  serialize(raw) { return this.deserialize(raw); },
  getDisplayId(raw) { return nonempty(raw?.sessionId); },
};
export async function execute(ctx, diagnostic = false) {
  const failure = (code, message) => ({ exitCode: 1, signal: null, timedOut: false, errorCode: code, errorMessage: message });
  const config = ctx.config;
  if (process.platform === "win32") return failure("qoder_platform_unverified", "Windows process-tree cancellation is not qualified; use a Linux worker.");
  if (ctx.executionTarget && ctx.executionTarget.kind !== "local" || ctx.executionTransport?.remoteExecution) return failure("qoder_remote_unsupported", "Qoder CN adapter only supports a local execution workspace.");
  if (ctx.signal?.aborted) return failure("qoder_cancelled_before_dispatch", "Cancelled before dispatch.");
  const taskKey = nonempty(ctx.runtime.taskKey) || nonempty(ctx.context.taskId) || nonempty(ctx.context.issueId);
  if (!taskKey) return failure("qoder_task_context_required", "A stable task identity is required for isolated session reuse.");
  const rawCwd = ctx.context.paperclipWorkspace?.cwd || config.cwd;
  if (!nonempty(rawCwd) || !path.isAbsolute(rawCwd)) return failure("qoder_workspace_required", "An absolute assigned workspace is required.");
  if (!nonempty(config.accountId) || !nonempty(config.configRoot) || !path.isAbsolute(config.configRoot)) return failure("qoder_identity_required", "Set accountId and an absolute configRoot for isolated identities.");
  const cwd = await realpath(rawCwd);
  const providerToken = nonempty(config.env?.QODERCN_PERSONAL_ACCESS_TOKEN);
  const credentialFingerprint = providerToken ? createHash("sha256").update(providerToken).digest("hex") : null;
  const identity = sessionIdentity({ companyId: ctx.agent.companyId, agentId: ctx.agent.id, cwd, accountId: config.accountId, taskKey, credentialFingerprint });
  const configDir = path.join(config.configRoot, identity);
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const configStat = await lstat(configDir);
  if (!configStat.isDirectory() || configStat.isSymbolicLink() || (configStat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && configStat.uid !== process.getuid())) {
    return failure("qoder_config_not_private", "Use an owner-only configuration directory without symlinks; existing permissions are not changed automatically.");
  }
  const lockPath = path.join(configDir, "paperclip-run.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); await lock.writeFile(JSON.stringify({ runId: ctx.runId, createdAt: new Date().toISOString() })); }
  catch (error) { if (error.code === "EEXIST") return failure("qoder_session_busy", "Session is in use or has an unreconciled lock; verify previous provider termination before recovery."); throw error; }
  let releaseLock = true;
  try {
    const previous = sessionCodec.deserialize(ctx.runtime.sessionParams);
    if (previous && previous.identity !== identity) return failure("qoder_session_identity_mismatch", "Refusing to resume a session from another identity, task or workspace.");
    const prompt = nonempty(ctx.context.prompt) || nonempty(config.promptTemplate) || `Work on the assigned Paperclip task ${ctx.context.taskId ?? ctx.context.issueId ?? ""}. Follow its acceptance criteria. Report results; do not publish or change branches without explicit authorization.`;
    const args = ["--config-dir", configDir, ...commandArgs(config, previous?.sessionId, prompt, diagnostic)];
    const env = {};
    for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) if (process.env[key]) env[key] = process.env[key];
    const configuredEnv = config.env && typeof config.env === "object" ? config.env : {};
    // Deliberate allowlist: never inherit every server credential into the CLI.
    if (nonempty(configuredEnv.QODERCN_PERSONAL_ACCESS_TOKEN)) env.QODERCN_PERSONAL_ACCESS_TOKEN = configuredEnv.QODERCN_PERSONAL_ACCESS_TOKEN;
    Object.assign(env, { CI: "1", NO_COLOR: "1", PAPERCLIP_RUN_ID: ctx.runId, PAPERCLIP_AGENT_ID: ctx.agent.id, PAPERCLIP_COMPANY_ID: ctx.agent.companyId });
    if (ctx.authToken) env.PAPERCLIP_API_KEY = ctx.authToken;
    if (process.env.PAPERCLIP_API_URL) env.PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL;
    const secrets = [env.QODERCN_PERSONAL_ACCESS_TOKEN, ctx.authToken].filter(Boolean);
    const redact = text => secrets.reduce((value, secret) => value.split(secret).join("[REDACTED]"), text);
    const timeoutSec = config.timeoutSec ?? 600;
    if (!Number.isFinite(timeoutSec) || timeoutSec <= 0 || timeoutSec > 3600) throw Error("timeoutSec must be >0 and <=3600");
    let bytes = 0, stderrBuffer = "", processClosed = false;
    let finalEvent = null, sessionId = previous?.sessionId ?? null, timedOut = false, cancelled = false;
    let buffer = "", queue = Promise.resolve(), logError = null, processError = null;
    const command = nonempty(config.executablePath) || "qodercn";
    await ctx.onMeta?.({ adapterType: type, command, cwd, commandNotes: ["Qoder CN; isolated config; no shell; default permission mode"], commandArgs: args.slice(0, -1).concat("<prompt>") });
    releaseLock = false;
    const child = spawn(command, args, { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const signal = name => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name); else child.kill(name); }
      catch (error) { if (error.code !== "ESRCH") processError = error; }
    };
    let killTimer;
    const stop = () => { cancelled = true; if (processClosed) return; signal("SIGTERM"); killTimer ??= setTimeout(() => signal("SIGKILL"), 1000); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutSec * 1000);
    const enqueue = action => { queue = queue.then(action).catch(error => { logError = error; stop(); }); };
    child.once("spawn", () => {
      enqueue(() => ctx.onSpawn?.({ pid: child.pid, processGroupId: process.platform !== "win32" ? child.pid : null, startedAt: new Date().toISOString() }));
      if (ctx.signal?.aborted) stop();
    });
    ctx.signal?.addEventListener("abort", stop, { once: true });
    const consume = line => {
      const event = parseEvent(line);
      if (nonempty(event?.session_id)) sessionId = event.session_id;
      if (event?.type === "result") finalEvent = event;
      enqueue(() => ctx.onLog("stdout", redact(line + "\n")));
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) { processError = Error("Qoder output budget exceeded"); stop(); return; }
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1048576) { processError = Error("Qoder output line exceeds 1 MiB"); stop(); buffer = ""; return; }
      let index; while ((index = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    });
    child.stderr.on("data", chunk => {
      bytes += Buffer.byteLength(chunk); stderrBuffer += chunk;
      if (bytes > 8 * 1024 * 1024 || Buffer.byteLength(stderrBuffer) > 1048576) { processError = Error("Qoder output budget exceeded"); stderrBuffer = ""; stop(); return; }
      let index; while ((index = stderrBuffer.indexOf("\n")) >= 0) {
        const line = stderrBuffer.slice(0, index + 1); stderrBuffer = stderrBuffer.slice(index + 1);
        enqueue(() => ctx.onLog("stderr", redact(line)));
      }
    });
    child.on("error", error => { processError = error; });
    const closed = await new Promise(resolve => child.once("close", (exitCode, exitSignal) => resolve({ exitCode, signal: exitSignal })));
    processClosed = true;
    clearTimeout(timer); clearTimeout(killTimer); ctx.signal?.removeEventListener("abort", stop);
    if (buffer) consume(buffer);
    if (stderrBuffer) enqueue(() => ctx.onLog("stderr", redact(stderrBuffer)));
    await queue;
    // A closed parent does not prove its process tree stopped. Do not advertise
    // strong cancellation or call onProviderStopped without group-stop evidence.
    const groupIsStopped = () => {
      if (process.platform === "win32" || !child.pid) return false;
      try { process.kill(-child.pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
    };
    let groupStopped = groupIsStopped();
    if (child.pid && !groupStopped) {
      signal("SIGTERM");
      for (let attempt = 0; attempt < 20 && !groupStopped; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (attempt === 9) signal("SIGKILL");
        groupStopped = groupIsStopped();
      }
    }
    releaseLock = groupStopped || !child.pid;
    if (groupStopped) await ctx.onProviderStopped?.();
    const success = groupStopped && closed.exitCode === 0 && finalEvent && !finalEvent.is_error && !cancelled && !processError && !logError;
    const accounting = resultAccounting(finalEvent);
    return {
      exitCode: success ? 0 : closed.exitCode || 1, signal: closed.signal, timedOut,
      ...accounting, provider: "qoder-cn",
      ...(sessionId ? { sessionParams: { sessionId, identity }, sessionDisplayId: sessionId } : {}),
      summary: typeof finalEvent?.result === "string" ? redact(finalEvent.result) : null,
      resultJson: { creditsCumulative: accounting.creditsCumulative ?? null, creditsBasis: "session_cumulative", providerStopped: groupStopped, tokenUsage: accounting.tokenUsage ?? null, tokenUsageScope: "unverified", verification: capabilities },
      ...(!success ? { errorCode: cancelled ? "qoder_cancelled" : "qoder_execution_failed", errorMessage: redact(processError?.message || logError?.message || (finalEvent?.is_error ? "Qoder reported failure" : "Qoder did not produce a successful terminal result")) } : {}),
    };
  } finally { await lock.close(); if (releaseLock) await unlink(lockPath); }
}
export async function testEnvironment(ctx) {
  const checks = [];
  if (process.platform === "win32") return { adapterType: type, status: "fail", testedAt: new Date().toISOString(), checks: [{ code: "qoder_platform_unverified", level: "error", message: "Windows process-tree cancellation is not qualified; use a Linux worker." }] };
  if (ctx.executionTarget && ctx.executionTarget.kind !== "local") return { adapterType: type, status: "fail", testedAt: new Date().toISOString(), checks: [{ code: "qoder_remote_unsupported", level: "error", message: "Qoder CN readiness is only qualified for the local execution target." }] };
  try {
    const command = nonempty(ctx.config.executablePath) || "qodercn";
    const env = {};
    for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "LANG", "TEMP", "TMP", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { CI: "1", NO_COLOR: "1", DO_NOT_TRACK: "1" });
    const base = ["--settings", pinnedSettings];
    if (nonempty(ctx.config.configRoot) && path.isAbsolute(ctx.config.configRoot)) base.unshift("--config-dir", path.join(ctx.config.configRoot, "diagnostics"));
    const options = { timeout: 10000, maxBuffer: 65536, env };
    const version = await exec(command, [...base, "--version"], options);
    const help = await exec(command, [...base, "--help"], options);
    for (const flag of ["--output-format", "--config-dir", "--settings", "--resume"]) if (!help.stdout.includes(flag)) throw Error(`CLI missing ${flag}`);
    if (!help.stdout.includes("--max-turns")) {
      // Official npm 1.1.78 hides this supported option from help. A deliberately
      // invalid count exercises only argument validation, never a model query.
      let boundedTurns = false;
      try { await exec(command, [...base, "--max-turns", "paperclip-invalid-limit", "--help"], options); }
      catch (error) { boundedTurns = error.code === 1 && /option ['"]--max-turns\b/.test(error.stderr ?? "") && /argument .* is invalid/.test(error.stderr ?? "") && /--max-turns must be a non-negative integer/.test(error.stderr ?? ""); }
      if (!boundedTurns) throw Error("CLI max-turns contract not verified");
    }
    checks.push({ code: "qoder_cli", level: "info", message: `CLI found: ${version.stdout.trim().slice(0, 80)}` });
    if (ctx.config.allowHelloProbe === true) {
      if (!nonempty(ctx.config.accountId)) throw Error("A stable account identity is required");
      const scratch = await mkdtemp(path.join(tmpdir(), "paperclip-qoder-diagnostic-"));
      let providerConfirmedStopped = false;
      try {
        const nonce = `PAPERCLIP_QODER_${randomUUID().replaceAll("-", "")}`;
        const result = await execute({ runId: randomUUID(), agent: { id: "qoder-diagnostic", companyId: ctx.companyId },
          runtime: { sessionParams: null, taskKey: `diagnostic:${nonce}` }, context: { prompt: `Reply with exactly ${nonce} and nothing else.` },
          config: { ...ctx.config, cwd: scratch, configRoot: path.join(scratch, "config"), maxTurns: 1, timeoutSec: Math.min(60, Math.max(1, Number(ctx.config.helloProbeTimeoutSec ?? 30))) },
          onLog: async () => {},
        }, true);
        providerConfirmedStopped = result.resultJson?.providerStopped === true;
        if (result.exitCode !== 0 || result.summary?.trim() !== nonce || result.resultJson?.providerStopped !== true) throw Error("Diagnostic result not verified");
        checks.push({ code: "qoder_hello_probe_passed", level: "info", message: "A bounded no-tool diagnostic response was verified. This is not business-task acceptance." });
      } finally { if (providerConfirmedStopped) await rm(scratch, { recursive: true, force: true }); }
    } else checks.push({ code: "qoder_hello_probe_opt_in_required", level: "warn", message: "Lifecycle activation requires allowHelloProbe=true. It permits a minimal model request that may consume credits; version/help alone do not verify authentication." });
    checks.push({ code: "qoder_scenario_unverified", level: "warn", message: "Real workspace behavior, billing and provider cancellation still require scenario qualification." });
  } catch { checks.push({ code: "qoder_cli_unavailable", level: "error", message: "Qoder CN executable/version/help could not be verified." }); }
  return { adapterType: type, status: checks.some(check => check.level === "error") ? "fail" : "warn", checks, testedAt: new Date().toISOString() };
}
export function createServerAdapter() {
  return { type, execute, testEnvironment, sessionCodec, supportsLocalAgentJwt: true,
    getConfigSchema: () => ({ fields: [
      { key: "executablePath", label: "Qoder CN executable", type: "text", default: "qodercn" },
      { key: "accountId", label: "Account identity", type: "text", required: true },
      { key: "configRoot", label: "Isolated config root", type: "text", required: true },
      { key: "cwd", label: "Workspace", type: "text", required: true },
      { key: "maxTurns", label: "Maximum turns", type: "number", default: 20 },
      { key: "timeoutSec", label: "Timeout (seconds)", type: "number", default: 600 },
      { key: "allowHelloProbe", label: "Allow a minimal paid readiness probe", type: "toggle", default: false, hint: "Lifecycle checks may repeat a one-turn no-tool model request. Required before activation; may consume Qoder credits." },
    ] }),
    agentConfigurationDoc: "Qoder CN local CLI. Configure isolated identity, bounded workspace and secret-backed QODERCN_PERSONAL_ACCESS_TOKEN. Remote execution, dynamic tool approval and live provider cancellation are not verified.",
  };
}
