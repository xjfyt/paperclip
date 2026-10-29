import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { agents, companies, authUsers, companyMemberships, principalPermissionGrants, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentFileStore } from "../services/agent-file-store.js";
import { resolveManagedInstructionsRoot } from "../services/agent-instructions.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let root: string;
let home: string;
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "agent-empty-download-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("agent-empty-download-db-");
  db = createDb(database.connectionString);
}, 90_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await database?.cleanup();
  if (home) {
    expect(path.dirname(home)).toBe(os.tmpdir());
    expect(path.basename(home)).toMatch(/^agent-empty-download-/);
    await fs.rm(home, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

it("closes an empty download descriptor before committing the row lock to a concurrent editor", async () => {
  const companyId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
  await db.insert(companies).values({ id: companyId, name: "Empty download", issuePrefix: "EMPTY" });
  await db.insert(authUsers).values({ id: userId, name: "Editor", email: `${userId}@example.invalid`, createdAt: new Date(), updatedAt: new Date() });
  root = resolveManagedInstructionsRoot({ id: agentId, companyId, name: "Target", adapterConfig: {} });
  await fs.mkdir(root, { recursive: true });
  await db.insert(agents).values({ id: agentId, companyId, name: "Target", adapterConfig: {
    instructionsBundleMode: "managed", instructionsRootPath: root, instructionsEntryFile: "AGENTS.md",
  } });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "operator" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure", scope: { agentIds: [agentId] } });
  await fs.writeFile(path.join(root, "AGENTS.md"), "instructions\n");
  const filename = path.join(root, "empty.bin");
  await fs.writeFile(filename, "");
  const actor = { type: "board" as const, userId, source: "session" as const };
  const store = agentFileStore(db);
  // Adopt once so the gate below contains only the real download transaction.
  await store.read(companyId, agentId, "AGENTS.md", actor);
  let descriptor: fs.FileHandle | undefined;
  const open = fs.open.bind(fs);
  const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (String(args[0]) === filename) descriptor = handle;
    return handle;
  });
  const transaction = db.transaction.bind(db);
  const reached = Promise.withResolvers<void>(), commit = Promise.withResolvers<void>(), writerStarted = Promise.withResolvers<number>();
  let first = true;
  const transactionSpy = vi.spyOn(db, "transaction").mockImplementation((callback, ...options) => {
    const download = first;
    first = false;
    return transaction(async tx => {
      if (!download) {
        const rows = await tx.execute(sql`select pg_backend_pid() as pid`);
        writerStarted.resolve(Number(rows[0]!.pid));
      }
      const result = await callback(tx);
      if (download) { reached.resolve(); await commit.promise; }
      return result;
    }, ...options);
  });
  const download = store.download(companyId, agentId, "empty.bin", actor);
  let writer: Promise<unknown> | undefined;
  try {
    await Promise.race([reached.promise, download.then(() => { throw new Error("Download missed the commit gate"); })]);
    expect(descriptor).toBeDefined();
    await expect(descriptor!.stat()).rejects.toMatchObject({ code: "EBADF" });
    writer = store.write({ companyId, agentId, path: "empty.bin", bytes: Buffer.from("replacement"),
      baseHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, actor);
    const writerPid = await writerStarted.promise;
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db.execute(sql`select wait_event_type from pg_stat_activity where pid = ${writerPid}`);
      if (rows[0]?.wait_event_type === "Lock") { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    commit.resolve();
    const result = (await download)!;
    expect(result.size).toBe(0);
    for await (const _chunk of result.stream) throw new Error("An empty snapshot emitted bytes");
    await writer;
    expect(await fs.readFile(filename, "utf8")).toBe("replacement");
  } finally {
    commit.resolve();
    await Promise.allSettled([download, ...(writer ? [writer] : [])]);
    openSpy.mockRestore();
    transactionSpy.mockRestore();
  }
});
