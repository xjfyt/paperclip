import { execFile, spawn } from "node:child_process";
import { lstat, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { RailwayError, type RailwaySshInput } from "./railway.js";
import { redactSensitiveText } from "../redaction.js";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";

export const RAILWAY_SSH_SECRET_PATH = "railway.ssh_private_key";

function systemOpenSsh(tool: "ssh" | "ssh-keygen") {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const directory = process.platform === "win32" ? path.join(systemRoot, "System32", "OpenSSH") : "/usr/bin";
  const executable = process.platform === "win32" ? path.join(directory, `${tool}.exe`) : `${directory}/${tool}`;
  let available = false;
  try { const entry = lstatSync(executable); available = path.isAbsolute(executable) && entry.isFile() && !entry.isSymbolicLink(); } catch { /* No ambient PATH fallback. */ }
  if (!available) throw new RailwayError("railway_ssh_unavailable", "Fixed system OpenSSH is required on this Paperclip runtime.", 422);
  return { executable, env: process.platform === "win32"
    // Win32 OpenSSH requires ProgramData even with an explicit empty config.
    ? { SystemRoot: systemRoot, WINDIR: systemRoot, ProgramData: process.env.ProgramData ?? path.join(path.parse(systemRoot).root, "ProgramData"), PATH: directory, LANG: "C.UTF-8" }
    : { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } };
}

function privateStorageError() {
  return new RailwayError("railway_ssh_private_material_unavailable", "Private temporary SSH storage could not be verified.", 422);
}
async function assertPrivateFile(file: string) {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || !hasPrivatePermissions(file, entry.mode)) throw privateStorageError();
}
function protectEmptyDirectory(directory: string) {
  try { protectNewPrivatePath(directory); } catch { throw privateStorageError(); }
}
async function writePrivateFile(file: string, contents: string) {
  const handle = await open(file, "wx", 0o600);
  try {
    // This file is new and empty. Never repair an existing path's DACL.
    protectNewPrivatePath(file);
    await assertPrivateFile(file);
    await handle.writeFile(contents);
  } finally { await handle.close(); }
  await assertPrivateFile(file);
}

export function validateRailwayKnownHosts(value: string): string {
  if (value.length > 8192) throw new RailwayError("railway_ssh_host_key_invalid", "The Railway host key is too long.", 400);
  const lines = value.trim().split(/\r?\n/);
  if (lines.length === 0 || lines.length > 5 || lines.some((line) => !/^ssh\.railway\.com (ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/]+={0,2}$/.test(line))) {
    throw new RailwayError("railway_ssh_host_key_invalid", "Paste verified known_hosts lines for ssh.railway.com only, without aliases, wildcards or comments.", 400);
  }
  return lines.join("\n") + "\n";
}

