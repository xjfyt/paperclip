const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const displayAttributes = new Set(["aria-label", "ariaLabel", "aria-description", "title", "placeholder", "alt", "label", "description", "message"]);
const toastFields = new Set(["title", "body", "description", "message"]);
const browserMessageMethods = ["confirm", "prompt", "alert"];
// Exact lowercase display fragments only; do not widen to arbitrary short IDs.
const shortDisplayWords = new Set(["in", "of", "on", "or", "to", "by", "as", "an", "a"]);
const names = ['Auth','InviteLanding','InstanceAccess','ProfileSettings','Dashboard','Issues','IssueDetail','Agents','AgentDetail','Approvals','ApprovalDetail','Routines','Costs','MimouseNotifications','MimouseFeedback','MimouseBuildMatrix','MimouseCoding','MimouseCodingRepair','MimouseWorkbuddy','Sidebar','SidebarProjects','SidebarAgents','SidebarAccountMenu','CompanySwitcher','CompanySettingsSidebar','CommandPalette','NewIssueDialog','IssueProperties','IssuesList','IssueFiltersPopover','CommentThread','BudgetPolicyCard','SubscriptionCostCard','ClaudeSubscriptionPanel','CodexSubscriptionPanel','CloudAccessGate','BootstrapPendingPage','AuthRevocationPanel','InviteAuthMethods','ThemeToggle','InboxAgentPolicyControl','AgentMultiSelect'];

// Explicit, bounded inventory: App.tsx mounts the routines list and both detail
// implementations. Paths overlapping the basename inventory are deduplicated.
// This is NOT a call graph.
const routedRoutineFiles = [
  "ui/src/pages/RoutineDetail.tsx",
  "ui/src/pages/RoutineDetail.production.tsx",
  "ui/src/components/RoutineActivityRow.tsx",
  "ui/src/components/routine-sections/context.tsx",
  "ui/src/components/routine-sections/editable-sections.tsx",
  "ui/src/components/routine-sections/editable-sections.production.tsx",
  "ui/src/components/routine-sections/operate-sections.tsx",
  "ui/src/components/routine-triggers/RoutineTriggers.tsx",
  "ui/src/components/routine-triggers/TriggerCard.tsx",
  "ui/src/components/routine-triggers/TriggerWizard.tsx",
  "ui/src/components/routine-triggers/WebhookFields.tsx",
  "ui/src/components/routine-triggers/WebhookUrlWarning.tsx",
  "ui/src/pages/Routines.production.tsx",
  "ui/src/components/RoutineList.tsx",
  "ui/src/components/folders/FolderControls.tsx",
  "ui/src/components/AgentSetupPrompt.tsx",
  "ui/src/components/environment-variables-editor/index.tsx",
  "ui/src/components/environment-variables-editor/Row.tsx",
  "ui/src/components/environment-variables-editor/CreateSecretPopover.tsx",
  // Compatibility re-export; the rendered convert form lives in CreateSecretPopover.
  "ui/src/components/environment-variables-editor/ConvertToSecretPopover.tsx",
  "ui/src/components/environment-variables-editor/SecretPicker.tsx",
];

// Separately bounded, manually verified import/render relationships. These are
// consumed UI components, not routine routes or a complete dependency graph.
// Keep exact paths: a same-basename production/legacy file is not a substitute.
const consumedUiComponents = [
  {
    file: "ui/src/components/task-chat/ComposerRunSettingsPicker.tsx",
    hosts: [
      { file: "ui/src/components/IssueChatThread.tsx", importSource: "./task-chat/ComposerRunSettingsPicker" },
      { file: "ui/src/components/task-chat/TaskChatComposer.tsx", importSource: "./ComposerRunSettingsPicker" },
    ],
  },
  {
    file: "ui/src/components/transcript/RunTranscriptView.tsx",
    hosts: [
      { file: "ui/src/pages/AgentDetail.tsx", importSource: "../components/transcript/RunTranscriptView" },
    ],
  },
  {
    file: "ui/src/components/task-chat/TaskChatComposer.tsx",
    hosts: [
      { file: "ui/src/components/TaskChatThread.tsx", importSource: "@/components/task-chat/TaskChatComposer" },
      { file: "ui/src/components/NewIssueDialog.tsx", importSource: "./task-chat/TaskChatComposer" },
    ],
  },
];
const consumedUiFiles = consumedUiComponents.map(component => component.file);

// Additional exact scopes, separate from the existing 21 routine files and
// three consumed components/five hosts. Do not add these names to the glob.
const routedCompanyPages = [
  { file: "ui/src/pages/Companies.tsx", importSource: "./pages/Companies", routePattern: "companies" },
  { file: "ui/src/pages/CompanySettings.tsx", importSource: "./pages/CompanySettings", routePattern: "company/settings" },
];
const routedCompanyFiles = routedCompanyPages.map(page => page.file);
const buildObservationComponents = [
  {
    file: "ui/src/components/MimouseBuildObservations.tsx",
    hosts: [{ file: "ui/src/pages/MimouseCoding.tsx", importSource: "@/components/MimouseBuildObservations" }],
  },
];
// Explicitly include this direct host (already selected by the old basename
// scope); this does not recursively add hosts of any other component.
const buildObservationFiles = ["ui/src/components/MimouseBuildObservations.tsx", "ui/src/pages/MimouseCoding.tsx"];
// A separate exact quota scope: Costs is already in the basename inventory.
// Neither this metadata nor the host links recursively select other files.
const quotaComponents = [
  { file: "ui/src/components/AccountQuotaPanels.tsx", hosts: [{ file: "ui/src/components/ProviderQuotaCard.tsx", importSource: "./AccountQuotaPanels" }] },
  { file: "ui/src/components/ProviderQuotaCard.tsx", hosts: [{ file: "ui/src/pages/Costs.tsx", importSource: "../components/ProviderQuotaCard" }] },
];
const quotaFiles = quotaComponents.map(component => component.file);
const quotaRenderBoundary = "Within a visible subscription quota section, loading shows a skeleton; nonempty quotaAccounts then render AccountQuotaPanels. Otherwise isClaudeQuotaPanel/isCodexQuotaPanel choose the conditional Claude/Codex fallbacks. Those fallbacks are not globally unused.";

