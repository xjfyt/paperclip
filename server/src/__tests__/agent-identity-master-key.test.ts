import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";

it("atomically publishes one complete master key across competing processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "identity-master-race-"));
  protectNewPrivatePath(directory); // new empty fixture; existing broad paths are never repaired
  const keyFile = join(directory, "master.key");
  const providerPath = new URL("../secrets/local-encrypted-provider.ts", import.meta.url).href;
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
  try {
    const script = `import {localEncryptedProvider as p} from ${JSON.stringify(providerPath)}; console.log(JSON.stringify(await p.createSecret({value:'race-challenge'})));`;
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => promisify(execFile)(process.execPath,
      ["--import", tsx, "--input-type=module", "-e", script], {
        env: { ...process.env, PAPERCLIP_SECRETS_MASTER_KEY: "", PAPERCLIP_SECRETS_MASTER_KEY_FILE: keyFile },
        timeout: 25_000, windowsHide: true,
      })));
    const children = outcomes.map(outcome => { if (outcome.status === "rejected") throw outcome.reason; return outcome.value; });
    expect(Buffer.from(await readFile(keyFile, "utf8"), "base64")).toHaveLength(32);
    if (process.platform === "win32") expect(hasPrivatePermissions(keyFile, (await stat(keyFile)).mode)).toBe(true);
    else expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "");
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", keyFile);
    for (const child of children) {
      expect(await localEncryptedProvider.resolveVersion(JSON.parse(child.stdout))).toBe("race-challenge");
    }
    await rm(keyFile);
    await expect(localEncryptedProvider.resolveVersion(JSON.parse(children[0].stdout))).rejects.toThrow("master key file is missing");
    await expect(stat(keyFile)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it.runIf(process.platform === "win32")("publishes a private new secrets directory across actual competing processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "identity-new-directory-race-"));
  const keyFile = join(root, "secrets", "master.key");
  const provider = new URL("../secrets/local-encrypted-provider.ts", import.meta.url).href;
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
  try {
    const script = `import {localEncryptedProvider as p} from ${JSON.stringify(provider)}; console.log(JSON.stringify(await p.createSecret({value:'new-directory-challenge'})));`;
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => promisify(execFile)(process.execPath,
      ["--import", tsx, "--input-type=module", "-e", script], { timeout: 25_000, windowsHide: true,
        env: { ...process.env, PAPERCLIP_SECRETS_MASTER_KEY: "", PAPERCLIP_SECRETS_MASTER_KEY_FILE: keyFile },
      })));
    const children = outcomes.map(outcome => { if (outcome.status === "rejected") throw outcome.reason; return outcome.value; });
    expect(hasPrivatePermissions(join(root, "secrets"), 0)).toBe(true);
    expect(hasPrivatePermissions(keyFile, 0)).toBe(true);
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", keyFile);
    for (const child of children) expect(await localEncryptedProvider.resolveVersion(JSON.parse(child.stdout))).toBe("new-directory-challenge");
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
