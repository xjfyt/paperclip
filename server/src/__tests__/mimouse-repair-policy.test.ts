import { expect, it } from "vitest";
import { repairSettingsSchema, savedRepairPolicySchema, repairAgentConfigHash } from "../services/mimouse-coding/repair-policy.js";
const valid = { enabled: true, confirm: true, headSha: "a".repeat(40), routineId: "44444444-4444-4444-8444-444444444444", expectedRoutineRevisionId: "55555555-5555-4555-8555-555555555555", maxAttempts: 2, maxDurationMinutes: 15, maxCostCents: 100 };
it.each([{ maxAttempts: 3 }, { maxAttempts: 0 }, { maxDurationMinutes: 61 }, { maxCostCents: 0 }, { maxCostCents: NaN }, { confirm: false }, { expectedRoutineRevisionId: undefined }])("refuses unbounded or unconfirmed repair policy %j", patch => {
  expect(repairSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
});
it("allows explicit disable without requiring a new routine or resetting attempts", () => {
  expect(repairSettingsSchema.parse({ enabled: false, confirm: true, headSha: valid.headSha })).toEqual({ enabled: false, confirm: true, headSha: valid.headSha });
});
it("binds Agent configuration canonically without exposing its secret values", () => {
  const one = repairAgentConfigHash({ adapterType: "process", adapterConfig: { env: { FIXTURE: "not-real" }, cwd: "/workspace" }, runtimeConfig: { heartbeat: { enabled: false } } });
  const two = repairAgentConfigHash({ adapterType: "process", adapterConfig: { cwd: "/workspace", env: { FIXTURE: "not-real" } }, runtimeConfig: { heartbeat: { enabled: false } } });
  expect(one).toBe(two); expect(one).toMatch(/^[a-f0-9]{64}$/); expect(one).not.toContain("not-real");
  expect(repairAgentConfigHash({ adapterType: "process", adapterConfig: { cwd: "/other" }, runtimeConfig: {} })).not.toBe(one);
});
it("persisted approvals cannot have an infinite dispatch window", () => {
  expect(savedRepairPolicySchema.safeParse({ enabled: true, revision: valid.routineId, headSha: valid.headSha, routineId: valid.routineId, routineRevisionId: valid.expectedRoutineRevisionId, ownerUserId: "owner", agentId: valid.routineId, agentConfigHash: "b".repeat(64), maxAttempts: 2, maxCostCents: 100, approvedAt: "2026-10-25T00:00:00Z", expiresAt: "2027-10-25T00:00:00Z" }).success).toBe(false);
});