// Schema 4 adds only these four exact JSX inventories. Evidence-only helpers
// and hosts below never recursively enlarge this or any earlier scope.
const taskChatDirectory = "ui/src/components/task-chat/";
const protocolDisplayComponents = [
  { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, symbol: "TaskChatRunnerActivityGroup", hosts: [
    { file: `${taskChatDirectory}TaskChatThreadView.tsx`, importSource: "./TaskChatRunnerActivityGroup" },
    { file: `${taskChatDirectory}TaskChatRunnerTurn.tsx`, importSource: "./TaskChatRunnerActivityGroup" },
    { file: `${taskChatDirectory}TaskChatLiveTail.tsx`, importSource: "./TaskChatRunnerActivityGroup" },
  ] },
  { file: `${taskChatDirectory}TaskChatProtocolCard.tsx`, symbol: "TaskChatProtocolCard", hosts: [
    { file: "ui/src/components/TaskChatThread.tsx", importSource: "@/components/task-chat/TaskChatProtocolCard" },
    { file: `${taskChatDirectory}TaskChatThreadView.tsx`, importSource: "./TaskChatProtocolCard" },
    { file: `${taskChatDirectory}TaskChatRunnerTurn.tsx`, importSource: "./TaskChatProtocolCard" },
    { file: `${taskChatDirectory}TaskChatLiveTail.tsx`, importSource: "./TaskChatProtocolCard" },
  ] },
  { file: `${taskChatDirectory}QuestionForm.tsx`, symbol: "QuestionForm", hosts: [
    { file: `${taskChatDirectory}TaskChatProtocolCard.tsx`, importSource: "./QuestionForm" },
  ] },
  { file: `${taskChatDirectory}TaskChatRichInput.tsx`, symbol: "TaskChatRichInput", hosts: [
    { file: `${taskChatDirectory}QuestionForm.tsx`, importSource: "./TaskChatRichInput" },
  ] },
];
const protocolDisplayFiles = protocolDisplayComponents.map(component => component.file);
const protocolThreadHosts = ["TaskChatThreadView", "TaskChatRunnerTurn", "TaskChatLiveTail"].map(symbol => ({
  file: `${taskChatDirectory}${symbol}.tsx`, symbol,
  hosts: [{ file: "ui/src/components/TaskChatThread.tsx", importSource: `@/components/task-chat/${symbol}` }],
}));
const protocolRoute = {
  file: "ui/src/pages/IssueDetail.tsx", symbol: "IssueDetail", importSource: "./pages/IssueDetail",
  source: "ui/src/App.tsx", routePattern: "issues/:issueId",
  conditionalThread: { file: "ui/src/components/TaskChatThread.tsx", importSource: "../components/TaskChatThread",
    symbol: "TaskChatThread", binding: "ThreadComponent", condition: "classicTaskInterfaceEnabled",
    whenTrue: "IssueChatThread", whenFalse: "TaskChatThread" },
};
const protocolRenderBoundary = "IssueDetail selects TaskChatThread only when classicTaskInterfaceEnabled is false. Its settled history, runner turn and legacy live tail mount the Group; runtime takeover and timeline mount Card. Card workspace/runtime branches and QuestionForm/RichInput are the reviewed paths, not proof every Card branch is reachable. Group mounts the named TaskChatProtocolActivityDetails export; no direct TaskChatProtocolActivityRow mount is claimed.";
const manualProtocolSources = [
  { file: `${taskChatDirectory}tool-taxonomy.ts`, symbols: ["toolActivityPresentation", "toolActivityCopyDescriptor"], consumers: [
    { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, importSource: "./tool-taxonomy", symbol: "toolActivityPresentation", usage: "call" },
    { file: `${taskChatDirectory}task-chat-activity-presentation.ts`, importSource: "./tool-taxonomy", symbol: "toolActivityPresentation", usage: "call" },
    { file: `${taskChatDirectory}completed-activity-summary.ts`, importSource: "./tool-taxonomy", symbol: "toolActivityPresentation", usage: "call" },
    { file: `${taskChatDirectory}tool-activity-display.ts`, importSource: "./tool-taxonomy", symbol: "toolActivityCopyDescriptor", usage: "call" },
  ] },
  { file: `${taskChatDirectory}tool-activity-display.ts`, symbols: ["toolActivityDisplayLabels"], consumers: [
    { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, importSource: "./tool-activity-display", symbol: "toolActivityDisplayLabels", usage: "call" },
    { file: `${taskChatDirectory}task-chat-activity-presentation.ts`, importSource: "./tool-activity-display", symbol: "toolActivityDisplayLabels", usage: "call" },
  ] },
  { file: `${taskChatDirectory}task-chat-activity-presentation.ts`, symbols: ["protocolActivityPresentation", "protocolActivityLabel"], consumers: [
    { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, importSource: "./task-chat-activity-presentation", symbol: "protocolActivityPresentation", usage: "call" },
    { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, importSource: "./task-chat-activity-presentation", symbol: "protocolActivityLabel", usage: "call" },
    { file: `${taskChatDirectory}completed-activity-summary.ts`, importSource: "./task-chat-activity-presentation", symbol: "protocolActivityPresentation", usage: "call" },
  ] },
  { file: `${taskChatDirectory}completed-activity-summary.ts`, symbols: ["completedActivitySummary"], consumers: [
    { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, importSource: "./completed-activity-summary", symbol: "completedActivitySummary", usage: "call" },
  ] },
  { file: `${taskChatDirectory}TaskChatProtocolActivityRow.tsx`, symbols: ["TaskChatProtocolActivityDetails"], consumers: [
    { file: `${taskChatDirectory}TaskChatRunnerActivityGroup.tsx`, importSource: "./TaskChatProtocolActivityRow", symbol: "TaskChatProtocolActivityDetails", usage: "jsx" },
  ] },
];
const manualProtocolFiles = manualProtocolSources.map(source => source.file);
function collectManualSourceEvidence(root) {
  const hash = crypto.createHash("sha256"), missingManualSourceFiles = [];
  const manualSourceEvidence = manualProtocolSources.map(entry => {
    const file = path.join(root, entry.file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      missingManualSourceFiles.push(entry.file);
      return { ...entry, sourceSha256: null, classification: "needs_manual_review", method: "source-hash-only" };
    }
    const source = fs.readFileSync(file, "utf8");
    hash.update(entry.file).update("\0").update(source).update("\0");
    return { ...entry, sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
      classification: "needs_manual_review", method: "source-hash-only" };
  });
  return { manualSourceEvidence, missingManualSourceFiles, manualSourceSha256: hash.digest("hex") };
}

