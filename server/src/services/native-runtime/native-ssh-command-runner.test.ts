import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { writeCliFixture } from "@paperclipai/adapter-utils/test-fixtures/native-cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeSshCommandRunner } from "./native-ssh-command-runner.js";
import { MAX_REMOTE_DELIVERABLE_BYTES, readVerifiedRemoteWorkspaceFile } from "./remote-deliverable-file.js";

describe("native SSH deliverable output budget", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "paperclip-ssh-output-"));
    // Exercise the real SSH command adapter and its execFile output limit,
    // replacing only the network executable with a deterministic byte source.
    const executable = join(root, "ssh");
    await writeCliFixture(executable, `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(root, "response"))}));\n`);
    vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH}`);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const createRunner = () => createNativeSshCommandRunner({
    spec: {
      host: "fixture.invalid", port: 22, username: "fixture",
      remoteWorkspacePath: "/workspace", remoteCwd: "/workspace",
      privateKey: null, knownHosts: null, strictHostKeyChecking: true,
    },
    defaultCwd: "/workspace",
  });

  it.each([64, MAX_REMOTE_DELIVERABLE_BYTES])("returns exact verified bytes for a %i-byte file through the SSH adapter", async (byteSize) => {
    const body = Buffer.alloc(byteSize, 65);
    await writeFile(join(root, "response"), body.toString("base64"));
    const result = await readVerifiedRemoteWorkspaceFile({
      runner: createRunner(), workspaceRoot: "/workspace", contentRef: "result.md",
      byteSize, sha256: createHash("sha256").update(body).digest("hex"),
    });
    expect(result.equals(body)).toBe(true);
  });

  it("stops a remote command that exceeds the maximum encoded envelope", async () => {
    await writeFile(join(root, "response"), Buffer.alloc(4 * Math.ceil(MAX_REMOTE_DELIVERABLE_BYTES / 3) + 1, 65));
    const result = await createRunner().execute({ command: "node", args: ["unused"], timeoutMs: 10_000 });
    expect(result.exitCode).not.toBe(0);
  });
});