export async function generateRailwaySshKey(): Promise<{ publicKey: string; privateKey: string }> {
  const runtime = systemOpenSsh("ssh-keygen");
  const directory = await mkdtemp(path.join(tmpdir(), "paperclip-railway-key-"));
  try {
    protectEmptyDirectory(directory);
    const keyPath = path.join(directory, "identity");
    await promisify(execFile)(runtime.executable, ["-q", "-t", "ed25519", "-N", "", "-C", "paperclip-railway", "-f", keyPath], { timeout: 10_000, env: runtime.env, windowsHide: true });
    await assertPrivateFile(keyPath);
    return { publicKey: (await readFile(`${keyPath}.pub`, "utf8")).trim(), privateKey: await readFile(keyPath, "utf8") };
  } catch (error) {
    if (error instanceof RailwayError) throw error;
    throw new RailwayError("railway_ssh_unavailable", "Generating a Railway key requires system OpenSSH (ssh-keygen) on the Paperclip runtime.", 422);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function railwaySshArguments(directory: string, instanceId: string): string[] {
  if (!/^[a-f0-9-]{36}$/i.test(instanceId)) throw new RailwayError("railway_target_mismatch", "Invalid Railway container instance.", 400);
  const emptyConfig = process.platform === "win32" ? "NUL" : "/dev/null";
  const hostPath = (file: string) => process.platform === "win32" ? path.join(directory, file).replaceAll("\\", "/") : path.join(directory, file);
  return [
    "-F", emptyConfig, "-T", "-i", hostPath("identity"),
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
    "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no",
    "-o", "ControlPath=none", "-o", "PermitLocalCommand=no", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${hostPath("known_hosts")}`, "-o", `GlobalKnownHostsFile=${emptyConfig}`,
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
    "--", `${instanceId}@ssh.railway.com`, "sh -s",
  ];
}

export async function runRailwaySshCommand(input: RailwaySshInput & { privateKey: string; knownHosts: string }) {
  input.signal.throwIfAborted();
  const knownHosts = validateRailwayKnownHosts(input.knownHosts);
  if (!input.privateKey.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) throw new RailwayError("railway_ssh_key_invalid", "Regenerate the Railway connection's SSH key.", 422);
  const runtime = systemOpenSsh("ssh");
  const directory = await mkdtemp(path.join(tmpdir(), "paperclip-railway-command-"));
  try {
    protectEmptyDirectory(directory);
    await writePrivateFile(path.join(directory, "identity"), input.privateKey);
    await writePrivateFile(path.join(directory, "known_hosts"), knownHosts);
    input.signal.throwIfAborted();
    return await new Promise<{ exitCode: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }>((resolve, reject) => {
      // No developer SSH config/agent, CLI login, provider token or ambient env.
      const child = spawn(runtime.executable, railwaySshArguments(directory, input.deploymentInstanceId), { env: runtime.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "", bytes = 0, truncated = false, timedOut = false, deliveryFailed = false;
      const marker = `paperclip_railway_completed_${randomBytes(16).toString("hex")}`;
      const stop = () => { child.kill("SIGKILL"); };
      const receive = (chunk: Buffer, stream: "out" | "err") => {
        const remaining = Math.max(0, 64 * 1024 - bytes);
        bytes += chunk.length;
        const text = chunk.subarray(0, remaining).toString("utf8");
        if (stream === "out") stdout += text; else stderr += text;
        if (bytes > 64 * 1024) { truncated = true; stop(); }
      };
      child.stdout.on("data", (chunk: Buffer) => receive(chunk, "out"));
      child.stderr.on("data", (chunk: Buffer) => receive(chunk, "err"));
      const timer = setTimeout(() => { timedOut = true; stop(); }, input.timeoutSeconds * 1000);
      const abort = () => stop();
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
      const cleanup = () => { clearTimeout(timer); input.signal.removeEventListener("abort", abort); };
      child.once("error", () => { cleanup(); reject(new RailwayError("railway_ssh_unavailable", "System OpenSSH is unavailable on this Paperclip runtime.", 422)); });
      child.once("close", (exitCode) => {
        cleanup();
        if (input.signal.aborted) { reject(input.signal.reason); return; }
        const completion = new RegExp(`\\n${marker}:(\\d+)\\r?\\n?$`).exec(stdout);
        if (!truncated && !timedOut && (deliveryFailed || !completion)) {
          reject(new RailwayError("railway_ssh_command_unconfirmed", "The container did not confirm command completion. Check SSH key registration, the trusted host key and deployment status before retrying."));
          return;
        }
        if (completion) stdout = stdout.slice(0, completion.index);
        resolve({ exitCode: completion ? Number(completion[1]) : exitCode, stdout: redactSensitiveText(stdout), stderr: redactSensitiveText(stderr), truncated, timedOut });
      });
      child.stdin.on("error", () => { deliveryFailed = true; });
      const quotedCommand = "'" + input.command.replace(/'/g, "'\\''") + "'";
      child.stdin.end(`sh -c ${quotedCommand} </dev/null\npaperclip_command_status=$?\nprintf '\\n${marker}:%d\\n' "$paperclip_command_status"\nexit "$paperclip_command_status"\n`);
    });
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    if (error instanceof RailwayError) throw error;
    throw privateStorageError();
  } finally { await rm(directory, { recursive: true, force: true }); }
}
