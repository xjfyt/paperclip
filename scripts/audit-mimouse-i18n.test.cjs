const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { collectCandidates, collectAudit, selectInventory, routedRoutineFiles, consumedUiComponents, consumedUiFiles } = require("./audit-mimouse-i18n.cjs");
const parserEntry = process.env.AUDIT_I18N_PARSER
  ? path.resolve(process.env.AUDIT_I18N_PARSER)
  : path.resolve(__dirname, "../node_modules/.pnpm/@babel+parser@7.29.8/node_modules/@babel/parser/lib/index.js");
const { parse } = require(parserEntry);
const texts = source => collectCandidates(source, "fixture.tsx", parse).map(row => row.text);
test("counts UI literals, not conditional classes, routes, test IDs or translated keys", () => {
  assert.deepEqual(texts('const x = <div className={ok ? "bg-red text-white" : "bg-blue"} data-testid="secret-example" title="Help"><span>Hello world</span>{ok ? t("some.key") : "Not ready"}<a href="https://example.invalid">Link</a></div>'), ["Help", "Hello world", "Not ready", "Link"]);
});
test("records template fragments without reading interpolated user content", () => {
  assert.deepEqual(texts('const x = <span>{`Rows ${userCount}`}{userText}</span>'), ["Rows"]);
});
test("includes display attributes and excludes non-display expression attributes", () => {
  assert.deepEqual(texts('const x = <input aria-label={busy ? "Working" : "Ready"} placeholder="Your name" autoComplete={mode ? "new-password" : "current-password"}/>'), ["Working", "Ready", "Your name"]);
});
test("explicitly leaves function-generated text and technical strings for manual review", () => {
  assert.deepEqual(texts('const x = <p>{displayName(user)}{localT("hello")}{"USD"}{"123"}</p>'), ["USD"]);
});

test("does not count status comparisons or logical guards as displayed text", () => {
  assert.deepEqual(texts('const x = <p>{status === "needs_setup" && <span>Set up</span>}{mode !== "sign_up" || "Sign up"}{"guard" && "Shown"}</p>'), ["Set up", "Sign up", "Shown"]);
});

const { matchesEntry } = require("./audit-mimouse-i18n.cjs");
test("includes production and legacy route implementations but not unrelated basenames", () => {
  assert.equal(matchesEntry("ui/src/pages/Agents.production.tsx", ["Agents"]), true);
  assert.equal(matchesEntry("ui/src/pages/Agents.tsx", ["Agents"]), true);
  assert.equal(matchesEntry("ui/src/components/IssuesList.tsx", ["IssuesList"]), true);
  assert.equal(matchesEntry("ui/src/pages/Unrelated.tsx", ["Agents"]), false);
});

const audit = source => collectAudit(source, "fixture.tsx", parse);
test("includes standalone in in JSX and selected display attributes as manual-review candidates", () => {
  const result = audit('const x = <><span> in </span><input title="in" aria-label={"in"} /></>;');
  assert.deepEqual(result.candidates.map(row => row.text), ["in", "in", "in"]);
  assert.deepEqual(result.candidates.map(row => row.kind), ["jsx-text", "jsx-attribute", "jsx-expression"]);
  assert.ok(result.candidates.every(row => row.classification === "needs_manual_review"));
});

test("only adds the bounded standalone lowercase short-word allowlist", () => {
  const words = ["in", "of", "on", "or", "to", "by", "as", "an", "a"];
  assert.deepEqual(texts(`const x = <>${words.map(word => `<span>${word}</span>`).join("")}</>;`), words);
  assert.deepEqual(texts('const x = <p>{"CI"}{"UI"}{"ID"}{"PR"}{"MR"}{"IN"}{"OF"}{"xy"}{"a1"}{"or_"}{"/in"}{"API"}</p>;'), ["API"]);
});

test("short words do not widen scanning to API payloads or non-display props or reclassify raw data", () => {
  const result = audit(`api.update({ title: "in", description: "of", message: "on" });
    const x = <a className="in" data-testid="of" href="/in" id="or" title={data.title}>{error.message}{t("in")}</a>;`);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["data.title", "error.message"]);
  assert.ok(result.dynamicCandidates.every(row => row.classification === "needs_manual_review"));
});

test("inventories EmptyState message literals and raw diagnostics separately", () => {
  const result = audit(`const x = <EmptyState
    message={error instanceof Error ? error.message : "Unable to load routine"}
    description="Try again" title={t("routine.title")} />;`);
  assert.deepEqual(result.candidates.map(row => row.text), ["Unable to load routine", "Try again"]);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["error.message"]);
  assert.equal(result.candidates[0].line, 2);
  assert.equal(result.dynamicCandidates[0].line, 2);
  assert.ok([...result.candidates, ...result.dynamicCandidates].every(row => row.classification === "needs_manual_review"));
});

