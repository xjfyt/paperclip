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
    || protocolDisplayFiles.includes(file)))].sort();
  return {
    selected,
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
  manualProtocolSources, manualProtocolFiles, collectManualSourceEvidence };

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
  const { selected, missingRoutedFiles, missingConsumedFiles, missingCompanyRouteFiles, missingBuildObservationFiles, missingQuotaFiles, missingProtocolDisplayFiles, unmatchedBasenames } = selectInventory(all);
  const { manualSourceEvidence, missingManualSourceFiles, manualSourceSha256 } = collectManualSourceEvidence(root);
  const candidates = [], dynamicCandidates = [], counts = [], hash = crypto.createHash("sha256");
  for (const relative of selected) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    hash.update(relative).update("\0").update(source).update("\0");
    const rows = collectAudit(source, relative, parse);
    counts.push({ file: relative, literalCandidates: rows.candidates.length, dynamicCandidates: rows.dynamicCandidates.length });
    candidates.push(...rows.candidates); dynamicCandidates.push(...rows.dynamicCandidates);
  }
  const result = {
    schemaVersion: 4, generatedAt: new Date().toISOString(), parserVersion,
    method: "Bounded Babel AST inventory: JSX text/display attributes (including message and ariaLabel), direct/conditional/template literals, pushToast/toast display fields, setSecretMessage.title and direct window.confirm/window.prompt/window.alert first-argument messages. Dynamic display expressions are separate needs_manual_review locations, not untranslated strings.",
    limits: [
      "Not a complete route/call graph, data-flow analysis, rendered-text count or translation coverage percentage.",
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
    scope: { eligibleTsxFiles: all.length, basenameMatchedFiles: selected.filter(file => matchesEntry(file, names)).length,
      routedMatchedFiles: routedRoutineFiles.length - missingRoutedFiles.length,
      consumedMatchedFiles: consumedUiFiles.length - missingConsumedFiles.length, consumedComponentHosts: consumedUiComponents,
      companyRouteMatchedFiles: routedCompanyFiles.length - missingCompanyRouteFiles.length, companyRoutes: routedCompanyPages,
      buildObservationMatchedFiles: buildObservationFiles.length - missingBuildObservationFiles.length, buildObservationComponentHosts: buildObservationComponents,
      quotaMatchedFiles: quotaFiles.length - missingQuotaFiles.length, quotaComponentHosts: quotaComponents, quotaRenderBoundary,
      protocolDisplayMatchedFiles: protocolDisplayFiles.length - missingProtocolDisplayFiles.length,
      protocolDisplayComponentHosts: protocolDisplayComponents, protocolThreadHosts, protocolRoute, protocolRenderBoundary,
      manualSourceMatchedFiles: manualProtocolFiles.length - missingManualSourceFiles.length,
      previousScopeMatchedFiles: selected.filter(file => !protocolDisplayFiles.includes(file)).length,
      browserMessages: { receiver: "window", methods: browserMessageMethods, messageArgumentIndex: 0 },
      routeSource: "ui/src/App.tsx", routePatterns: ["routines", "routines/:routineId", "routines/:routineId/:section"],
      routeSourceSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "ui/src/App.tsx"))).digest("hex") },
    totalLiteralCandidates: candidates.length, totalDynamicCandidates: dynamicCandidates.length, files: counts, candidates, dynamicCandidates,
  };
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ matchedFiles: result.matchedFiles, totalLiteralCandidates: result.totalLiteralCandidates, totalDynamicCandidates: result.totalDynamicCandidates,
    sourceSha256: result.sourceSha256, manualSourceSha256, unmatchedBasenames, missingRoutedFiles, missingConsumedFiles, missingCompanyRouteFiles, missingBuildObservationFiles, missingQuotaFiles, missingProtocolDisplayFiles, missingManualSourceFiles,
    out: path.resolve(outPath) }, null, 2));
  if (missingRoutedFiles.length || missingConsumedFiles.length || missingCompanyRouteFiles.length || missingBuildObservationFiles.length || missingQuotaFiles.length || missingProtocolDisplayFiles.length || missingManualSourceFiles.length || unmatchedBasenames.length) process.exitCode = 1;
}
