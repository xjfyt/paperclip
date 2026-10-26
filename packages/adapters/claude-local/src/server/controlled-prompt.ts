import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
/** Only a server capability enables this slot. Config/context fields are inert. */
export function assertControlledPromptContext(ctx: AdapterExecutionContext) {
  if (!ctx.controlledPromptApplication) return;
  if (ctx.privatePromptTest || ctx.config.engine !== "cli" || ctx.executionTarget?.kind !== "local" || ctx.executionTransport?.remoteExecution ||
    ctx.runtime.sessionId || ctx.runtime.sessionParams || ctx.runtime.sessionDisplayId || ctx.context.conversationMode || ctx.executionContinuation?.resumeDelta) {
    throw new Error("prompt_application_adapter_context_unsupported");
  }
}
/** Delimiters are outside the revision: no trim, templating, parsing or normalization. */
export function appendControlledPromptLiteral(base: string, literal: string) {
  if (Buffer.byteLength(literal, "utf8") < 1 || Buffer.byteLength(literal, "utf8") > 128000) throw new Error("prompt_application_literal_invalid");
  return `${base}\n\n<paperclip-approved-literal-supplement>\n${literal}\n</paperclip-approved-literal-supplement>`;
}
