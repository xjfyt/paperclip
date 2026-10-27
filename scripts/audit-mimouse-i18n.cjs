const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const displayAttributes = new Set(["aria-label", "ariaLabel", "aria-description", "title", "placeholder", "alt", "label", "description", "message"]);
const toastFields = new Set(["title", "body", "description", "message"]);
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
  function nativeConfirm(node) {
    const callee = node.callee;
    if (callee.type !== "MemberExpression" || callee.computed
      || callee.object.type !== "Identifier" || callee.object.name !== "window"
      || callee.property.name !== "confirm") return;
    expression(node.arguments[0], "window-confirm", "window-confirm-dynamic");
  }
  function walk(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") add(node, node.value, "jsx-text");
    if (node.type === "JSXAttribute" && displayAttributes.has(node.name?.name) && node.value?.type === "StringLiteral") {
      add(node.value, node.value.value, "jsx-attribute");
    }
    if (node.type === "JSXExpressionContainer" && (parent?.type !== "JSXAttribute" || displayAttributes.has(parent.name?.name))) expression(node.expression);
    if (node.type === "CallExpression") { notification(node); nativeConfirm(node); }
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
    || consumedUiFiles.includes(file) || routedCompanyFiles.includes(file) || buildObservationFiles.includes(file)))].sort();
  return {
    selected,
    missingRoutedFiles: routedRoutineFiles.filter(file => !selected.includes(file)),
    missingConsumedFiles: consumedUiFiles.filter(file => !selected.includes(file)),
    missingCompanyRouteFiles: routedCompanyFiles.filter(file => !selected.includes(file)),
    missingBuildObservationFiles: buildObservationFiles.filter(file => !selected.includes(file)),
    unmatchedBasenames: names.filter(name => !selected.some(file => matchesEntry(file, [name]))),
  };
}
module.exports = { collectCandidates, collectAudit, matchesEntry, selectInventory, routedRoutineFiles, consumedUiComponents, consumedUiFiles,
  routedCompanyPages, routedCompanyFiles, buildObservationComponents, buildObservationFiles };

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
  const { selected, missingRoutedFiles, missingConsumedFiles, missingCompanyRouteFiles, missingBuildObservationFiles, unmatchedBasenames } = selectInventory(all);
  const candidates = [], dynamicCandidates = [], counts = [], hash = crypto.createHash("sha256");
  for (const relative of selected) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    hash.update(relative).update("\0").update(source).update("\0");
    const rows = collectAudit(source, relative, parse);
    counts.push({ file: relative, literalCandidates: rows.candidates.length, dynamicCandidates: rows.dynamicCandidates.length });
    candidates.push(...rows.candidates); dynamicCandidates.push(...rows.dynamicCandidates);
  }
  const result = {
    schemaVersion: 3, generatedAt: new Date().toISOString(), parserVersion,
    method: "Bounded Babel AST inventory: JSX text/display attributes (including message and ariaLabel), direct/conditional/template literals, pushToast/toast display fields, setSecretMessage.title and direct window.confirm messages. Dynamic display expressions are separate needs_manual_review locations, not untranslated strings.",
    limits: [
      "Not a complete route/call graph, data-flow analysis, rendered-text count or translation coverage percentage.",
      "Scope and syntax expanded from schema 2: two exact company routes, the build-observation component/direct host, ariaLabel and window.confirm. Candidate totals are not directly comparable with earlier reports.",
      "Consumed-component hosts document bounded verified import/render relationships, not every consumer or a routine route. Host metadata does not recursively add host files to the scanned inventory.",
      "Company route metadata and build-observation component/direct-host inventory are separate exact scopes; the original 21 routine files and three consumed components/five hosts are unchanged. The build-observation direct host is explicitly selected and deduplicated, not recursively discovered.",
      "Literal candidates require three consecutive Latin letters or an exact lowercase short display word: in/of/on/or/to/by/as/an/a. Other short text remains outside this predicate; technical identifiers may still be included. Preserve user content, API payloads and unknown server diagnostics after manual origin review.",
      "Only named notification calls, direct object fields and direct window.confirm syntax are recognized; aliases, computed keys, shadowed globals, callback returns, other custom prop names and indirect objects need manual review. No automatic rewriting or binding/data-flow resolution.",
      "Technical identifiers and canonical labels translated by child wrappers may remain candidates; needs_manual_review does not mean untranslated. Template interpolation records source syntax only, never user values.",
      "Known t/mimouseT/i18n.t/mimouseI18n.t calls are omitted, not verified as translated. Dynamic snippets are source syntax truncated to 240 characters, never runtime data.",
    ],
    sourceSha256: hash.digest("hex"), requestedBasenames: names, matchedFiles: selected.length,
    unmatchedBasenames, requestedRoutedFiles: routedRoutineFiles, missingRoutedFiles,
    requestedConsumedFiles: consumedUiFiles, missingConsumedFiles,
    requestedCompanyRouteFiles: routedCompanyFiles, missingCompanyRouteFiles,
    requestedBuildObservationFiles: buildObservationFiles, missingBuildObservationFiles,
    scope: { eligibleTsxFiles: all.length, basenameMatchedFiles: selected.filter(file => matchesEntry(file, names)).length,
      routedMatchedFiles: routedRoutineFiles.length - missingRoutedFiles.length,
      consumedMatchedFiles: consumedUiFiles.length - missingConsumedFiles.length, consumedComponentHosts: consumedUiComponents,
      companyRouteMatchedFiles: routedCompanyFiles.length - missingCompanyRouteFiles.length, companyRoutes: routedCompanyPages,
      buildObservationMatchedFiles: buildObservationFiles.length - missingBuildObservationFiles.length, buildObservationComponentHosts: buildObservationComponents,
      routeSource: "ui/src/App.tsx", routePatterns: ["routines", "routines/:routineId", "routines/:routineId/:section"],
      routeSourceSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "ui/src/App.tsx"))).digest("hex") },
    totalLiteralCandidates: candidates.length, totalDynamicCandidates: dynamicCandidates.length, files: counts, candidates, dynamicCandidates,
  };
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ matchedFiles: result.matchedFiles, totalLiteralCandidates: result.totalLiteralCandidates, totalDynamicCandidates: result.totalDynamicCandidates,
    sourceSha256: result.sourceSha256, unmatchedBasenames, missingRoutedFiles, missingConsumedFiles, missingCompanyRouteFiles, missingBuildObservationFiles,
    out: path.resolve(outPath) }, null, 2));
  if (missingRoutedFiles.length || missingConsumedFiles.length || missingCompanyRouteFiles.length || missingBuildObservationFiles.length || unmatchedBasenames.length) process.exitCode = 1;
}