// Schema 5: explicit review denominator for the five agreed high-frequency
// domains. An import is evidence only; it never recursively selects a file.
const baselineFile = "doc/mimouse/checklists/I18N-AUDIT-20261027-5500.json";
const baselineFileSha256 = "d7a518c101b7bdcee2db9aa99c5cec2438d935467698a36c6e1655b5834c7eb1";
const sha256 = source => crypto.createHash("sha256").update(source).digest("hex");
const pathSetSha256 = files => sha256([...new Set(files)].sort().join("\n") + "\n");
function readBaseline(root) {
  const bytes = fs.readFileSync(path.join(root, baselineFile));
  if (sha256(bytes) !== baselineFileSha256) throw Error(`Frozen baseline SHA mismatch: ${baselineFile}`);
  const report = JSON.parse(bytes);
  const files = report.files.map(row => row.file);
  if (report.schemaVersion !== 4 || files.length !== 82 || new Set(files).size !== 82) throw Error("Frozen baseline inventory mismatch");
  return { file: baselineFile, fileSha256: baselineFileSha256, files, pathSetSha256: pathSetSha256(files),
    historicalSourceSha256: report.sourceSha256, historicalMatchedFiles: report.matchedFiles };
}
const evidenceEdge = (domain, file, host, symbol, importSource, usage = "jsx", through = null) => ({
  domain, file: `ui/src/${file}`, host: `ui/src/${host}`, symbol, importSource, usage,
  ...(through ? { through: `ui/src/${through}` } : {}),
});
// Next bounded slice: six actual UI consumers omitted by the 160-path report.
// Exact hosts provide syntax evidence only; this is not recursive discovery.
const visibleRecoveryScopeEdges = [
  evidenceEdge("entry-navigation", "components/SidebarRecentTasks.tsx", "components/Sidebar.tsx", "SidebarRecentTasks", "./SidebarRecentTasks"),
  evidenceEdge("entry-navigation", "components/RouteErrorBoundary.tsx", "components/Layout.tsx", "RouteErrorBoundary", "./RouteErrorBoundary"),
  evidenceEdge("agents-runs", "components/AgentSecretAccessEditor.tsx", "components/AgentConfigForm.tsx", "AgentSecretAccessEditor", "./AgentSecretAccessEditor"),
  evidenceEdge("tasks", "components/task-side-panel/TaskSkillPanel.tsx", "components/task-side-panel/TaskSidePanel.tsx", "TaskSkillPanel", "./TaskSkillPanel"),
  evidenceEdge("tasks", "components/task-side-panel/TaskBrowserPanel.tsx", "components/task-side-panel/TaskSidePanel.tsx", "TaskBrowserPanel", "./TaskBrowserPanel"),
  evidenceEdge("tasks", "components/task-side-panel/TaskBrowserFooter.tsx", "components/task-side-panel/TaskBrowserPanel.tsx", "TaskBrowserFooter", "./TaskBrowserFooter"),
];
const visibleRecoveryScopeFiles = visibleRecoveryScopeEdges.map(edge => edge.file).sort();
const viewportErrorSourceEdge = evidenceEdge("tasks", "hooks/useBrowserViewport.ts", "components/task-side-panel/TaskBrowserPanel.tsx", "useBrowserViewport", "@/hooks/useBrowserViewport", "call");
const visibleRecoveryRenderBoundary = "SidebarRecentTasks is mounted in the streamlined sidebar; AgentSecretAccessEditor in edit-mode secrets settings. TaskSkillPanel and TaskBrowserPanel are conditional task side-panel tabs; TaskBrowserFooter needs a browser without an access error and renders only running/idle sessions. Layout wraps its routed Outlet with RouteErrorBoundary. useBrowserViewport produces local resize guidance consumed by TaskBrowserPanel; its source is hash-only, not JSX coverage. These checks do not prove live browser/session availability, every branch, translation coverage, or preservation of runtime data.";
const scopeEdges = [
  evidenceEdge("management", "pages/audit/AuditFeed.tsx", "pages/audit/AuditHub.tsx", "AuditFeed", "./AuditFeed"),
  evidenceEdge("management", "pages/audit/AuditRuns.tsx", "pages/audit/AuditHub.tsx", "AuditRuns", "./AuditRuns"),
  evidenceEdge("tasks", "pages/IssueDetail.tsx", "App.tsx", "IssueDetail", "./pages/IssueDetail"),
  evidenceEdge("agents-runs", "pages/AgentDetail.tsx", "App.tsx", "AgentDetail", "./pages/AgentDetail"),
  evidenceEdge("management", "pages/Costs.tsx", "App.tsx", "Costs", "./pages/Costs"),
  evidenceEdge("new-modules", "pages/CompanySettings.tsx", "App.tsx", "CompanySettings", "./pages/CompanySettings"),
  evidenceEdge("new-modules", "pages/MimouseCoding.tsx", "App.tsx", "MimouseCoding", "./pages/MimouseCoding"),
  evidenceEdge("tasks", "pages/DecisionQueuePage.tsx", "App.tsx", "DecisionQueuePage", "./pages/DecisionQueuePage"),
  evidenceEdge("tasks", "components/DecisionCard.tsx", "components/DecisionResolver.tsx", "DecisionCard", "./DecisionCard"),
  evidenceEdge("tasks", "components/DecisionTriageStrip.tsx", "components/AttentionQueueRow.tsx", "DecisionTriageStrip", "./DecisionTriageStrip"),
  evidenceEdge("tasks", "components/FileViewerSheet.tsx", "pages/IssueDetail.tsx", "FileViewerSheet", "../components/FileViewerSheet"),
  evidenceEdge("tasks", "components/WorkspaceFileBrowser.tsx", "components/task-side-panel/TaskSidePanel.tsx", "WorkspaceFileBrowser", "@/components/WorkspaceFileBrowser"),
  evidenceEdge("tasks", "components/IssuePlanDecompositionsSection.tsx", "components/issue-properties/IssuePropertiesPlansTab.tsx", "IssuePlanDecompositionsSection", "@/components/IssuePlanDecompositionsSection"),
  evidenceEdge("tasks", "components/artifacts/IssueArtifactCard.tsx", "components/issue-properties/IssuePropertiesArtifactsTab.tsx", "IssueWorkProductArtifactCard", "@/components/artifacts/IssueArtifactCard"),
  evidenceEdge("tasks", "components/artifacts/RichArtifactCards.tsx", "components/issue-properties/IssuePropertiesArtifactsTab.tsx", "DocumentCard", "@/components/artifacts/RichArtifactCards"),
  evidenceEdge("tasks", "components/task-chat/RichWorkProductCard.tsx", "components/task-chat/TaskChatProtocolCard.tsx", "RichWorkProductCard", "./RichWorkProductCard"),
  evidenceEdge("tasks", "components/task-chat/TaskChatPlanPreviewCard.tsx", "components/task-chat/TaskChatThreadView.tsx", "TaskChatPlanPreviewCard", "./TaskChatPlanPreviewCard"),
  evidenceEdge("tasks", "components/task-chat/TaskChatPausedTakeover.tsx", "components/task-chat/TaskChatComposer.tsx", "TaskChatPausedTakeover", "./TaskChatPausedTakeover"),
  evidenceEdge("tasks", "components/task-chat/TaskChatProjectCreatedCard.tsx", "components/task-chat/TaskChatThreadView.tsx", "TaskChatProjectCreatedCard", "./TaskChatProjectCreatedCard"),
  evidenceEdge("tasks", "components/task-chat/TaskChatSkillCreatedCard.tsx", "components/task-chat/TaskChatThreadView.tsx", "TaskChatSkillCreatedCard", "./TaskChatSkillCreatedCard"),
  evidenceEdge("tasks", "components/task-chat/TaskChatBubble.tsx", "components/task-chat/TaskChatThreadView.tsx", "TaskChatBubble", "./TaskChatBubble"),
  evidenceEdge("tasks", "components/task-chat/TaskChatSystemNotice.tsx", "components/task-chat/TaskChatBubble.tsx", "TaskChatSystemNotice", "./TaskChatSystemNotice"),
  evidenceEdge("tasks", "components/task-chat/TaskChatThinking.tsx", "components/task-chat/TaskChatThreadView.tsx", "TaskChatThinking", "./TaskChatThinking"),
  evidenceEdge("tasks", "components/task-chat/TaskChatTurnStatusIsland.tsx", "components/TaskChatThread.tsx", "TaskChatTurnStatusIsland", "@/components/task-chat/TaskChatTurnStatusIsland"),
  evidenceEdge("tasks", "components/task-chat/TaskMessageScroller.tsx", "components/task-chat/TaskChatThreadView.tsx", "TaskMessageScroller", "./TaskMessageScroller"),
  evidenceEdge("tasks", "components/task-chat/ComposerAddMenu.tsx", "components/task-chat/TaskChatComposer.tsx", "ComposerAddMenu", "./ComposerAddMenu"),
  evidenceEdge("tasks", "components/task-chat/ComposerWorktreePicker.tsx", "components/NewIssueDialog.tsx", "ComposerWorktreePicker", "./task-chat/ComposerWorktreePicker"),
  evidenceEdge("tasks", "components/task-chat/TaskChatQueuedMessages.tsx", "components/TaskChatThread.tsx", "TaskChatQueuedMessages", "@/components/task-chat/TaskChatQueuedMessages"),
  evidenceEdge("tasks", "components/SearchableSelect.tsx", "components/task-chat/ComposerWorktreePicker.tsx", "SearchableSelect", "@/components/SearchableSelect"),
  evidenceEdge("tasks", "components/IssueThreadInteractionCard.tsx", "components/IssueChatThread.tsx", "IssueThreadInteractionCard", "./IssueThreadInteractionCard"),

  evidenceEdge("entry-navigation", "App.tsx", "main.tsx", "App", "./App"),
  evidenceEdge("entry-navigation", "components/OnboardingWizardVariant.tsx", "App.tsx", "OnboardingWizardVariant", "./components/OnboardingWizardVariant"),
  evidenceEdge("entry-navigation", "components/OnboardingWizard.tsx", "components/OnboardingWizardVariant.tsx", "OnboardingWizard", "./OnboardingWizard"),
  evidenceEdge("tasks", "pages/Inbox.tsx", "App.tsx", "Inbox", "./pages/Inbox"),
  evidenceEdge("tasks", "pages/LegacyInbox.tsx", "pages/Inbox.tsx", "Inbox", "./LegacyInbox"),
  evidenceEdge("tasks", "components/BlockedInboxView.tsx", "pages/Inbox.tsx", "BlockedInboxView", "../components/BlockedInboxView"),
  evidenceEdge("tasks", "pages/WhatNeedsMe.tsx", "App.tsx", "WhatNeedsMe", "./pages/WhatNeedsMe"),
  evidenceEdge("tasks", "components/AttentionQueueRow.tsx", "pages/WhatNeedsMe.tsx", "AttentionQueueRow", "../components/AttentionQueueRow"),
  evidenceEdge("tasks", "components/DecisionsToolbar.tsx", "pages/WhatNeedsMe.tsx", "DecisionsToolbar", "../components/DecisionsToolbar"),
  evidenceEdge("tasks", "components/DecisionShelf.tsx", "pages/WhatNeedsMe.tsx", "Curtain", "../components/DecisionShelf"),
  evidenceEdge("tasks", "components/DecisionQueueRail.tsx", "pages/WhatNeedsMe.tsx", "DecisionQueueRail", "../components/DecisionQueueRail"),
  evidenceEdge("tasks", "components/DecisionDateChips.tsx", "pages/WhatNeedsMe.tsx", "DecisionDateChips", "../components/DecisionDateChips"),
  evidenceEdge("tasks", "components/DecisionResolver.tsx", "pages/WhatNeedsMe.tsx", "DecisionResolver", "../components/DecisionResolver"),
  // This existing conditional binding is asserted separately by the route test.
  evidenceEdge("tasks", "components/TaskChatThread.tsx", "pages/IssueDetail.tsx", "TaskChatThread", "../components/TaskChatThread", "reference"),
  evidenceEdge("tasks", "components/IssueChatThread.tsx", "pages/IssueDetail.tsx", "IssueChatThread", "../components/IssueChatThread", "reference"),
  evidenceEdge("tasks", "components/task-chat/TaskChatThreadView.tsx", "components/TaskChatThread.tsx", "TaskChatThreadView", "@/components/task-chat/TaskChatThreadView"),
  evidenceEdge("tasks", "components/task-chat/TaskChatRunnerTurn.tsx", "components/TaskChatThread.tsx", "TaskChatRunnerTurn", "@/components/task-chat/TaskChatRunnerTurn"),
  evidenceEdge("tasks", "components/task-chat/TaskChatLiveTail.tsx", "components/TaskChatThread.tsx", "TaskChatLiveTail", "@/components/task-chat/TaskChatLiveTail"),
  evidenceEdge("tasks", "components/task-chat/TaskChatBubbleActions.tsx", "components/TaskChatThread.tsx", "TaskChatBubbleActions", "@/components/task-chat/TaskChatBubbleActions"),
  evidenceEdge("tasks", "components/task-chat/TaskChatInteractionCard.tsx", "components/TaskChatThread.tsx", "TaskChatInteractionCard", "@/components/task-chat/TaskChatInteractionCard"),
  evidenceEdge("tasks", "components/task-chat/TaskChatCompactInteractionCard.tsx", "components/task-chat/TaskChatInteractionCard.tsx", "TaskChatCompactInteractionCard", "./TaskChatCompactInteractionCard"),
  evidenceEdge("tasks", "components/task-chat/TaskChatDescriptionBubble.tsx", "components/TaskChatThread.tsx", "TaskChatDescriptionBubble", "@/components/task-chat/TaskChatDescriptionBubble"),
  evidenceEdge("tasks", "components/task-side-panel/TaskSidePanel.tsx", "pages/IssueDetail.tsx", "TaskSidePanel", "../components/task-side-panel", "jsx", "components/task-side-panel/index.ts"),
  evidenceEdge("tasks", "components/task-side-panel/TaskDocumentPanel.tsx", "components/task-side-panel/TaskSidePanel.tsx", "TaskDocumentPanel", "./TaskDocumentPanel"),
  evidenceEdge("tasks", "components/task-side-panel/TaskAttachmentPanel.tsx", "components/task-side-panel/TaskSidePanel.tsx", "TaskAttachmentPanel", "./TaskAttachmentPanel"),
  evidenceEdge("tasks", "components/task-side-panel/TaskWorkspaceFilePanel.tsx", "components/task-side-panel/TaskSidePanel.tsx", "TaskWorkspaceFilePanel", "./TaskWorkspaceFilePanel"),
  evidenceEdge("tasks", "components/issue-properties/IssuePropertiesPlansTab.tsx", "components/task-side-panel/TaskSidePanel.tsx", "IssuePropertiesPlansTab", "@/components/issue-properties/IssuePropertiesPlansTab"),
  evidenceEdge("tasks", "components/issue-properties/IssuePropertiesArtifactsTab.tsx", "components/task-side-panel/TaskSidePanel.tsx", "IssuePropertiesArtifactsTab", "@/components/issue-properties/IssuePropertiesArtifactsTab"),
  evidenceEdge("tasks", "components/FilePreviewModeToggle.tsx", "components/task-side-panel/TaskAttachmentPanel.tsx", "FilePreviewModeToggle", "@/components/FilePreviewModeToggle"),
  evidenceEdge("tasks", "components/MarkdownEditor.tsx", "components/task-chat/TaskChatComposer.tsx", "MarkdownEditor", "@/components/MarkdownEditor"),
  evidenceEdge("tasks", "components/IssueDocumentsSection.tsx", "pages/IssueDetail.tsx", "IssueDocumentsSection", "../components/IssueDocumentsSection"),
  evidenceEdge("tasks", "components/DocumentDiffModal.tsx", "components/IssueDocumentsSection.tsx", "DocumentDiffModal", "./DocumentDiffModal"),
  evidenceEdge("tasks", "components/IssueDocumentAnnotations.tsx", "components/task-side-panel/TaskDocumentPanel.tsx", "IssueDocumentAnnotations", "@/components/IssueDocumentAnnotations"),
  evidenceEdge("tasks", "components/DocumentAnnotationPanel.tsx", "components/IssueDocumentAnnotations.tsx", "DocumentAnnotationPanel", "./DocumentAnnotationPanel"),
  evidenceEdge("tasks", "components/DocumentAnnotationPopover.tsx", "components/IssueDocumentAnnotations.tsx", "DocumentAnnotationPopover", "./DocumentAnnotationPopover"),
  evidenceEdge("tasks", "components/DocumentAnnotationLayer.tsx", "components/IssueDocumentAnnotations.tsx", "DocumentAnnotationLayer", "./DocumentAnnotationLayer"),
  evidenceEdge("agents-runs", "components/AgentConfigForm.tsx", "pages/AgentDetail.tsx", "AgentConfigForm", "../components/AgentConfigForm"),
  evidenceEdge("agents-runs", "components/AgentLifecycleStatus.tsx", "pages/AgentDetail.tsx", "AgentLifecycleStatus", "../components/AgentLifecycleStatus"),
  evidenceEdge("agents-runs", "components/agent-config-primitives.tsx", "components/AgentConfigForm.tsx", "Field", "./agent-config-primitives"),
  evidenceEdge("agents-runs", "components/TrustPresetSection.tsx", "pages/AgentDetail.tsx", "TrustPresetSection", "../components/TrustPresetSection"),
  evidenceEdge("agents-runs", "components/chat/AgentChannelsPanel.tsx", "pages/AgentDetail.tsx", "AgentChannelsPanel", "../components/chat/AgentChannelsPanel"),
  evidenceEdge("agents-runs", "components/primary-agent/PrimaryAgentPresentation.tsx", "components/NewIssueDialog.tsx", "usePrimaryAgentPresentation", "./primary-agent/PrimaryAgentPresentation", "call"),
  evidenceEdge("agents-runs", "components/InstructionHistory.tsx", "pages/AgentDetail.tsx", "InstructionHistory", "../components/InstructionHistory"),
  evidenceEdge("agents-runs", "pages/agent-skills/AgentSkillsTab.tsx", "pages/AgentDetail.tsx", "AgentSkillsTab", "./agent-skills/AgentSkillsTab"),
  evidenceEdge("agents-runs", "pages/agent-skills/AgentSkillRow.tsx", "pages/agent-skills/AgentSkillsTab.tsx", "AgentSkillRow", "./AgentSkillRow"),
  evidenceEdge("management", "components/decision-models/DecisionHistory.tsx", "pages/Costs.tsx", "DecisionHistory", "../components/decision-models/DecisionHistory"),
  evidenceEdge("management", "components/fast-responses/FastResponseHistory.tsx", "pages/Costs.tsx", "FastResponseHistory", "../components/fast-responses/FastResponseHistory"),
  evidenceEdge("management", "pages/audit/CompanyActivity.tsx", "App.tsx", "CompanyActivity", "./pages/audit/CompanyActivity"),
  evidenceEdge("management", "pages/audit/AuditHub.tsx", "pages/audit/CompanyActivity.tsx", "AuditHub", "./AuditHub"),
  evidenceEdge("management", "pages/audit/AuditHub.tsx", "App.tsx", "AuditHub", "./pages/audit/AuditHub"),
  evidenceEdge("new-modules", "pages/CompanyConnections.tsx", "App.tsx", "CompanyConnections", "./pages/CompanyConnections"),
  evidenceEdge("new-modules", "components/decision-models/DecisionModelSettings.tsx", "pages/CompanySettings.tsx", "DecisionModelSettingsSection", "../components/decision-models/DecisionModelSettings"),
  evidenceEdge("new-modules", "components/fast-responses/FastResponseSettings.tsx", "pages/CompanyConnections.tsx", "FastResponseSettingsSection", "../components/fast-responses/FastResponseSettings"),
  evidenceEdge("new-modules", "components/MimouseCodingProjects.tsx", "pages/MimouseCoding.tsx", "MimouseCodingProjects", "@/components/MimouseCodingProjects"),
  ...visibleRecoveryScopeEdges,
];
const expandedScopeFiles = [...new Set(scopeEdges.map(edge => edge.file))].sort();
// Post-integration display helpers: exact, verified calls only. This includes
// eight new helpers and three existing helpers whose display opt-in changed.
// Their returned copy remains manual provenance review, never JSX coverage.
const integratedDisplayHelperEdges = [
  evidenceEdge("tasks", "i18n/attention-row-display.ts", "components/AttentionQueueRow.tsx", "attentionDecideByDisplay", "../i18n/attention-row-display", "call"),
  evidenceEdge("tasks", "i18n/attention-row-display.ts", "components/AttentionQueueRow.tsx", "attentionDetailDisplay", "../i18n/attention-row-display", "call"),
  evidenceEdge("tasks", "i18n/attention-row-display.ts", "components/DecisionTriageStrip.tsx", "attentionDecideByDisplay", "../i18n/attention-row-display", "call"),
  evidenceEdge("tasks", "i18n/blocked-inbox-display.ts", "components/BlockedInboxView.tsx", "blockedVariantDisplay", "../i18n/blocked-inbox-display", "call"),
  evidenceEdge("tasks", "i18n/blocked-inbox-display.ts", "components/BlockedInboxView.tsx", "stoppedAgeDisplay", "../i18n/blocked-inbox-display", "call"),
  evidenceEdge("tasks", "i18n/blocked-inbox-display.ts", "components/BlockedReasonChip.tsx", "blockedVariantDisplay", "../i18n/blocked-inbox-display", "call"),
  evidenceEdge("tasks", "i18n/blocked-inbox-display.ts", "components/BlockedReasonChip.tsx", "blockedSeverityDisplay", "../i18n/blocked-inbox-display", "call"),
  evidenceEdge("tasks", "i18n/decision-desk-display.ts", "pages/WhatNeedsMe.tsx", "decisionGroupLabel", "../i18n/decision-desk-display", "call"),
  evidenceEdge("tasks", "i18n/decision-desk-display.ts", "pages/DecisionQueuePage.tsx", "decisionGroupLabel", "../i18n/decision-desk-display", "call"),
  evidenceEdge("tasks", "i18n/decision-desk-display.ts", "components/DecisionDateChips.tsx", "decisionDateLabel", "../i18n/decision-desk-display", "call"),
  evidenceEdge("tasks", "i18n/decision-desk-display.ts", "i18n/attention-row-display.ts", "decisionDateLabel", "./decision-desk-display", "call"),
  evidenceEdge("tasks", "i18n/inbox-display.ts", "pages/Inbox.tsx", "inboxGroupDisplay", "../i18n/inbox-display", "call"),
  evidenceEdge("tasks", "i18n/inbox-display.ts", "pages/Inbox.tsx", "joinRequestDisplay", "../i18n/inbox-display", "call"),
  evidenceEdge("tasks", "i18n/inbox-display.ts", "pages/LegacyInbox.tsx", "inboxGroupDisplay", "../i18n/inbox-display", "call"),
  evidenceEdge("tasks", "i18n/inbox-display.ts", "pages/LegacyInbox.tsx", "joinRequestDisplay", "../i18n/inbox-display", "call"),
  evidenceEdge("tasks", "i18n/interaction-audience-display.ts", "components/AttentionQueueRow.tsx", "displayAttentionResolverAudience", "../i18n/interaction-audience-display", "call"),
  evidenceEdge("tasks", "i18n/interaction-audience-display.ts", "components/InteractionAudienceLine.tsx", "displayResolverAudience", "@/i18n/interaction-audience-display", "call"),
  evidenceEdge("tasks", "i18n/interaction-audience-display.ts", "i18n/task-interaction-feedback-display.ts", "displayResolverAudience", "./interaction-audience-display", "call"),
  evidenceEdge("tasks", "i18n/runner-goal-feedback.ts", "components/task-chat/RunnerGoalWidget.tsx", "createRunnerGoalLocalError", "@/i18n/runner-goal-feedback", "call"),
  evidenceEdge("tasks", "i18n/runner-goal-feedback.ts", "components/task-chat/RunnerGoalWidget.tsx", "runnerGoalErrorText", "@/i18n/runner-goal-feedback", "call"),
  evidenceEdge("tasks", "i18n/runner-goal-feedback.ts", "components/task-chat/TaskChatComposer.tsx", "runnerGoalErrorDescriptor", "@/i18n/runner-goal-feedback", "call"),
  evidenceEdge("tasks", "i18n/task-interaction-feedback-display.ts", "components/AttentionQueueRow.tsx", "taskInteractionError", "../i18n/task-interaction-feedback-display", "call"),
  evidenceEdge("tasks", "i18n/task-interaction-feedback-display.ts", "components/IssueThreadInteractionCard.tsx", "taskInteractionAudience", "@/i18n/task-interaction-feedback-display", "call"),
  evidenceEdge("tasks", "i18n/task-interaction-feedback-display.ts", "components/IssueThreadInteractionCard.tsx", "taskInteractionError", "@/i18n/task-interaction-feedback-display", "call"),
  evidenceEdge("tasks", "i18n/task-interaction-feedback-display.ts", "components/task-chat/TaskChatCompactInteractionCard.tsx", "taskInteractionAudience", "@/i18n/task-interaction-feedback-display", "call"),
  evidenceEdge("tasks", "i18n/task-interaction-feedback-display.ts", "components/task-chat/TaskChatCompactInteractionCard.tsx", "taskInteractionError", "@/i18n/task-interaction-feedback-display", "call"),
  evidenceEdge("agents-runs", "lib/agent-configuration-errors.ts", "components/AgentConfigForm.tsx", "agentConfigurationContextError", "@/lib/agent-configuration-errors", "call"),
  evidenceEdge("tasks", "lib/credential-access-notice.ts", "components/TaskChatThread.tsx", "credentialAccessNotice", "@/lib/credential-access-notice", "call"),
  evidenceEdge("tasks", "lib/system-notice-humanizer.ts", "components/task-chat/TaskChatSystemNotice.tsx", "humanizeSystemNotice", "@/lib/system-notice-humanizer", "call"),
  evidenceEdge("agents-runs", "pages/agent-skills/agent-skill-source.ts", "pages/agent-skills/AgentSkillsTab.tsx", "buildAgentSkillSourceMeta", "./agent-skill-source", "call"),
];
const integratedDisplayHelperFiles = [...new Set(integratedDisplayHelperEdges.map(edge => edge.file))].sort();
// Pure helpers remain evidence-only: no fictional JSX coverage for returned copy.
const manualScopeEdges = [
  // Keep canonical sources even when display now opts into a separate helper.
  evidenceEdge("tasks", "lib/attention.ts", "components/DecisionsToolbar.tsx", "countActiveAttentionFilters", "../lib/attention", "call"),
  evidenceEdge("tasks", "lib/blockedInbox.ts", "components/BlockedInboxView.tsx", "buildBlockedInboxRows", "../lib/blockedInbox", "call"),
  evidenceEdge("tasks", "lib/inbox.ts", "pages/Inbox.tsx", "buildGroupedInboxSections", "../lib/inbox", "call"),
  evidenceEdge("management", "lib/activity-format.ts", "pages/audit/AuditFeed.tsx", "formatActivityVerb", "@/lib/activity-format", "call"),
  evidenceEdge("tasks", "hooks/useDocumentAnnotationMutations.ts", "components/DocumentAnnotationPanel.tsx", "useDocumentAnnotationMutations", "@/hooks/useDocumentAnnotationMutations", "call"),
  evidenceEdge("tasks", "lib/artifact-card-data.ts", "components/artifacts/IssueArtifactCard.tsx", "loadArtifactCsv", "@/lib/artifact-card-data", "call"),
  evidenceEdge("tasks", "lib/issue-artifacts.ts", "components/task-side-panel/TaskDocumentPanel.tsx", "documentDisplayTitle", "@/lib/issue-artifacts", "call"),
  evidenceEdge("tasks", "lib/task-side-panel-state.ts", "components/task-side-panel/TaskSidePanel.tsx", "taskPanelArtifactsTab", "@/lib/task-side-panel-state", "call"),
  evidenceEdge("management", "pages/audit/audit-navigation.ts", "pages/audit/AuditHub.tsx", "auditDisplaySections", "./audit-navigation", "call"),
  ...integratedDisplayHelperEdges,
  viewportErrorSourceEdge,
];
const manualScopeFiles = [...new Set(manualScopeEdges.map(edge => edge.file))].sort();
const scopeEvidenceFiles = [...new Set([...scopeEdges, ...manualScopeEdges].flatMap(edge => [edge.host, ...(edge.through ? [edge.through] : [])]))].sort();
const domainBasenames = {
  "entry-navigation": ["AuthRevocationPanel", "BootstrapPendingPage", "CloudAccessGate", "CommandPalette", "CompanySettingsSidebar", "CompanySwitcher", "InviteAuthMethods", "Sidebar", "SidebarAccountMenu", "SidebarAgents", "SidebarProjects", "ThemeToggle", "Auth", "Companies", "Dashboard", "InstanceAccess", "InviteLanding", "ProfileSettings"],
  tasks: ["AgentMultiSelect", "CommentThread", "InboxAgentPolicyControl", "IssueFiltersPopover", "IssueProperties", "IssuesList", "NewIssueDialog", "IssueDetail", "Issues", "ComposerRunSettingsPicker", "QuestionForm", "TaskChatComposer", "TaskChatProtocolCard", "TaskChatRichInput", "TaskChatRunnerActivityGroup"],
  "agents-runs": ["AgentDetail", "Agents", "RunTranscriptView"],
  management: ["AccountQuotaPanels", "AgentSetupPrompt", "BudgetPolicyCard", "ClaudeSubscriptionPanel", "CodexSubscriptionPanel", "ProviderQuotaCard", "RoutineActivityRow", "RoutineList", "SubscriptionCostCard", "ApprovalDetail", "Approvals", "Costs", "RoutineDetail", "Routines"],
  "new-modules": ["MimouseBuildMatrix", "MimouseBuildObservations", "CompanySettings", "MimouseCoding", "MimouseCodingRepair", "MimouseFeedback", "MimouseNotifications", "MimouseWorkbuddy"],
};
function legacyDomain(file) {
  if (routedRoutineFiles.includes(file)) return "management";
  const domains = Object.entries(domainBasenames).filter(([, entries]) => matchesEntry(file, entries));
  if (domains.length !== 1) throw Error(`Unclassified or ambiguous frozen path: ${file}`);
  return domains[0][0];
}
function sourceInventory(root, requested) {
  const files = [...new Set(requested)].sort(), hash = crypto.createHash("sha256"), missingFiles = [];
  const evidence = files.map(file => {
    const full = path.join(root, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { missingFiles.push(file); return { file, sourceSha256: null }; }
    const source = fs.readFileSync(full);
    hash.update(file).update("\0").update(source).update("\0");
    return { file, sourceSha256: sha256(source) };
  });
  return { requestedFiles: files, matchedFiles: files.length - missingFiles.length, missingFiles,
    pathSetSha256: pathSetSha256(files), sourceSha256: hash.digest("hex"), evidence };
}
function walkEvidenceAst(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (node.type === "ImportDeclaration") return;
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(item => walkEvidenceAst(item, visit));
    else if (value && typeof value === "object") walkEvidenceAst(value, visit);
  }
}
function consumesEdge(source, edge, parse) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const bindings = new Set(ast.program.body
    .filter(node => node.type === "ImportDeclaration" && node.source.value === edge.importSource && node.importKind !== "type")
    .flatMap(declaration => declaration.specifiers.filter(node => node.type === "ImportSpecifier" && node.imported.name === edge.symbol && node.importKind !== "type")
      .map(binding => binding.local.name)));
  if (!bindings.size) return false;
  let consumed = false;
  walkEvidenceAst(ast.program, node => {
    if (edge.usage === "jsx" && node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier" && bindings.has(node.name.name)) consumed = true;
    if (edge.usage === "call" && node.type === "CallExpression" && node.callee.type === "Identifier" && bindings.has(node.callee.name)) consumed = true;
    if (edge.usage === "reference" && node.type === "Identifier" && bindings.has(node.name)) consumed = true;
  });
  return consumed;
}
function verifyScopeEdges(root, parse) {
  return [...scopeEdges, ...manualScopeEdges].filter(edge => {
    if (!fs.existsSync(path.join(root, edge.file)) || !fs.existsSync(path.join(root, edge.host))) return true;
    const resolved = edge.importSource.startsWith("@/") ? `ui/src/${edge.importSource.slice(2)}`
      : path.posix.normalize(`${path.posix.dirname(edge.host)}/${edge.importSource}`);
    if (edge.through) {
      if (resolved !== path.posix.dirname(edge.through) || !fs.existsSync(path.join(root, edge.through))) return true;
      const barrel = parse(fs.readFileSync(path.join(root, edge.through), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
      if (!barrel.program.body.some(node => node.type === "ExportNamedDeclaration" && node.source
        && path.posix.normalize(`${path.posix.dirname(edge.through)}/${node.source.value}.tsx`) === edge.file
        && node.specifiers.some(specifier => specifier.exported?.name === edge.symbol && specifier.local?.name === edge.symbol))) return true;
    } else if (`${resolved}${path.extname(edge.file)}` !== edge.file) return true;
    return !consumesEdge(fs.readFileSync(path.join(root, edge.host), "utf8"), edge, parse);
  });
}
function collectScopeDenominators(root, baseline) {
  return Object.keys(domainBasenames).map(domain => ({ domain, ...sourceInventory(root, [
    ...baseline.files.filter(file => legacyDomain(file) === domain),
    ...scopeEdges.filter(edge => edge.domain === domain).map(edge => edge.file),
  ]) }));
}

function isTranslationCall(node) {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  return (callee.type === "Identifier" && ["t", "mimouseT"].includes(callee.name))
    || (callee.type === "MemberExpression" && !callee.computed
      && ["i18n", "mimouseI18n"].includes(callee.object.name) && callee.property.name === "t");
}

/** Syntax inventory, not a translation coverage metric. Variables and callbacks
 * may render additional text. Every result still needs human classification. */
function collectAudit(source, file, parse) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const candidates = [], dynamicCandidates = [], seen = new Set(), dynamicSeen = new Set();
  function location(node, kind) {
    return { file, line: node.loc.start.line, column: node.loc.start.column + 1, kind, classification: "needs_manual_review" };
  }
  function add(node, value, kind) {
    const text = value.replace(/\s+/g, " ").trim();
    if ((!/[A-Za-z]{3}/.test(text) && !shortDisplayWords.has(text)) || seen.has(node.start)) return;
    seen.add(node.start);
    candidates.push({ ...location(node, kind), text });
  }
  function review(node, kind) {
    if (dynamicSeen.has(node.start)) return;
    dynamicSeen.add(node.start);
    // Source syntax only: never evaluate, resolve API data, or copy runtime values.
    dynamicCandidates.push({ ...location(node, kind), expression: source.slice(node.start, node.end).replace(/\s+/g, " ").slice(0, 240) });
  }
  function expression(node, kind = "jsx-expression", dynamicKind = "jsx-dynamic") {
    if (!node) return;
    if (node.type === "StringLiteral") add(node, node.value, kind);
    else if (node.type === "TemplateLiteral") {
      for (const part of node.quasis) add(part, part.value.cooked ?? part.value.raw, kind === "jsx-expression" ? "jsx-template" : kind);
      for (const part of node.expressions) expression(part, kind, dynamicKind);
    } else if (node.type === "ConditionalExpression") {
      expression(node.consequent, kind, dynamicKind); expression(node.alternate, kind, dynamicKind);
    } else if (node.type === "LogicalExpression") {
      if (node.operator !== "&&") expression(node.left, kind, dynamicKind);
      expression(node.right, kind, dynamicKind);
    } else if (node.type === "BinaryExpression" && node.operator === "+") {
      expression(node.left, kind, dynamicKind); expression(node.right, kind, dynamicKind);
    } else if (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(node.type)) {
      expression(node.expression, kind, dynamicKind);
    } else if (!["JSXElement", "JSXFragment", "JSXEmptyExpression", "NullLiteral", "BooleanLiteral", "NumericLiteral", "BinaryExpression"].includes(node.type)
      && !(node.type === "Identifier" && node.name === "undefined") && !isTranslationCall(node)) {
      review(node, dynamicKind);
    }
  }
  function notification(node) {
    if (node.callee.type !== "Identifier") return;
    const name = node.callee.name;
    if (!["pushToast", "toast", "setSecretMessage"].includes(name)) return;
    const input = node.arguments[0];
    if (!input || input.type === "NullLiteral") return;
    const prefix = name === "setSecretMessage" ? "secret-message" : "toast";
    if (input.type !== "ObjectExpression") {
      expression(input, prefix, `${prefix}-dynamic`);
      return;
    }
    for (const property of input.properties) {
      if (property.type === "SpreadElement") {
        review(property.argument, `${prefix}-spread-dynamic`);
        continue;
      }
      if (property.type !== "ObjectProperty" || property.computed) continue;
      const field = property.key.name ?? property.key.value;
      if (name === "setSecretMessage" ? field !== "title" : !toastFields.has(field)) continue;
      expression(property.value, `${prefix}-${field}`, `${prefix}-${field}-dynamic`);
    }
  }
  function browserMessage(node) {
    const callee = node.callee;
    if (callee.type !== "MemberExpression" || callee.computed
      || callee.object.type !== "Identifier" || callee.object.name !== "window"
      || !browserMessageMethods.includes(callee.property.name)) return;
    // The prompt default and all other arguments are user values, not messages.
    const kind = `window-${callee.property.name}`;
    expression(node.arguments[0], kind, `${kind}-dynamic`);
  }
  function walk(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") add(node, node.value, "jsx-text");
    if (node.type === "JSXAttribute" && displayAttributes.has(node.name?.name) && node.value?.type === "StringLiteral") {
      add(node.value, node.value.value, "jsx-attribute");
    }
    if (node.type === "JSXExpressionContainer" && (parent?.type !== "JSXAttribute" || displayAttributes.has(parent.name?.name))) expression(node.expression);
    if (node.type === "CallExpression") { notification(node); browserMessage(node); }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) { for (const item of value) walk(item, node); }
      else if (value && typeof value === "object") walk(value, node);
    }
  }
  walk(ast);
  return { candidates, dynamicCandidates };
}
function collectCandidates(source, file, parse) { return collectAudit(source, file, parse).candidates; }
function matchesEntry(file, names) { return names.includes(path.basename(file, ".tsx").replace(/\.production$/, "")); }
function selectInventory(files) {
  const eligible = files.filter(file => /\.tsx$/.test(file) && !/(?:\.test\.|\.stories\.)/.test(file));
  const selected = [...new Set(eligible.filter(file => matchesEntry(file, names) || routedRoutineFiles.includes(file)
    || consumedUiFiles.includes(file) || routedCompanyFiles.includes(file) || buildObservationFiles.includes(file) || quotaFiles.includes(file)
    || protocolDisplayFiles.includes(file) || expandedScopeFiles.includes(file)))].sort();
  return {
    selected,
    missingExpandedScopeFiles: expandedScopeFiles.filter(file => !selected.includes(file)),
    legacySelected: selected.filter(file => matchesEntry(file, names) || routedRoutineFiles.includes(file)
      || consumedUiFiles.includes(file) || routedCompanyFiles.includes(file) || buildObservationFiles.includes(file)
      || quotaFiles.includes(file) || protocolDisplayFiles.includes(file)),
    missingRoutedFiles: routedRoutineFiles.filter(file => !selected.includes(file)),
    missingConsumedFiles: consumedUiFiles.filter(file => !selected.includes(file)),
    missingCompanyRouteFiles: routedCompanyFiles.filter(file => !selected.includes(file)),
    missingBuildObservationFiles: buildObservationFiles.filter(file => !selected.includes(file)),
    missingQuotaFiles: quotaFiles.filter(file => !selected.includes(file)),
    missingProtocolDisplayFiles: protocolDisplayFiles.filter(file => !selected.includes(file)),
    unmatchedBasenames: names.filter(name => !selected.some(file => matchesEntry(file, [name]))),
  };
}
module.exports = { collectCandidates, collectAudit, matchesEntry, selectInventory, routedRoutineFiles, consumedUiComponents, consumedUiFiles,
  routedCompanyPages, routedCompanyFiles, buildObservationComponents, buildObservationFiles, quotaComponents, quotaFiles, quotaRenderBoundary, browserMessageMethods,
  protocolDisplayComponents, protocolDisplayFiles, protocolThreadHosts, protocolRoute, protocolRenderBoundary,
  manualProtocolSources, manualProtocolFiles, collectManualSourceEvidence,
  baselineFile, baselineFileSha256, readBaseline, pathSetSha256, expandedScopeFiles, scopeEdges, manualScopeEdges, manualScopeFiles,
  scopeEvidenceFiles, integratedDisplayHelperEdges, integratedDisplayHelperFiles, visibleRecoveryScopeEdges, visibleRecoveryScopeFiles, viewportErrorSourceEdge, visibleRecoveryRenderBoundary,
  domainBasenames, legacyDomain, sourceInventory, consumesEdge, verifyScopeEdges, collectScopeDenominators };

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
  const parserPath = argument("--parser"), outPath = argument("--out");
  if (!parserPath || !outPath) throw Error("Usage: node scripts/audit-mimouse-i18n.cjs --parser <installed @babel/parser entry> --out <report.json>");
  let directory = path.dirname(path.resolve(parserPath)), parserVersion;
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) {
      const metadata = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (metadata.name === "@babel/parser") { parserVersion = metadata.version; break; }
    }
    directory = path.dirname(directory);
  }
  if (!parserVersion) throw Error("The parser entry must belong to an installed @babel/parser package");
  const { parse } = require(path.resolve(parserPath));
  const all = [];
  function files(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) files(file);
      else if (entry.isFile() && /\.tsx$/.test(file) && !/(?:\.test\.|\.stories\.)/.test(file)) all.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  files(path.join(root, "ui/src"));
  const { selected, legacySelected, missingExpandedScopeFiles, missingRoutedFiles, missingConsumedFiles, missingCompanyRouteFiles, missingBuildObservationFiles, missingQuotaFiles, missingProtocolDisplayFiles, unmatchedBasenames } = selectInventory(all);
  const { manualSourceEvidence, missingManualSourceFiles, manualSourceSha256 } = collectManualSourceEvidence(root);
  const baseline = readBaseline(root);
  const legacyScope = sourceInventory(root, baseline.files);
  const legacyPathDrift = legacySelected.filter(file => !baseline.files.includes(file));
  const expandedScope = sourceInventory(root, expandedScopeFiles);
  const manualScope = sourceInventory(root, manualScopeFiles);
  manualScope.method = "source-hash-only";
  manualScope.evidence = manualScope.evidence.map(row => ({ ...row, method: "source-hash-only", classification: "needs_manual_review" }));
  const hostEvidence = sourceInventory(root, scopeEvidenceFiles);
  const invalidScopeEdges = verifyScopeEdges(root, parse);
  const scopeDenominators = collectScopeDenominators(root, baseline);
  const candidates = [], dynamicCandidates = [], counts = [], hash = crypto.createHash("sha256");
  for (const relative of selected) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    hash.update(relative).update("\0").update(source).update("\0");
    const rows = collectAudit(source, relative, parse);
    counts.push({ file: relative, literalCandidates: rows.candidates.length, dynamicCandidates: rows.dynamicCandidates.length });
    candidates.push(...rows.candidates); dynamicCandidates.push(...rows.dynamicCandidates);
  }
  const result = {
    schemaVersion: 5, generatedAt: new Date().toISOString(), parserVersion,
    method: "Bounded Babel AST inventory: JSX text/display attributes (including message and ariaLabel), direct/conditional/template literals, pushToast/toast display fields, setSecretMessage.title and direct window.confirm/window.prompt/window.alert first-argument messages. Dynamic display expressions are separate needs_manual_review locations, not untranslated strings.",
    baseline, legacyScope, legacyPathDrift, expandedScope, manualScope, hostEvidence, invalidScopeEdges, scopeDenominators,
    requestedExpandedScopeFiles: expandedScopeFiles, missingExpandedScopeFiles, scopeEdges, manualScopeEdges, integratedDisplayHelperFiles,
    visibleRecoveryScopeFiles, viewportErrorSourceFile: viewportErrorSourceEdge.file, visibleRecoveryRenderBoundary,
    limits: [
      "Schema 5 freezes the prior 82-path schema-4 list and baseline JSON SHA. New exact high-frequency paths, evidence-only helpers and hosts have separate path-set/content hashes. Five-domain denominators count reviewed source paths, never completed translations or all reachable UI.",
      "Scope changes are not translation progress: do not subtract old/new totals or treat literal/dynamic candidate totals as defect totals. Historical source SHA is retained; current legacy source SHA is recomputed independently.",
      "Explicit host/import/JSX/call/reference checks are syntax evidence, not binding analysis or runtime reachability. Missing paths, hosts, re-export barrels or consumer edges fail closed. Evidence hosts never recursively enlarge the AST inventory.",
      "Default chat-style TaskSidePanel artifacts are included; Classic conditional surfaces remain separately described, not inferred unreachable from names. Pure helper manualScope sources are hash-only and require provenance review; their returns are not AST candidates.",
      "Post-integration manualScope retains the original nine sources and eleven display/provenance helpers (eight new helpers plus three changed display opt-ins), plus the exact useBrowserViewport local resize-error producer. Their calls are evidence-only, not returned-string candidates. Canonical labels, local-error provenance, unknown diagnostics and actor-provided values still require manual classification.",
      "The visible-recovery slice explicitly expands the 160-path AST inventory to 166 paths; it does not improve a measured translation coverage percentage. Six files are deduplicated across domains and scope metadata. Scope expansion and added candidates must not be described as translation progress or new confirmed defects.",
      "Not a complete route/call graph, data-flow analysis, rendered-text count or translation coverage percentage.",
      "scope.unscannedTsxFiles lists eligible source paths outside the bounded AST inventory; scope.evidenceOnlyTsxFiles identifies hash-only consumers among them. Neither list classifies untranslated copy or establishes runtime reachability.",
      "Schema 4 adds four exact protocol-display TSX files as a separate scope; earlier scopes and candidate meanings are unchanged. Expanded totals are not directly comparable with schema 3. Original sourceSha256 covers only AST-inventoried files; manualSourceSha256 is separate.",
      "The five manualSourceEvidence files (four TS helpers and one named-details TSX source) are source-hash-only, not AST candidate inventories. Helper return values, canonical matching/deduplication labels and provider/user provenance require manual review; zero automatic candidates is not translation proof. TaskChatProtocolActivityRow.tsx is not added to the scanned files.",
      "Protocol import/render and helper-call edges are bounded explicit evidence checked by the script tests, not a CLI-inferred call graph or runtime reachability proof. Host metadata does not recursively select files; the Classic Task Interface and unverified Card branches are not claimed covered.",
      "Scope and syntax expanded from schema 2: two exact company routes, the build-observation component/direct host, the separate two-file quota scope, ariaLabel and window.confirm/window.prompt/window.alert messages. Candidate totals are not directly comparable with earlier reports.",
      "Consumed-component hosts document bounded verified import/render relationships, not every consumer or a routine route. Host metadata does not recursively add host files to the scanned inventory.",
      "Company route metadata and build-observation component/direct-host inventory are separate exact scopes; the original 21 routine files and three consumed components/five hosts are unchanged. The build-observation direct host is explicitly selected and deduplicated, not recursively discovered.",
      "The separate quota scope selects only AccountQuotaPanels and ProviderQuotaCard; Costs is an already selected entry host. Normal account panels and conditional legacy fallbacks do not establish global usage or translation coverage.",
      "Literal candidates require three consecutive Latin letters or an exact lowercase short display word: in/of/on/or/to/by/as/an/a. Other short text remains outside this predicate; technical identifiers may still be included. Preserve user content, API payloads and unknown server diagnostics after manual origin review.",
      "Only named notification calls, direct object fields and direct window.confirm/window.prompt/window.alert first arguments are recognized; prompt defaults and other arguments are excluded. Aliases, computed keys, shadowed globals, callback returns, other custom prop names and indirect objects need manual review. No automatic rewriting or binding/data-flow resolution.",
      "Technical identifiers and canonical labels translated by child wrappers may remain candidates; needs_manual_review does not mean untranslated. Template interpolation records source syntax only, never user values.",
      "Known t/mimouseT/i18n.t/mimouseI18n.t calls are omitted, not verified as translated. Dynamic snippets are source syntax truncated to 240 characters, never runtime data.",
    ],
    sourceSha256: hash.digest("hex"), requestedBasenames: names, matchedFiles: selected.length,
    unmatchedBasenames, requestedRoutedFiles: routedRoutineFiles, missingRoutedFiles,
    requestedConsumedFiles: consumedUiFiles, missingConsumedFiles,
    requestedCompanyRouteFiles: routedCompanyFiles, missingCompanyRouteFiles,
    requestedBuildObservationFiles: buildObservationFiles, missingBuildObservationFiles,
    requestedQuotaFiles: quotaFiles, missingQuotaFiles,
    requestedProtocolDisplayFiles: protocolDisplayFiles, missingProtocolDisplayFiles,
    requestedManualSourceFiles: manualProtocolFiles, missingManualSourceFiles, manualSourceEvidence, manualSourceSha256,
    scope: { eligibleTsxFiles: all.length, unscannedTsxFiles: all.filter(file => !selected.includes(file)).sort(),
      evidenceOnlyTsxFiles: scopeEvidenceFiles.filter(file => file.endsWith(".tsx") && !selected.includes(file)),
      basenameMatchedFiles: selected.filter(file => matchesEntry(file, names)).length,
      routedMatchedFiles: routedRoutineFiles.length - missingRoutedFiles.length,
      consumedMatchedFiles: consumedUiFiles.length - missingConsumedFiles.length, consumedComponentHosts: consumedUiComponents,
      companyRouteMatchedFiles: routedCompanyFiles.length - missingCompanyRouteFiles.length, companyRoutes: routedCompanyPages,
      buildObservationMatchedFiles: buildObservationFiles.length - missingBuildObservationFiles.length, buildObservationComponentHosts: buildObservationComponents,
      quotaMatchedFiles: quotaFiles.length - missingQuotaFiles.length, quotaComponentHosts: quotaComponents, quotaRenderBoundary,
      protocolDisplayMatchedFiles: protocolDisplayFiles.length - missingProtocolDisplayFiles.length,
      protocolDisplayComponentHosts: protocolDisplayComponents, protocolThreadHosts, protocolRoute, protocolRenderBoundary,
      manualSourceMatchedFiles: manualProtocolFiles.length - missingManualSourceFiles.length,
      previousScopeMatchedFiles: legacySelected.filter(file => !protocolDisplayFiles.includes(file)).length,
      browserMessages: { receiver: "window", methods: browserMessageMethods, messageArgumentIndex: 0 },
      routeSource: "ui/src/App.tsx", routePatterns: ["routines", "routines/:routineId", "routines/:routineId/:section"],
      routeSourceSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "ui/src/App.tsx"))).digest("hex") },
    totalLiteralCandidates: candidates.length, totalDynamicCandidates: dynamicCandidates.length, files: counts, candidates, dynamicCandidates,
  };
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ matchedFiles: result.matchedFiles, totalLiteralCandidates: result.totalLiteralCandidates, totalDynamicCandidates: result.totalDynamicCandidates,
    sourceSha256: result.sourceSha256, manualSourceSha256, missingExpandedScopeFiles, missingScopeHosts: hostEvidence.missingFiles, invalidScopeEdges, legacyPathDrift, unmatchedBasenames, missingRoutedFiles, missingConsumedFiles, missingCompanyRouteFiles, missingBuildObservationFiles, missingQuotaFiles, missingProtocolDisplayFiles, missingManualSourceFiles,
    out: path.resolve(outPath) }, null, 2));
  if (legacyScope.missingFiles.length || legacyPathDrift.length || missingExpandedScopeFiles.length || manualScope.missingFiles.length || hostEvidence.missingFiles.length || invalidScopeEdges.length || missingRoutedFiles.length || missingConsumedFiles.length || missingCompanyRouteFiles.length || missingBuildObservationFiles.length || missingQuotaFiles.length || missingProtocolDisplayFiles.length || missingManualSourceFiles.length || unmatchedBasenames.length) process.exitCode = 1;
}
