import {
  prepareRuntimeRoutingPolicySchema, approveRuntimeRoutingPolicySchema, disableRuntimeRoutingPolicySchema,
  closeExpiredRuntimeRoutingPolicySchema, createRuntimeRoutingTaskSchema, runRuntimeRoutingTaskSchema, runtimeRoutingRequestQuerySchema,
  type PrepareRuntimeRoutingPolicy, type ApproveRuntimeRoutingPolicy, type DisableRuntimeRoutingPolicy,
  type CreateRuntimeRoutingTask, type RunRuntimeRoutingTask, type RuntimeRoutingRequestQuery,
} from "@paperclipai/shared/runtime-cost-routing";
import { requestResponse } from "./client";
import { readApiJson } from "./response";
import { runtimeRoutingUuidSchema as uuid, runtimeCurrentSchema, runtimeRequestResultSchema, runtimePrepareResultSchema,
  runtimeReceiptResultSchema, runtimeBindingResultSchema, runtimeBindingReadSchema, runtimePolicyReadSchema,
  runtimePolicyRecordSchema, runtimeBindingSchema, type RuntimePolicyRecord, type RuntimeBinding, type RuntimeCurrent,
} from "@paperclipai/shared/runtime-cost-routing-wire";
export type { RuntimePolicyRecord, RuntimeBinding, RuntimeCurrent } from "@paperclipai/shared/runtime-cost-routing-wire";
function fail(): never { throw Error("runtime_routing_response_binding_invalid"); }
/** Every read owns its fetch; no URL-only coalescing, browser cache, automatic retries or raw proof text. */
export function runtimeCostRoutingApi(companyId: string, userId: string, signal: AbortSignal) {
  const company = uuid.parse(companyId), root = `/companies/${company}/runtime-cost-routing`;
  async function send(path: string, body?: unknown) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await readApiJson(await requestResponse(`${root}${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  }
  function policy(raw: unknown, owner = false) { const row = runtimePolicyRecordSchema.parse(raw); if (row.companyId !== company || (owner && row.actorUserId !== userId)) fail(); return row; }
  function binding(raw: unknown) { const row = runtimeBindingSchema.parse(raw); if (row.companyId !== company) fail(); return row; }
  async function change(action: "approve" | "disable", policyId: string | null, body: ApproveRuntimeRoutingPolicy | DisableRuntimeRoutingPolicy) {
    const input = action === "approve" ? approveRuntimeRoutingPolicySchema.parse(body) : disableRuntimeRoutingPolicySchema.parse(body);
    const result = runtimeReceiptResultSchema.parse(await send(action === "approve" ? `/policies/${uuid.parse(policyId)}/approve` : "/disable", input));
    if (result.receipt.requestId !== input.requestId || result.receipt.action !== action || result.receipt.generation !== input.expectedGeneration + 1 || (policyId && result.receipt.policyId !== uuid.parse(policyId))) fail();
    return result;
  }
  return {
    async current() { const value = runtimeCurrentSchema.parse(await send("")); if (value.policy) {
      policy(value.policy); if (value.policyId !== value.policy.id || value.generation !== value.policy.expectedGeneration + 1 || !value.configuredAt || value.policy.approvalClosedAt !== null) fail();
    } return value; },
    async policy(policyId: string) { const result = runtimePolicyReadSchema.parse(await send(`/policies/${uuid.parse(policyId)}`)); if (policy(result.item).id !== uuid.parse(policyId)) fail(); return result; },
    async prepare(body: PrepareRuntimeRoutingPolicy) {
      const input = prepareRuntimeRoutingPolicySchema.parse(body);
      const result = runtimePrepareResultSchema.parse(await send("/prepare", input)), item = policy(result.item, true);
      if (item.requestId !== input.requestId || item.expectedGeneration !== input.expectedGeneration || JSON.stringify(item.policy) !== JSON.stringify(input.policy)) fail(); return result;
    },
    async closeExpired(policyId: string, body: { expectedGeneration: number }) {
      const input = closeExpiredRuntimeRoutingPolicySchema.parse(body), id = uuid.parse(policyId);
      const result = runtimePrepareResultSchema.parse(await send(`/policies/${id}/close-expired`, input)), item = policy(result.item, true);
      if (item.id !== id || item.expectedGeneration !== input.expectedGeneration || item.approvalClosedAt === null) fail();
      return result;
    },
    approve: (policyId: string, body: ApproveRuntimeRoutingPolicy) => change("approve", policyId, body),
    disable: (body: DisableRuntimeRoutingPolicy) => change("disable", null, body),
    async createTask(body: CreateRuntimeRoutingTask) {
      const input = createRuntimeRoutingTaskSchema.parse(body), result = runtimeBindingResultSchema.parse(await send("/tasks", input));
      const row = binding(result.binding); if (row.requestId !== input.requestId || row.generation !== input.expectedGeneration) fail(); return result;
    },
    async run(bindingId: string, body: RunRuntimeRoutingTask) {
      const input = runRuntimeRoutingTaskSchema.parse(body), result = runtimeBindingResultSchema.parse(await send(`/bindings/${uuid.parse(bindingId)}/run`, input));
      const row = binding(result.binding); if (row.id !== uuid.parse(bindingId) || row.dispatchRequestId !== input.requestId || row.state === "bound") fail(); return result;
    },
    async binding(bindingId: string) { const result = runtimeBindingReadSchema.parse(await send(`/bindings/${uuid.parse(bindingId)}`)); if (binding(result.binding).id !== uuid.parse(bindingId)) fail(); return result; },
    async request(requestId: string, query: RuntimeRoutingRequestQuery) {
      const input = runtimeRoutingRequestQuerySchema.parse(query), id = uuid.parse(requestId);
      const result = runtimeRequestResultSchema.parse(await send(`/requests/${id}?${new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]))}`));
      if ([result.policy, result.receipt, result.binding, result.closure].filter(Boolean).length > 1) fail();
      if (result.policy) { const row = policy(result.policy, true); if (input.action !== "prepare" || row.requestId !== id || row.expectedGeneration !== input.expectedGeneration) fail(); }
      if (result.receipt) { const row = result.receipt; if (row.requestId !== id || row.action !== input.action || row.generation !== input.expectedGeneration! + 1 || (input.policyId && row.policyId !== input.policyId)) fail(); }
      if (result.binding) { const row = binding(result.binding); if (input.action === "create_task" ? row.requestId !== id || row.generation !== input.expectedGeneration : input.action !== "run" || row.id !== input.bindingId || row.dispatchRequestId !== id || row.state === "bound") fail(); }
      if (result.closure) { const row = result.closure; if (row.requestId !== id || row.action !== input.action
        || (row.reason === "generation_advanced" ? input.action === "run" || row.currentGeneration <= input.expectedGeneration! : row.reason === "approval_expired" ? input.action !== "approve" : input.action !== "run")) fail(); }
      if (result.closure?.reason === "approval_expired") {
        // A clock-only expiry is reversible. Require the durable proposal marker
        // through another current-authorized read before allowing journal closure.
        const fresh = runtimePolicyReadSchema.parse(await send(`/policies/${uuid.parse(input.policyId)}`)), item = policy(fresh.item, true);
        if (item.id !== input.policyId || item.expectedGeneration !== input.expectedGeneration || item.approvalClosedAt === null) fail();
      }
      return result;
    },
  };
}