test("inventories toast title/body/description/message without metadata or API payloads", () => {
  const result = audit(`
    api.update({ title: "User authored title", description: "Saved user content", message: "Protocol payload" });
    pushToast({ title: "Routine saved", body: error.message, description: "Review details", message: "Done now",
      id: "routine-updated", tone: "success", action: { href: "/routines", label: "Action outside this narrow inventory" } });
  `);
  assert.deepEqual(result.candidates.map(row => row.text), ["Routine saved", "Review details", "Done now"]);
  assert.deepEqual(result.candidates.map(row => row.kind), ["toast-title", "toast-description", "toast-message"]);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["error.message"]);
  assert.equal(result.dynamicCandidates[0].kind, "toast-body-dynamic");
});

test("captures conditional and template toast fragments but not guards or interpolated content", () => {
  const result = audit('pushToast({ title: `${label} copied`, body: status === "paused" ? "Automation paused" : formatResult(result), description: `${busy ? "Working" : "Ready"}` });');
  assert.deepEqual(result.candidates.map(row => row.text), ["copied", "Automation paused", "Working", "Ready"]);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["label", "formatResult(result)"]);
});

test("known translation calls do not turn keys or user interpolation into literal candidates", () => {
  const result = audit(`pushToast({ title: t("routine.saved", { name: user.name }), body: mimouseT("routine.body") });
    const x = <EmptyState message={i18n.t("routine.empty")} title={t(dynamicKey)} />;
    pushToast({ title: \`\${t("routine.saved")}\` });`);
  assert.deepEqual(result, { candidates: [], dynamicCandidates: [] });
});

test("records unresolved toast objects/spreads and only the known secret-message display field", () => {
  const result = audit(`pushToast(notification); toast({ ...notice, title: "Please review" });
    setSecretMessage({ title: "Webhook created", entries: [{ webhookSecret: "Never translate credentials" }] });
    const payload = { title: "User title", description: "User description" };`);
  assert.deepEqual(result.candidates.map(row => row.text), ["Please review", "Webhook created"]);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["notification", "notice"]);
  assert.ok(result.dynamicCandidates.every(row => row.classification === "needs_manual_review"));
});

test("reports displayed dynamic values for review without tracing or rewriting user content", () => {
  const result = audit(`const x = <p title={routine.title}>{actionLabel(event.action)}{userText}{JSON.stringify(event.details)}
    {status === "active" && <span>Ready now</span>}{t("ready", { value: "Preserved original" })}</p>`);
  assert.deepEqual(result.candidates.map(row => row.text), ["Ready now"]);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["routine.title", "actionLabel(event.action)", "userText", "JSON.stringify(event.details)"]);
});

test("uses exact route-related paths and reports missing inventory rather than silently narrowing it", () => {
  const inventory = selectInventory([
    ...routedRoutineFiles, "ui/src/pages/Auth.tsx", "ui/src/elsewhere/RoutineDetail.tsx",
    "ui/src/pages/Routines.production.tsx", "ui/src/elsewhere/RoutineList.tsx",
    "ui/src/elsewhere/index.tsx", "ui/src/elsewhere/Row.tsx", "ui/src/elsewhere/FolderControls.tsx",
    "ui/src/elsewhere/AgentSetupPrompt.tsx", "ui/src/elsewhere/SecretPicker.tsx",
    "ui/src/components/routine-sections/operate-sections.test.tsx",
    "ui/src/components/routine-triggers/TriggerWizard.stories.tsx",
  ]);
  assert.equal(routedRoutineFiles.length, 21);
  assert.deepEqual(inventory.selected, ["ui/src/pages/Auth.tsx", ...routedRoutineFiles].sort());
  assert.equal(inventory.selected.filter(file => file === "ui/src/pages/Routines.production.tsx").length, 1);
  assert.deepEqual(inventory.missingRoutedFiles, []);
  const missing = routedRoutineFiles[0];
  assert.deepEqual(selectInventory(routedRoutineFiles.slice(1)).missingRoutedFiles, [missing]);
  for (const file of routedRoutineFiles) {
    assert.deepEqual(selectInventory(routedRoutineFiles.filter(entry => entry !== file)).missingRoutedFiles, [file]);
  }
});


test("selects only the three exact consumed component paths without widening routine scope", () => {
  assert.deepEqual(consumedUiFiles, [
    "ui/src/components/task-chat/ComposerRunSettingsPicker.tsx",
    "ui/src/components/transcript/RunTranscriptView.tsx",
    "ui/src/components/task-chat/TaskChatComposer.tsx",
  ]);
  const wrongPaths = consumedUiFiles.flatMap(file => [
    `ui/src/elsewhere/${path.basename(file)}`,
    file.replace(".tsx", ".production.tsx"), file.replace(".tsx", ".legacy.tsx"),
    file.replace(".tsx", ".test.tsx"), file.replace(".tsx", ".stories.tsx"),
  ]);
  const inventory = selectInventory([...routedRoutineFiles, ...consumedUiFiles, ...consumedUiFiles, ...wrongPaths]);
  assert.deepEqual(inventory.selected, [...routedRoutineFiles, ...consumedUiFiles].sort());
  assert.deepEqual(inventory.missingConsumedFiles, []);
  assert.deepEqual(inventory.missingRoutedFiles, []);
  assert.equal(routedRoutineFiles.length, 21);
  assert.ok(consumedUiFiles.every(file => !routedRoutineFiles.includes(file)));
  assert.deepEqual(selectInventory(wrongPaths).selected, []);
  assert.deepEqual(selectInventory(wrongPaths).missingConsumedFiles, consumedUiFiles);
});

