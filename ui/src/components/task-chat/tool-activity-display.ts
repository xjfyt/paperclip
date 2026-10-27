import { t } from "@/i18n";
import {
  toolActivityCopyDescriptor,
  toolActivityPresentation,
  type ToolActivityPresentation,
  type ToolActivityPresentationInput,
} from "./tool-taxonomy";

// Display-only keys. Canonical tool identity, aliases and summary groups stay
// in tool-taxonomy; these strings must never be fed back into its comparisons.
const exactCopyKeys = new Map([
  ["apply_patch", "exact_apply_patch"],
  ["read", "exact_read"],
  ["write", "exact_write"],
  ["edit", "exact_edit"],
  ["notebook_read", "exact_notebook_read"],
  ["notebook_edit", "exact_notebook_edit"],
  ["glob", "exact_glob"],
  ["grep", "exact_grep"],
  ["tool_search", "exact_tool_search"],
  ["web_search", "exact_web_search"],
  ["web_fetch", "exact_web_fetch"],
  ["todo_write", "exact_todo_write"],
  ["task_create", "exact_task_create"],
  ["task_update", "exact_task_update"],
  ["task_list", "exact_task_list"],
  ["task_get", "exact_task_get"],
  ["enter_plan_mode", "exact_enter_plan_mode"],
  ["exit_plan_mode", "exact_exit_plan_mode"],
  ["skill", "exact_skill"],
  ["ask_user_question", "exact_ask_user_question"],
  ["request_human_input", "exact_ask_user_question"],
  ["agent", "exact_agent"],
  ["task", "exact_agent"],
  ["task_output", "exact_task_output"],
  ["task_stop", "exact_task_stop"],
  ["send_message", "exact_send_message"],
  ["spawn_agent", "exact_agent"],
  ["wait_agent", "exact_task_output"],
  ["wait_threads", "exact_wait_threads"],
  ["interrupt_agent", "exact_interrupt_agent"],
  ["report_findings", "exact_report_findings"],
  ["guardian_review", "exact_guardian_review"],
  ["lsp", "exact_lsp"],
  ["compact_conversation", "exact_compact_conversation"],
  ["image_generation", "exact_image_generation"],
  ["view_image", "exact_view_image"],
  ["multi_tool_use_parallel", "exact_multi_tool_use_parallel"],
  ["get_task_context", "exact_get_task_context"],
  ["get_task_history", "exact_get_task_history"],
  ["list_documents", "exact_list_documents"],
  ["read_document", "exact_read_document"],
  ["list_document_revisions", "exact_list_document_revisions"],
  ["report_progress", "exact_report_progress"],
  ["answer_status_question", "exact_answer_status_question"],
  ["write_document", "exact_write_document"],
  ["register_deliverable", "exact_register_deliverable"],
  ["finish_task", "exact_finish_task"],
  ["paperclip_finish", "exact_finish_task"],
  ["block_task", "exact_block_task"],
  ["paperclip_block", "exact_block_task"],
  ["request_review", "exact_request_review"],
  ["list_agents", "exact_list_agents"],
  ["get_agent", "exact_get_agent"],
  ["search_tasks", "exact_search_tasks"],
  ["list_approvals", "exact_list_approvals"],
  ["get_approval", "exact_get_approval"],
  ["get_approval_context", "exact_get_approval_context"],
  ["get_workspace_runtime", "exact_get_workspace_runtime"],
  ["control_workspace_service", "exact_control_workspace_service"],
  ["set_dependencies", "exact_set_dependencies"],
  ["set_task_title", "exact_set_task_title"],
  ["create_task", "exact_task_create"],
  ["request_approval", "exact_request_approval"],
  ["decide_approval", "exact_decide_approval"],
  ["comment_on_approval", "exact_comment_on_approval"],
  ["schedule_wake", "exact_schedule_wake"],
  ["generic_api_request", "exact_generic_api_request"],
]);
const objectActions = new Set([
  "read", "list", "search", "fetch", "open", "update", "create", "delete",
  "move", "request", "post", "start", "stop", "switch",
]);

type DisplayLabels = Pick<ToolActivityPresentation,
  "runningLabel" | "completedLabel" | "failedLabel" | "interruptedLabel">;

/** Render only owned templates; names and inferred objects keep canonical text. */
export function toolActivityDisplayLabels(input: ToolActivityPresentationInput): DisplayLabels {
  const descriptor = toolActivityCopyDescriptor(input);
  let prefix: string;
  let values: { name?: string; object?: string } = {};
  if (descriptor.kind === "exact") {
    const key = exactCopyKeys.get(descriptor.key);
    if (!key) {
      const { runningLabel, completedLabel, failedLabel, interruptedLabel } = toolActivityPresentation(input);
      return { runningLabel, completedLabel, failedLabel, interruptedLabel };
    }
    prefix = key;
  } else if (descriptor.kind === "action") {
    const hasObject = Boolean(descriptor.object) && objectActions.has(descriptor.action);
    prefix = `action_${descriptor.action}_${hasObject ? "object" : "default"}`;
    values = { object: descriptor.object };
  } else {
    prefix = descriptor.kind;
    if (descriptor.kind === "named") values = { name: descriptor.name };
  }
  const runningLabel = t(`toolActivityUi.${prefix}_running`, values);
  const completedLabel = t(`toolActivityUi.${prefix}_completed`, values);
  return {
    runningLabel,
    completedLabel,
    failedLabel: t("toolActivityUi.failed", { activity: completedLabel }),
    interruptedLabel: t("toolActivityUi.interrupted", { activity: runningLabel }),
  };
}
