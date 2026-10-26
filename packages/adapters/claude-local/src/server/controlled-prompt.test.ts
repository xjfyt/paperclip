import { describe, expect, it } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { appendControlledPromptLiteral, assertControlledPromptContext } from "./controlled-prompt.js";
const context = (): AdapterExecutionContext => ({ runId: "run", agent: {} as never, runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: "issue" },
  config: { engine: "cli" }, context: {}, executionTarget: { kind: "local", environmentId: "local" } as never, onLog: async () => {},
  controlledPromptApplication: { applicationId: "approval", generation: 1, literalRevision: "literal", prepare: async () => {}, beforeStart: async () => {}, dispatched: async () => {}, stopped: async () => {} } });
it("appends exact literal bytes independently of ordinary rendered template", () => {
  const body = "  {{agent.name}}\r\n{{missing}} 🧪\n  ";
  expect(appendControlledPromptLiteral("rendered ordinary template", body)).toBe(`rendered ordinary template\n\n<paperclip-approved-literal-supplement>\n${body}\n</paperclip-approved-literal-supplement>`);
});
it("only a server-owned capability enables the slot", () => {
  const ctx = context(); delete ctx.controlledPromptApplication; ctx.context.controlledPromptApplication = { literalRevision: "forged" }; ctx.config.controlledPromptApplication = { literalRevision: "forged" }; ctx.config.engine = "acp";
  expect(() => assertControlledPromptContext(ctx)).not.toThrow();
});
for (const [name, mutate] of Object.entries({
  acp: (ctx: AdapterExecutionContext) => { ctx.config.engine = "acp"; },
  resume: (ctx: AdapterExecutionContext) => { ctx.runtime.sessionId = "old"; },
  params: (ctx: AdapterExecutionContext) => { ctx.runtime.sessionParams = {}; },
  remote: (ctx: AdapterExecutionContext) => { ctx.executionTarget = { kind: "remote" } as never; },
  conversation: (ctx: AdapterExecutionContext) => { ctx.context.conversationMode = true; },
  private: (ctx: AdapterExecutionContext) => { ctx.privatePromptTest = {} as never; },
})) it(`rejects ${name} instead of silently dropping supplemental content`, () => {
  const ctx = context(); mutate(ctx); expect(() => assertControlledPromptContext(ctx)).toThrow("prompt_application_adapter_context_unsupported");
});
it("accepts supported fresh local CLI without changing permissions/tools", () => { const ctx = context(); ctx.config.dangerouslySkipPermissions = false; const before = structuredClone(ctx.config);
  assertControlledPromptContext(ctx); expect(ctx.config).toEqual(before); });
