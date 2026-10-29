import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLifecycleWriteViolations, scanAgentLifecycleBoundaries } from "./check-agent-lifecycle-boundaries.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
const source = body => `import { agents as records } from "@paperclipai/db"; ${body}`;
test("finds inserts, deletes, and lifecycle writes through an import alias", () => {
  for (const body of ["db.insert(records).values(input)", "db.delete(records)", "db.update(records).set({ lifecycleState: 'ready' })", "db.update(records).set({ pauseReason })"]) {
    assert.equal(agentLifecycleWriteViolations(source(body)).length, 1);
  }
});
test("permits configuration writes and guards execution status writes", () => {
  assert.deepEqual(agentLifecycleWriteViolations(source("db.update(records).set({ name })")), []);
  assert.equal(agentLifecycleWriteViolations(source("db.update(records).set({ status: 'idle' })")).length, 1);
  assert.deepEqual(agentLifecycleWriteViolations(source('db.update(records).set({ status: "idle" }).where(eq(records.lifecycleState, "ready"))')), []);
});

test("execution configuration writes must use lifecycle invalidation", () => {
  for (const field of ["adapterType", "adapterConfig", "runtimeConfig", "defaultEnvironmentId"]) {
    assert.equal(agentLifecycleWriteViolations(source(`db.update(records).set({ ${field}: value })`)).length, 1);
  }
});

test("offline seed quarantine can disable timers but cannot change lifecycle state", () => {
  const file = "cli/src/commands/worktree.ts";
  assert.deepEqual(agentLifecycleWriteViolations(source("db.update(records).set({ runtimeConfig })"), file), []);
  assert.equal(agentLifecycleWriteViolations(source("db.update(records).set({ lifecycleState: 'ready' })"), file).length, 1);
});

test("rejects agent deletion outside the module even with a terminal state guard", () => {
  assert.equal(agentLifecycleWriteViolations(source('db.delete(records).where(and(eq(records.id, id), inArray(records.lifecycleState, ["terminated", "rejected"])))')).length, 1);
  assert.equal(agentLifecycleWriteViolations(source('db.delete(records).where(inArray(records.lifecycleState, ["ready", "terminated"]))')).length, 1);
});

test("native filesystem traversal preserves the module and offline seed boundaries without accepting lookalike directories", () => {
  const root = mkdtempSync(join(tmpdir(), "paperclip-lifecycle-boundaries-"));
  try {
    for (const directory of ["server/src", "server/scripts", "cli/src", "packages/db/src"]) mkdirSync(join(root, directory), { recursive: true });
    const files = {
      "server/src/modules/agent-lifecycle/adapters/records.ts": source("db.insert(records).values(input)"),
      "cli/src/commands/worktree.ts": source("db.update(records).set({ runtimeConfig })"),
      "server/src/__tests__/seed.ts": source("db.insert(records).values(input)"),
      "server/src/services/ordinary.ts": source("db.insert(records).values(input)"),
      "server/src/services/modules/agent-lifecycle/bypass.ts": source("db.delete(records)"),
    };
    for (const [file, body] of Object.entries(files)) {
      const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, body);
    }
    assert.deepEqual(scanAgentLifecycleBoundaries(root).sort(), [
      "server/src/services/modules/agent-lifecycle/bypass.ts: Use the agent lifecycle module to delete an agent",
      "server/src/services/ordinary.ts: Use the agent lifecycle module to insert an agent",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
