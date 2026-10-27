import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { createHeartbeatLifecycle, type HeartbeatLifecycleDependencies } from "../services/heartbeat/run-lifecycle.js";
import { selectHeartbeatRuntime, type HeartbeatRuntimeSelectionInput } from "../services/heartbeat/runtime-selection.js";

describe("bounded coding repair runtime admission", () => {
  it.each(["handleRunLivenessContinuation", "handleSuccessfulRunHandoff", "handleIssueReviewPathDisposition"] as const)("suppresses unbound %s without transferring work", async method => {
    const access = vi.fn(() => { throw Error("unexpected database access"); });
    const db = new Proxy({}, { get: access }) as Db;
    const lifecycle = createHeartbeatLifecycle(db, {} as HeartbeatLifecycleDependencies);
    const run = { status: "succeeded", livenessState: "empty_response", contextSnapshot: { issueId: "issue", codingRepairAttemptId: "marker-only-blocks" } };
    await lifecycle[method](run as Parameters<typeof lifecycle.handleRunLivenessContinuation>[0], {} as never);
    expect(access).not.toHaveBeenCalled();
  });
  it.each(["attempt-id", "untrusted-marker"])("blocks native selection before any native side effect (%s)", async marker => {
    const access = vi.fn(() => { throw Error("unexpected database access"); });
    const db = new Proxy({}, { get: access }) as Db;
    const input = { run: { companyId: "company", agentId: "agent", contextSnapshot: { codingRepairAttemptId: marker } },
      nativeRuntimeResolution: { kind: "native" } } as unknown as HeartbeatRuntimeSelectionInput;
    await expect(selectHeartbeatRuntime(db, input)).rejects.toMatchObject({ code: "configuration_incomplete",
      resultJson: { configurationIncomplete: { reason: "coding_repair_native_runtime_unsupported" } } });
    expect(access).not.toHaveBeenCalled();
  });
});
