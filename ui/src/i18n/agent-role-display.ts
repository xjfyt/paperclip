import { AGENT_ROLE_LABELS, type AgentRole } from "@paperclipai/shared";
import { t } from "./index";

const roleLabelKeys = {
  security: "agentDirectoryUi.roleSecurity",
  engineer: "agentDirectoryUi.roleEngineer",
  designer: "agentDirectoryUi.roleDesigner",
  researcher: "agentDirectoryUi.roleResearcher",
  general: "agentDirectoryUi.roleGeneral",
} satisfies Partial<Record<AgentRole, string>>;

/** Display-only: role wire values and technical role names remain unchanged. */
export function agentRoleLabel(role: string): string {
  if (Object.hasOwn(roleLabelKeys, role)) {
    return t(roleLabelKeys[role as keyof typeof roleLabelKeys]);
  }
  return Object.hasOwn(AGENT_ROLE_LABELS, role)
    ? AGENT_ROLE_LABELS[role as AgentRole]
    : role;
}
