const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const displayAttributes = new Set(["aria-label", "aria-description", "title", "placeholder", "alt", "label", "description", "message"]);
const toastFields = new Set(["title", "body", "description", "message"]);
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
];

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
    if (!/[A-Za-z]{3}/.test(text) || seen.has(node.start)) return;
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
  function walk(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") add(node, node.value, "jsx-text");
    if (node.type === "JSXAttribute" && displayAttributes.has(node.name?.name) && node.value?.type === "StringLiteral") {
      add(node.value, node.value.value, "jsx-attribute");
    }
    if (node.type === "JSXExpressionContainer" && (parent?.type !== "JSXAttribute" || displayAttributes.has(parent.name?.name))) expression(node.expression);
    if (node.type === "CallExpression") notification(node);
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
  const selected = [...new Set(eligible.filter(file => matchesEntry(file, names) || routedRoutineFiles.includes(file)))].sort();
  return {
    selected,
    missingRoutedFiles: routedRoutineFiles.filter(file => !selected.includes(file)),
    unmatchedBasenames: names.filter(name => !selected.some(file => matchesEntry(file, [name]))),
  };
}
module.exports = { collectCandidates, collectAudit, matchesEntry, selectInventory, routedRoutineFiles };

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
  const { selected, missingRoutedFiles, unmatchedBasenames } = selectInventory(all);
  const candidates = [], dynamicCandidates = [], counts = [], hash = crypto.createHash("sha256");
  for (const relative of selected) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    hash.update(relative).update("\0").update(source).update("\0");
    const rows = collectAudit(source, relative, parse);
    counts.push({ file: relative, literalCandidates: rows.candidates.length, dynamicCandidates: rows.dynamicCandidates.length });
    candidates.push(...rows.candidates); dynamicCandidates.push(...rows.dynamicCandidates);
  }
  const result = {
    schemaVersion: 2, generatedAt: new Date().toISOString(), parserVersion,
    method: "Bounded Babel AST inventory: JSX text/display attributes (including message), direct/conditional/template literals, pushToast/toast display fields and setSecretMessage.title. Dynamic display expressions are separate needs_manual_review locations, not untranslated strings.",
    limits: [
      "Not a complete route/call graph, data-flow analysis, rendered-text count or translation coverage percentage.",
      "Literal candidates require three consecutive Latin letters; technical identifiers may be included. Preserve user content, API payloads and unknown server diagnostics after manual origin review.",
      "Only named notification calls and direct object fields are recognized; aliases, computed keys, callback returns, custom prop names and indirect objects need manual review. No automatic rewriting.",
      "Known t/mimouseT/i18n.t/mimouseI18n.t calls are omitted, not verified as translated. Dynamic snippets are source syntax truncated to 240 characters, never runtime data.",
    ],
    sourceSha256: hash.digest("hex"), requestedBasenames: names, matchedFiles: selected.length,
    unmatchedBasenames, requestedRoutedFiles: routedRoutineFiles, missingRoutedFiles,
    scope: { eligibleTsxFiles: all.length, basenameMatchedFiles: selected.filter(file => matchesEntry(file, names)).length,
      routedMatchedFiles: routedRoutineFiles.length - missingRoutedFiles.length,
      routeSource: "ui/src/App.tsx", routePatterns: ["routines", "routines/:routineId", "routines/:routineId/:section"],
      routeSourceSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "ui/src/App.tsx"))).digest("hex") },
    totalLiteralCandidates: candidates.length, totalDynamicCandidates: dynamicCandidates.length, files: counts, candidates, dynamicCandidates,
  };
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ matchedFiles: result.matchedFiles, totalLiteralCandidates: result.totalLiteralCandidates, totalDynamicCandidates: result.totalDynamicCandidates,
    sourceSha256: result.sourceSha256, unmatchedBasenames, missingRoutedFiles, out: path.resolve(outPath) }, null, 2));
  if (missingRoutedFiles.length || unmatchedBasenames.length) process.exitCode = 1;
}
