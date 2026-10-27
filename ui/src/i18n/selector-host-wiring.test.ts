import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Exact source contracts only, not runtime/E2E proof for every host. No compiler API is required.
function readPage(path: string) { return readFileSync(new URL(`../pages/${path}`, import.meta.url), "utf8"); }
function occurrences(source: string, text: string, count: number) {
  expect(source.split(text).length - 1, text).toBe(count);
}

describe("owned selector override source contracts", () => {
  it.each(["CompanySkills.tsx", "CompanySkills.production.tsx"])("keeps %s skill selectors and folder labels connected without changing wire values", path => {
    const source = readPage(path);
    occurrences(source, 'allLabel={t("selectorHostUi.allSkills")}', 2);
    const emptyKey = path.includes("production") ? "noSkillAgentsCompany" : "noSkillAgentsOrganization";
    occurrences(source, `emptyMessage={t("selectorHostUi.${emptyKey}")}`, 1);
    occurrences(source, `emptyMessage={eligible.length === 0 ? t("selectorHostUi.${emptyKey}") : t("agentSelect.empty")}`, 1);
    occurrences(source, 'triggerLabel={t("selectorHostUi.addToAgent")}', 1);
    const descriptions = source.slice(source.indexOf("export function InstallPreviewDialog("), source.indexOf("function SkillTree("));
    for (const key of ["requiredAdapter", "unsupportedAdapter", "requiredUnsupportedAdapter"]) occurrences(descriptions, `"selectorHostUi.${key}"`, 2);
    occurrences(descriptions, "adapter: option.adapterType", 4);
    occurrences(descriptions, ": option.adapterType;", 2);
    const header = descriptions.slice(descriptions.indexOf("headerContent={sortedVersions"), descriptions.indexOf("emptyMessage={eligible"));
    expect(header).toContain('t("selectorHostUi.version")'); expect(header).toContain('t("selectorHostUi.latest")');
    expect(header).toContain('value="__latest__"'); expect(header).toContain('event.target.value === "__latest__" ? null : event.target.value');
    expect(header).toContain('v{version.revisionNumber}{version.label ? ` · ${version.label}` : ""}');
    expect(descriptions).toContain('renderNameSuffix={(agent) => (agent as AttachAgentOption).paused ? (');
    occurrences(descriptions, 't("selectorHostUi.paused")', 1);
    expect(descriptions).toContain("onSave={(nextIds) => onSubmit(Array.from(nextIds), draftVersionId)}");
    occurrences(descriptions, "return option.required || !option.supportsSkills;", 2);
    occurrences(source, "const { t } = useTranslation();", 4);
  });
  it.each([
    ["apps/chat/EmailEndpointSetup.tsx", "chooseAgent", "noAgentsFound", "function EmailEndpointSetupForm("],
    ["apps/chat/ChatEndpointSetup.tsx", "chooseActiveAgent", "noActiveAgents", "function ChatSdkEndpointSetup("],
    ["Secrets.tsx", null, "noAgentsAvailable", "function AgentAccessSection("],
  ] as const)("keeps %s only its owned selector prompts localized", (path, placeholder, empty, host) => {
    const source = readPage(path); const section = source.slice(source.indexOf(host));
    if (placeholder) occurrences(section, `placeholder={t("selectorHostUi.${placeholder}")}`, 1);
    occurrences(section, `emptyMessage={t("selectorHostUi.${empty}")}`, 1);
    expect(section).toContain("const { t } = useTranslation();"); expect(section).toContain("<AgentSelect");
    expect(section).toContain(path.includes("Email") ? 'onChange={id => { setAgentId(id);' : path.includes("Secrets") ? "onChange={setSelectedAgentId}" : "onChange={setAgentId}");
  });
  it("keeps permission callbacks and user titles separate from owned descriptions", () => {
    const source = readPage("apps/app-detail/PermissionsPanel.tsx");
    expect(source).toContain('triggerLabel={access.agentIds.size === 0\n                ? t("selectorHostUi.chooseAgents")\n                : t("selectorHostUi.selectedAgents", { count: access.agentIds.size })}');
    expect(source).toContain('emptyMessage={t("selectorHostUi.cannotEditAgents")}');
    expect(source).toContain('getDescription={(agent) => requiredAgentIds.has(agent.id) ? t("selectorHostUi.requiredByInstall") : agent.title}');
    expect(source).toContain("isAgentDisabled={(agent) => requiredAgentIds.has(agent.id)}");
    expect(source).toContain("agentIds: new Set([...agentIds, ...requiredAgentIds])");
  });
  it("keeps profile names and original agent IDs in assignment callbacks", () => {
    const source = readPage("tools/profiles/ProfileWizard.tsx");
    expect(source).toContain('if (defaultProfileName) bits.push(t("selectorHostUi.organizationDefault"));');
    expect(source).toContain('return bits.length > 0 ? t("selectorHostUi.alreadyHasProfiles", { profiles: bits.join(" · ") }) : t("selectorHostUi.noProfiles");');
    expect(source).toContain("list.push(p.name)");
    expect(source).toContain("if (selectedAgentIds.has(agent.id) !== nextAgentIds.has(agent.id)) onToggleAgent(agent.id);");
  });
});
