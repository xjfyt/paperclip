import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";

/** Keep adapter fixtures away from a developer's real homes and credentials.
 * Individual cases may still install explicit synthetic values after this hook.
 */
export function installIsolatedHostFixture(): void {
  let root: string | null = null;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paperclip-adapter-test-host-"));
    protectNewPrivatePath(root);
    const home = path.join(root, "home");
    const temporary = path.join(root, "temp");
    await mkdir(home);
    await mkdir(temporary);
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
      "OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK"]) vi.stubEnv(key, undefined);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("PAPERCLIP_HOME", path.join(root, "paperclip"));
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "test");
    vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(home, ".claude"));
    for (const key of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(key, temporary);
    if (process.platform === "win32") {
      vi.stubEnv("HOMEDRIVE", path.parse(home).root.slice(0, -1));
      vi.stubEnv("HOMEPATH", home.slice(2));
    }
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    root = null;
  });
}
