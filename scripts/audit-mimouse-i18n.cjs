const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const displayAttributes = new Set(["aria-label", "aria-description", "title", "placeholder", "alt", "label", "description"]);

/** Syntax inventory, not a translation coverage metric. Variables and callbacks
 * may render additional text. Every result still needs human classification. */
function collectCandidates(source, file, parse) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const rows = [], seen = new Set();
  function add(node, value, kind) {
    const text = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{3}/.test(text) || seen.has(node.start)) return;
    seen.add(node.start);
    rows.push({ file, line: node.loc.start.line, kind, text });
  }
  function expression(node) {
    if (!node) return;
    if (node.type === "StringLiteral") add(node, node.value, "jsx-expression");
    else if (node.type === "TemplateLiteral") {
      for (const part of node.quasis) add(part, part.value.cooked ?? part.value.raw, "jsx-template");
    } else if (node.type === "ConditionalExpression") {
      expression(node.consequent); expression(node.alternate);
    } else if (node.type === "LogicalExpression") {
      if (node.operator !== "&&") expression(node.left);
      expression(node.right);
    } else if (node.type === "BinaryExpression" && node.operator === "+") {
      expression(node.left); expression(node.right);
    }
  }
  function walk(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") add(node, node.value, "jsx-text");
    if (node.type === "JSXAttribute" && displayAttributes.has(node.name?.name) && node.value?.type === "StringLiteral") {
      add(node.value, node.value.value, "jsx-attribute");
    }
    if (node.type === "JSXExpressionContainer" && (parent?.type !== "JSXAttribute" || displayAttributes.has(parent.name?.name))) expression(node.expression);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) { for (const item of value) walk(item, node); }
      else if (value && typeof value === "object") walk(value, node);
    }
  }
  walk(ast);
  return rows;
}
module.exports = { collectCandidates };

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
const names=['Auth','InviteLanding','InstanceAccess','ProfileSettings','Dashboard','Issues','IssueDetail','Agents','AgentDetail','Approvals','ApprovalDetail','Routines','Costs','MimouseNotifications','MimouseCoding','MimouseCodingRepair','MimouseWorkbuddy','Sidebar','SidebarProjects','SidebarAgents','SidebarAccountMenu','CompanySwitcher','CompanySettingsSidebar','CommandPalette','NewIssueDialog','IssueProperties','IssueFiltersPopover','CommentThread','BudgetPolicyCard','SubscriptionCostCard','ClaudeSubscriptionPanel','CodexSubscriptionPanel','CloudAccessGate','BootstrapPendingPage','AuthRevocationPanel','InviteAuthMethods','ThemeToggle','InboxAgentPolicyControl','AgentMultiSelect'];
  const all = [];
  function files(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) files(file);
      else if (entry.isFile() && /\.tsx$/.test(file) && !/(?:\.test\.|\.stories\.)/.test(file)) all.push(file);
    }
  }
  files(path.join(root, "ui/src"));
  const selected = all.filter(file => names.includes(path.basename(file, ".tsx"))).sort();
  const candidates = [], counts = [], hash = crypto.createHash("sha256");
  for (const file of selected) {
    const source = fs.readFileSync(file, "utf8"), relative = path.relative(root, file);
    hash.update(relative).update("\0").update(source).update("\0");
    const rows = collectCandidates(source, relative, parse);
    counts.push({ file: relative, literalCandidates: rows.length }); candidates.push(...rows);
  }
  const result = {
    generatedAt: new Date().toISOString(), parserVersion,
    method: "JSXText, selected display attributes and direct/conditional JSX literal expressions; candidates, not coverage percentage. Dynamic variables, functions, error messages and custom controls require manual review.",
    sourceSha256: hash.digest("hex"), requestedBasenames: names, matchedFiles: selected.length,
    unmatchedBasenames: names.filter(name => !selected.some(file => path.basename(file, ".tsx") === name)),
    totalLiteralCandidates: candidates.length, files: counts, candidates,
  };
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ matchedFiles: result.matchedFiles, totalLiteralCandidates: result.totalLiteralCandidates, sourceSha256: result.sourceSha256, unmatchedBasenames: result.unmatchedBasenames, out: path.resolve(outPath) }, null, 2));
}
