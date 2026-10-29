import { t } from "./index";

const canonicalMessages = {
  selectAgent: "Select an agent to use /goal.",
  unsupported: "Session goals are unsupported by this agent.",
  missingGoal: "There is no current session goal to edit.",
  addObjective: "Add an objective after /goal to start a goal.",
} as const;
type GoalErrorKey = keyof typeof canonicalMessages;
export interface RunnerGoalErrorDescriptor { key: `taskThreadGoalUi.${GoalErrorKey}`; values?: never }
// Provenance is attached to the exact locally-created Error without changing its shape or message.
const localSources = new WeakMap<object, GoalErrorKey>();
export function createRunnerGoalLocalError(key: GoalErrorKey): Error {
  const error = new Error(canonicalMessages[key]);
  localSources.set(error, key);
  return error;
}
export function runnerGoalErrorDescriptor(error: unknown): RunnerGoalErrorDescriptor | null {
  const key = error !== null && typeof error === "object" ? localSources.get(error) : undefined;
  return key ? { key: `taskThreadGoalUi.${key}` } : null;
}
export function runnerGoalErrorText(error: unknown): string {
  const descriptor = runnerGoalErrorDescriptor(error);
  return descriptor ? t(descriptor.key) : error instanceof Error ? error.message : t("taskThreadGoalUi.actionFailed");
}