test("reports each missing consumed path even when a same-basename substitute exists", () => {
  for (const missing of consumedUiFiles) {
    const inventory = selectInventory([
      ...routedRoutineFiles, ...consumedUiFiles.filter(file => file !== missing),
      `ui/src/elsewhere/${path.basename(missing)}`, missing.replace(".tsx", ".production.tsx"),
    ]);
    assert.deepEqual(inventory.missingConsumedFiles, [missing]);
    assert.deepEqual(inventory.missingRoutedFiles, []);
  }
});

test("recorded hosts really import and render the exact consumed components", () => {
  const root = path.resolve(__dirname, "..");
  for (const { file, hosts } of consumedUiComponents) {
    assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
    assert.ok(hosts.length > 0, file);
    for (const host of hosts) {
      const resolved = host.importSource.startsWith("@/")
        ? `ui/src/${host.importSource.slice(2)}.tsx`
        : path.posix.normalize(`${path.posix.dirname(host.file)}/${host.importSource}.tsx`);
      assert.equal(resolved, file);
      const source = fs.readFileSync(path.join(root, host.file), "utf8");
      const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
      const declaration = ast.program.body.find(node => node.type === "ImportDeclaration" && node.source.value === host.importSource);
      const symbol = path.basename(file, ".tsx");
      const binding = declaration?.specifiers.find(node => node.type === "ImportSpecifier" && node.imported.name === symbol && node.importKind !== "type");
      assert.ok(binding && declaration.importKind !== "type", `${host.file} must import ${symbol}`);
      let renders = false;
      function walk(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier" && node.name.name === binding.local.name) renders = true;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === "object") walk(value);
        }
      }
      walk(ast.program);
      assert.equal(renders, true, `${host.file} must render ${symbol}`);
    }
  }
});

function cliFixture(t, missing) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mimouse-i18n-inventory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  };
  write("scripts/audit-mimouse-i18n.cjs", fs.readFileSync(path.join(__dirname, "audit-mimouse-i18n.cjs")));
  write("ui/src/App.tsx", "export const App = () => null;");
  const files = [
    ...selectInventory([]).unmatchedBasenames.map(name => `ui/src/pages/${name}.tsx`),
    ...routedRoutineFiles, ...consumedUiFiles,
  ];
  for (const file of files.filter(file => file !== missing)) write(file, "export const View = () => <span />;");
  if (missing) write(`ui/src/elsewhere/${path.basename(missing)}`, "export const Unused = () => <span />;");
  const out = path.join(root, "report.json");
  const result = spawnSync(process.execPath, [path.join(root, "scripts/audit-mimouse-i18n.cjs"), "--parser", parserEntry, "--out", out], { encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { result, report: JSON.parse(fs.readFileSync(out, "utf8")) };
}

test("CLI keeps consumed host metadata separate from the unchanged routine route scope", t => {
  const { result, report } = cliFixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(report.requestedConsumedFiles, consumedUiFiles);
  assert.deepEqual(report.missingConsumedFiles, []);
  assert.deepEqual(report.scope.consumedComponentHosts, consumedUiComponents);
  assert.equal(report.scope.consumedMatchedFiles, 3);
  assert.equal(report.scope.routedMatchedFiles, 21);
  assert.deepEqual(report.requestedRoutedFiles, routedRoutineFiles);
  assert.equal(report.scope.routeSource, "ui/src/App.tsx");
  assert.deepEqual(report.scope.routePatterns, ["routines", "routines/:routineId", "routines/:routineId/:section"]);
  assert.equal(report.files.some(row => row.file === "ui/src/components/TaskChatThread.tsx"), false);
  assert.ok(report.limits.some(limit => limit.includes("not every consumer or a routine route")));
});

test("CLI fails closed for a missing consumed component instead of accepting its wrong-path duplicate", t => {
  const missing = consumedUiFiles[0];
  const { result, report } = cliFixture(t, missing);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(report.missingConsumedFiles, [missing]);
  assert.deepEqual(report.missingRoutedFiles, []);
  assert.deepEqual(report.unmatchedBasenames, []);
  assert.equal(report.scope.consumedMatchedFiles, 2);
  assert.equal(report.files.some(row => row.file === `ui/src/elsewhere/${path.basename(missing)}`), false);
});
