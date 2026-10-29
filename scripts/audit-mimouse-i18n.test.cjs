const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { collectCandidates, collectAudit, selectInventory, routedRoutineFiles, consumedUiComponents, consumedUiFiles,
  routedCompanyPages, routedCompanyFiles, buildObservationComponents, buildObservationFiles,
  quotaComponents, quotaFiles, quotaRenderBoundary, browserMessageMethods,
  protocolDisplayComponents, protocolDisplayFiles, protocolThreadHosts, protocolRoute, protocolRenderBoundary,
  manualProtocolSources, manualProtocolFiles, collectManualSourceEvidence,
  baselineFile, baselineFileSha256, readBaseline, pathSetSha256, expandedScopeFiles, scopeEdges, manualScopeEdges, manualScopeFiles,
  scopeEvidenceFiles, integratedDisplayHelperEdges, integratedDisplayHelperFiles, visibleRecoveryScopeEdges, visibleRecoveryScopeFiles, viewportErrorSourceEdge, visibleRecoveryRenderBoundary,
  adapterConfigurationScopeEdges, adapterConfigurationDispatch,
  legacyDomain, sourceInventory, consumesEdge, verifyScopeEdges, collectScopeDenominators } = require("./audit-mimouse-i18n.cjs");
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
test("includes only the known custom ariaLabel prop and preserves manual classification", () => {
  const result = audit(`const x = <><CopyText ariaLabel="Copy public key" />
    <CopyText ariaLabel={busy ? "Copying public key" : t("copy.publicKey", { name: user.name })} />
    <CopyText ariaLabel={\`Copy \${user.name}\`} copyAriaLabel="Unknown custom prop" />
    <PropertyRow label="Status">{"SHA-256"}</PropertyRow></>;`);
  assert.deepEqual(result.candidates.map(row => row.text), ["Copy public key", "Copying public key", "Copy", "Status", "SHA-256"]);
  assert.equal(result.candidates[0].kind, "jsx-attribute");
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["user.name"]);
  assert.ok([...result.candidates, ...result.dynamicCandidates].every(row => row.classification === "needs_manual_review"));
});

test("inventories direct window.confirm message fragments without evaluating user interpolation", () => {
  const result = audit(`window.confirm("Archive this company?");
    window.confirm(\`Delete \${company.name}? This cannot be undone.\`);
    window.confirm(enabled ? "Continue anyway?" : diagnostic.message);
    window.confirm("Remove " + user.name);
    window.confirm();`);
  assert.deepEqual(result.candidates.map(row => row.text), ["Archive this company?", "Delete", "? This cannot be undone.", "Continue anyway?", "Remove"]);
  assert.ok(result.candidates.every(row => row.kind === "window-confirm"));
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["company.name", "diagnostic.message", "user.name"]);
  assert.ok(result.dynamicCandidates.every(row => row.kind === "window-confirm-dynamic"));
  assert.equal(result.candidates[1].line, 2);
  assert.ok([...result.candidates, ...result.dynamicCandidates].every(row => row.classification === "needs_manual_review"));
});

test("omits translated ariaLabel and confirm keys without widening to arbitrary confirm APIs", () => {
  const result = audit(`const x = <CopyText ariaLabel={mimouseT("copy.key", { name: user.name })} />;
    window.confirm(t("archive.confirm", { companyName: company.name }));
    window.confirm(\`\${i18n.t("archive.confirm")}\`);
    window.confirm(mimouseI18n.t(dynamicKey));
    confirm("Bare alias outside scope"); dialogs.confirm("Custom API outside scope");
    window["confirm"]("Computed key outside scope"); globalThis.confirm("Other global outside scope");
    const payload = { ariaLabel: "Non JSX payload", message: "Not a confirmation" };`);
  assert.deepEqual(result, { candidates: [], dynamicCandidates: [] });
});

test("inventories prompt and alert first-argument messages but never prompt defaults or user value arguments", () => {
  const result = audit(`window.prompt("Rename organization", "Original user-authored name");
    window.prompt(\`Rename \${company.name}\`, \`Current \${user.value}\`);
    window.prompt(t("rename.prompt", { name: company.name }), "Untranslated raw default");
    window.alert("Organization archived", "Ignored extra value");
    window.alert(\`Archived \${company.name}\`);
    window.alert(ok ? t("success") : "Unable to archive");
    window.prompt(); window.alert();`);
  assert.deepEqual(result.candidates.map(row => row.text), ["Rename organization", "Rename", "Organization archived", "Archived", "Unable to archive"]);
  assert.deepEqual(result.candidates.map(row => row.kind), ["window-prompt", "window-prompt", "window-alert", "window-alert", "window-alert"]);
  assert.deepEqual(result.dynamicCandidates.map(row => [row.expression, row.kind]), [
    ["company.name", "window-prompt-dynamic"], ["company.name", "window-alert-dynamic"],
  ]);
  assert.ok([...result.candidates, ...result.dynamicCandidates].every(row => row.classification === "needs_manual_review"));
});

test("browser-message support is limited to the three direct window methods and excludes translated messages", () => {
  assert.deepEqual(browserMessageMethods, ["confirm", "prompt", "alert"]);
  for (const method of browserMessageMethods) {
    const result = audit(`window.${method}(mimouseT("message.key", { value: user.value }), user.value);
      window.${method}(\`\${i18n.t("message.key")}\`, "Do not translate default");
      window.${method}(mimouseI18n.t(dynamicKey));
      ${method}("Bare call outside scope"); custom.${method}("Custom API outside scope");
      window["${method}"]("Computed call outside scope"); globalThis.${method}("Other global outside scope");`);
    assert.deepEqual(result, { candidates: [], dynamicCandidates: [] });
  }
});

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

test("adds only two exact company routes and the explicit build-observation component/direct host", () => {
  assert.deepEqual(routedCompanyFiles, ["ui/src/pages/Companies.tsx", "ui/src/pages/CompanySettings.tsx"]);
  assert.deepEqual(buildObservationFiles, ["ui/src/components/MimouseBuildObservations.tsx", "ui/src/pages/MimouseCoding.tsx"]);
  const exactOnly = [...routedCompanyFiles, buildObservationFiles[0]];
  const wrongPaths = exactOnly.flatMap(file => [
    `ui/src/elsewhere/${path.basename(file)}`, file.replace(".tsx", ".production.tsx"),
    file.replace(".tsx", ".legacy.tsx"), file.replace(".tsx", ".test.tsx"), file.replace(".tsx", ".stories.tsx"),
  ]);
  const inventory = selectInventory([...routedCompanyFiles, ...buildObservationFiles, ...buildObservationFiles, ...wrongPaths]);
  assert.deepEqual(inventory.selected, [...routedCompanyFiles, ...buildObservationFiles].sort());
  assert.deepEqual(inventory.missingCompanyRouteFiles, []);
  assert.deepEqual(inventory.missingBuildObservationFiles, []);
  assert.deepEqual(selectInventory(wrongPaths).selected, []);
  assert.deepEqual(selectInventory(wrongPaths).missingCompanyRouteFiles, routedCompanyFiles);
  assert.deepEqual(selectInventory(wrongPaths).missingBuildObservationFiles, buildObservationFiles);
  assert.equal(routedRoutineFiles.length, 21);
  assert.equal(consumedUiFiles.length, 3);
  assert.equal(consumedUiComponents.flatMap(component => component.hosts).length, 5);
  assert.ok([...routedCompanyFiles, ...buildObservationFiles].every(file => !routedRoutineFiles.includes(file) && !consumedUiFiles.includes(file)));
});

test("keeps quota exact paths separate without production, legacy or wrong-directory expansion", () => {
  assert.deepEqual(quotaFiles, ["ui/src/components/AccountQuotaPanels.tsx", "ui/src/components/ProviderQuotaCard.tsx"]);
  const wrongPaths = quotaFiles.flatMap(file => [
    `ui/src/elsewhere/${path.basename(file)}`, file.replace(".tsx", ".production.tsx"),
    file.replace(".tsx", ".legacy.tsx"), file.replace(".tsx", ".test.tsx"), file.replace(".tsx", ".stories.tsx"),
  ]);
  assert.deepEqual(selectInventory([...quotaFiles, ...quotaFiles, ...wrongPaths]).selected, quotaFiles);
  assert.deepEqual(selectInventory(wrongPaths).selected, []);
  assert.deepEqual(selectInventory(wrongPaths).missingQuotaFiles, quotaFiles);
  assert.ok(quotaFiles.every(file => !routedRoutineFiles.includes(file) && !consumedUiFiles.includes(file)
    && !routedCompanyFiles.includes(file) && !buildObservationFiles.includes(file)));
  assert.equal(quotaComponents.flatMap(component => component.hosts).length, 2);
});

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walkAst(item, visit));
    else if (value && typeof value === "object") walkAst(value, visit);
  }
}

test("App imports and mounts the company pages, build-observation host and Costs quota entry at their real routes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ui/src/App.tsx"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const pages = [...routedCompanyPages,
    protocolRoute,
    { file: "ui/src/pages/MimouseCoding.tsx", importSource: "./pages/MimouseCoding", routePattern: "coding" },
    { file: "ui/src/pages/Costs.tsx", importSource: "./pages/Costs", routePattern: "costs" }];
  for (const page of pages) {
    assert.equal(path.posix.normalize(`ui/src/${page.importSource}.tsx`), page.file);
    assert.ok(fs.statSync(path.join(__dirname, "..", page.file)).isFile());
    const declaration = ast.program.body.find(node => node.type === "ImportDeclaration" && node.source.value === page.importSource);
    const symbol = path.basename(page.file, ".tsx");
    const binding = declaration?.specifiers.find(node => node.type === "ImportSpecifier" && node.imported.name === symbol && node.importKind !== "type");
    assert.ok(binding && declaration.importKind !== "type", `App must import ${symbol}`);
    let mounted = false;
    walkAst(ast.program, node => {
      if (node.type !== "JSXOpeningElement" || node.name.type !== "JSXIdentifier" || node.name.name !== "Route") return;
      const route = node.attributes.find(attribute => attribute.name?.name === "path");
      const element = node.attributes.find(attribute => attribute.name?.name === "element");
      if (route?.value?.type !== "StringLiteral" || route.value.value !== page.routePattern) return;
      walkAst(element, child => {
        if (child.type === "JSXOpeningElement" && child.name.type === "JSXIdentifier" && child.name.name === binding.local.name) mounted = true;
      });
    });
    assert.equal(mounted, true, `App must render ${symbol} at ${page.routePattern}`);
  }
});

test("recorded hosts really import and render the exact consumed components", () => {
  const root = path.resolve(__dirname, "..");
  assert.deepEqual(buildObservationComponents, [{
    file: "ui/src/components/MimouseBuildObservations.tsx",
    hosts: [{ file: "ui/src/pages/MimouseCoding.tsx", importSource: "@/components/MimouseBuildObservations" }],
  }]);
  assert.deepEqual(quotaComponents, [
    { file: "ui/src/components/AccountQuotaPanels.tsx", hosts: [{ file: "ui/src/components/ProviderQuotaCard.tsx", importSource: "./AccountQuotaPanels" }] },
    { file: "ui/src/components/ProviderQuotaCard.tsx", hosts: [{ file: "ui/src/pages/Costs.tsx", importSource: "../components/ProviderQuotaCard" }] },
  ]);
  for (const { file, hosts } of [...consumedUiComponents, ...buildObservationComponents, ...quotaComponents]) {
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

test("quota host keeps loading, normal account panels and provider fallbacks as separate conditional branches", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ui/src/components/ProviderQuotaCard.tsx"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let branches;
  walkAst(ast.program, node => {
    if (node.type === "ConditionalExpression" && node.test.type === "Identifier" && node.test.name === "quotaLoading") branches = node;
  });
  assert.ok(branches, "quota loading branch must exist");
  const symbol = node => node?.type === "JSXElement" && node.openingElement.name.name;
  assert.equal(symbol(branches.consequent), "QuotaPanelSkeleton");
  const normal = branches.alternate;
  assert.equal(normal.type, "ConditionalExpression");
  assert.equal(source.slice(normal.test.start, normal.test.end), "quotaAccounts?.length");
  assert.equal(symbol(normal.consequent), "AccountQuotaPanels");
  assert.equal(normal.alternate.test.name, "isClaudeQuotaPanel");
  assert.equal(symbol(normal.alternate.consequent), "ClaudeSubscriptionPanel");
  assert.equal(normal.alternate.alternate.test.name, "isCodexQuotaPanel");
  assert.equal(symbol(normal.alternate.alternate.consequent), "CodexSubscriptionPanel");
  assert.ok(quotaRenderBoundary.includes("nonempty quotaAccounts") && quotaRenderBoundary.includes("not globally unused"));
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
  write(baselineFile, fs.readFileSync(path.join(__dirname, "..", baselineFile)));
  const baseline = readBaseline(path.join(__dirname, ".."));
  const files = [
    ...baseline.files, ...expandedScopeFiles, ...manualScopeFiles, ...scopeEvidenceFiles,
    ...routedRoutineFiles, ...consumedUiFiles, ...routedCompanyFiles, ...buildObservationFiles, ...quotaFiles,
    ...protocolDisplayFiles, ...manualProtocolFiles,
  ];
  for (const file of files.filter(file => file !== missing)) write(file, "export const View = () => <span />;");
  const hosts = new Map();
  [...scopeEdges, ...manualScopeEdges].forEach((edge, index) => {
    const alias = `Imported${index}`;
    const usage = edge.usage === "jsx" ? `<${alias} />` : edge.usage === "call" ? `${alias}()` : alias;
    hosts.set(edge.host, (hosts.get(edge.host) ?? "") + `import { ${edge.symbol} as ${alias} } from ${JSON.stringify(edge.importSource)}; const Fixture${index} = () => ${usage};\n`);
    if (edge.through && edge.through !== missing) write(edge.through, fs.readFileSync(path.join(__dirname, "..", edge.through)));
  });
  for (const [file, source] of hosts) if (file !== missing) write(file, source);
  if (missing) write(`ui/src/elsewhere/${path.basename(missing)}`, "export const Unused = () => <span />;");
  const out = path.join(root, "report.json");
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/audit-mimouse-i18n.cjs"), "--parser", parserEntry, "--out", out], { encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return { result, report: JSON.parse(fs.readFileSync(out, "utf8")) };
  };
  return { root, write, run, ...run() };
}

test("CLI keeps consumed host metadata separate from the unchanged routine route scope", t => {
  const { result, report } = cliFixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.schemaVersion, 5);
  assert.deepEqual(report.requestedConsumedFiles, consumedUiFiles);
  assert.deepEqual(report.missingConsumedFiles, []);
  assert.deepEqual(report.scope.consumedComponentHosts, consumedUiComponents);
  assert.equal(report.scope.consumedMatchedFiles, 3);
  assert.equal(report.scope.routedMatchedFiles, 21);
  assert.deepEqual(report.requestedRoutedFiles, routedRoutineFiles);
  assert.equal(report.scope.routeSource, "ui/src/App.tsx");
  assert.deepEqual(report.scope.routePatterns, ["routines", "routines/:routineId", "routines/:routineId/:section"]);
  assert.deepEqual(report.requestedCompanyRouteFiles, routedCompanyFiles);
  assert.deepEqual(report.missingCompanyRouteFiles, []);
  assert.deepEqual(report.scope.companyRoutes, routedCompanyPages);
  assert.equal(report.scope.companyRouteMatchedFiles, 2);
  assert.deepEqual(report.requestedBuildObservationFiles, buildObservationFiles);
  assert.deepEqual(report.missingBuildObservationFiles, []);
  assert.deepEqual(report.scope.buildObservationComponentHosts, buildObservationComponents);
  assert.equal(report.scope.buildObservationMatchedFiles, 2);
  assert.deepEqual(report.requestedQuotaFiles, quotaFiles);
  assert.deepEqual(report.missingQuotaFiles, []);
  assert.deepEqual(report.scope.quotaComponentHosts, quotaComponents);
  assert.equal(report.scope.quotaMatchedFiles, 2);
  assert.equal(report.scope.quotaRenderBoundary, quotaRenderBoundary);
  assert.deepEqual(report.scope.browserMessages, { receiver: "window", methods: ["confirm", "prompt", "alert"], messageArgumentIndex: 0 });
  assert.ok(report.limits.some(limit => limit.includes("prompt defaults and other arguments are excluded")));
  assert.equal(report.files.filter(row => row.file === "ui/src/pages/MimouseCoding.tsx").length, 1);
  assert.equal(report.files.some(row => row.file === "ui/src/components/TaskChatThread.tsx"), true);
  assert.ok(report.limits.some(limit => limit.includes("not every consumer or a routine route")));
  assert.ok(report.limits.some(limit => limit.includes("not directly comparable")));
  assert.ok(report.limits.some(limit => limit.includes("canonical labels") && limit.includes("does not mean untranslated")));
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

test("CLI reports every missing new exact path even if a same-basename file exists", t => {
  for (const missing of [...routedCompanyFiles, ...buildObservationFiles, ...quotaFiles]) {
    const { result, report } = cliFixture(t, missing);
    assert.equal(result.status, 1, `${missing}: ${result.stderr}`);
    assert.deepEqual(report.missingCompanyRouteFiles, routedCompanyFiles.includes(missing) ? [missing] : []);
    assert.deepEqual(report.missingBuildObservationFiles, buildObservationFiles.includes(missing) ? [missing] : []);
    assert.deepEqual(report.missingQuotaFiles, quotaFiles.includes(missing) ? [missing] : []);
    assert.deepEqual(report.missingRoutedFiles, []);
    assert.deepEqual(report.missingConsumedFiles, []);
    assert.deepEqual(report.unmatchedBasenames, []);
    assert.equal(report.files.some(row => row.file === missing), false);
    assert.ok(!report.requestedBasenames.includes("Companies") && !report.requestedBasenames.includes("CompanySettings") && !report.requestedBasenames.includes("MimouseBuildObservations"));
    assert.ok(quotaFiles.every(file => !report.requestedBasenames.includes(path.basename(file, ".tsx"))));
  }
});

test("protocol display selects four exact TSX files, never its manual sources or same-basename substitutes", () => {
  assert.deepEqual(protocolDisplayFiles, ["TaskChatRunnerActivityGroup", "TaskChatProtocolCard", "QuestionForm", "TaskChatRichInput"]
    .map(name => `ui/src/components/task-chat/${name}.tsx`));
  const wrongPaths = protocolDisplayFiles.flatMap(file => [
    `ui/src/elsewhere/${path.basename(file)}`, ...["production", "legacy", "test", "stories"].map(suffix => file.replace(".tsx", `.${suffix}.tsx`)),
  ]);
  const selected = selectInventory([...protocolDisplayFiles, ...protocolDisplayFiles, ...manualProtocolFiles, ...wrongPaths]);
  assert.deepEqual(selected.selected, [...protocolDisplayFiles].sort());
  assert.deepEqual(selected.missingProtocolDisplayFiles, []);
  assert.deepEqual(selectInventory(wrongPaths).missingProtocolDisplayFiles, protocolDisplayFiles);
  assert.deepEqual(selectInventory(manualProtocolFiles).selected, []);
  assert.equal(routedRoutineFiles.length, 21);
  assert.equal(consumedUiFiles.length, 3);
  assert.equal(consumedUiComponents.flatMap(component => component.hosts).length, 5);
  assert.deepEqual([routedCompanyFiles.length, buildObservationFiles.length, quotaFiles.length], [2, 2, 2]);
  assert.ok(protocolDisplayFiles.every(file => ![...routedRoutineFiles, ...consumedUiFiles, ...routedCompanyFiles, ...buildObservationFiles, ...quotaFiles].includes(file)));
});

function valueConsumer(source, importSource, symbol, usage) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const declaration = ast.program.body.find(node => node.type === "ImportDeclaration" && node.source.value === importSource && node.importKind !== "type");
  const binding = declaration?.specifiers.find(node => node.type === "ImportSpecifier" && node.imported.name === symbol && node.importKind !== "type");
  if (!binding) return false;
  let consumed = false;
  walkAst(ast.program, node => {
    if (usage === "jsx" && node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier" && node.name.name === binding.local.name) consumed = true;
    if (usage === "call" && node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === binding.local.name) consumed = true;
  });
  return consumed;
}

function assertSourceEdge(file, consumer) {
  const root = path.resolve(__dirname, "..");
  const extension = path.extname(file);
  const resolved = consumer.importSource.startsWith("@/") ? `ui/src/${consumer.importSource.slice(2)}${extension}`
    : path.posix.normalize(`${path.posix.dirname(consumer.file)}/${consumer.importSource}${extension}`);
  assert.equal(resolved, file);
  const target = parse(fs.readFileSync(path.join(root, file), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
  assert.ok(target.program.body.some(node => node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration"
    && node.declaration.id.name === consumer.symbol), `${file} must export the actual ${consumer.symbol} function`);
  const source = fs.readFileSync(path.join(root, consumer.file), "utf8");
  assert.ok(valueConsumer(source, consumer.importSource, consumer.symbol, consumer.usage), `${consumer.file} must ${consumer.usage} the named ${consumer.symbol} import`);
}

test("protocol metadata matches real named import/render hosts and manual helper-call edges", () => {
  assert.equal(protocolDisplayComponents.flatMap(component => component.hosts).length, 9);
  assert.equal(protocolThreadHosts.length, 3);
  for (const component of [...protocolDisplayComponents, ...protocolThreadHosts]) {
    for (const host of component.hosts) assertSourceEdge(component.file, { ...host, symbol: component.symbol, usage: "jsx" });
  }
  assert.equal(manualProtocolSources.length, 5);
  assert.equal(manualProtocolFiles.filter(file => file.endsWith(".ts")).length, 4);
  for (const entry of manualProtocolSources) {
    assert.ok(entry.consumers.length > 0);
    for (const consumer of entry.consumers) {
      assert.ok(entry.symbols.includes(consumer.symbol));
      assertSourceEdge(entry.file, consumer);
    }
  }
  const row = manualProtocolSources.find(entry => entry.file.endsWith("/TaskChatProtocolActivityRow.tsx"));
  assert.deepEqual(row.symbols, ["TaskChatProtocolActivityDetails"]);
  assert.equal(row.consumers.length, 1);
  assert.equal(row.consumers[0].symbol, "TaskChatProtocolActivityDetails");
  assert.equal(row.consumers[0].usage, "jsx");
  assert.ok(protocolRenderBoundary.includes("no direct TaskChatProtocolActivityRow mount"));
});

test("import-only, wrong-export, type-only and wrong-usage references do not prove a consumed display", () => {
  const prefix = 'import { TaskChatProtocolActivityDetails as Details } from "./TaskChatProtocolActivityRow";';
  assert.equal(valueConsumer(`${prefix} const View = () => <Details />;`, "./TaskChatProtocolActivityRow", "TaskChatProtocolActivityDetails", "jsx"), true);
  assert.equal(valueConsumer(prefix, "./TaskChatProtocolActivityRow", "TaskChatProtocolActivityDetails", "jsx"), false);
  assert.equal(valueConsumer('import { TaskChatProtocolActivityRow as Details } from "./TaskChatProtocolActivityRow"; const View = () => <Details />;', "./TaskChatProtocolActivityRow", "TaskChatProtocolActivityDetails", "jsx"), false);
  assert.equal(valueConsumer('import type { TaskChatProtocolActivityDetails as Details } from "./TaskChatProtocolActivityRow"; const View = () => <Details />;', "./TaskChatProtocolActivityRow", "TaskChatProtocolActivityDetails", "jsx"), false);
  assert.equal(valueConsumer('import { type TaskChatProtocolActivityDetails as Details } from "./TaskChatProtocolActivityRow"; const View = () => <Details />;', "./TaskChatProtocolActivityRow", "TaskChatProtocolActivityDetails", "jsx"), false);
  assert.equal(valueConsumer(`${prefix} const View = () => <Details />;`, "./TaskChatProtocolActivityRow", "TaskChatProtocolActivityDetails", "call"), false);
  assert.equal(valueConsumer('import { display as label } from "./helper"; const x = label(input);', "./helper", "display", "call"), true);
});

test("IssueDetail really selects and renders the imported TaskChatThread only outside the Classic interface", () => {
  assert.equal(protocolRoute.source, "ui/src/App.tsx");
  assert.equal(protocolRoute.routePattern, "issues/:issueId");
  const source = fs.readFileSync(path.join(__dirname, "..", protocolRoute.file), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const thread = protocolRoute.conditionalThread;
  assert.equal(path.posix.normalize(`${path.posix.dirname(protocolRoute.file)}/${thread.importSource}.tsx`), thread.file);
  const declaration = ast.program.body.find(node => node.type === "ImportDeclaration" && node.source.value === thread.importSource && node.importKind !== "type");
  const binding = declaration?.specifiers.find(node => node.type === "ImportSpecifier" && node.imported.name === thread.symbol && node.importKind !== "type");
  assert.ok(binding);
  let selection, rendered = false;
  walkAst(ast.program, node => {
    if (node.type === "VariableDeclarator" && node.id.name === thread.binding) selection = node.init;
    if (node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier" && node.name.name === thread.binding) rendered = true;
  });
  assert.equal(selection?.type, "ConditionalExpression");
  assert.equal(selection.test.type, "Identifier");
  assert.equal(selection.test.name, thread.condition);
  assert.equal(selection.consequent.name, thread.whenTrue);
  assert.equal(selection.alternate.name, binding.local.name);
  assert.equal(thread.whenFalse, thread.symbol);
  assert.equal(rendered, true);
});

test("schema 4 keeps protocol AST counts and manual source evidence separate from all prior scopes", t => {
  const { result, report } = cliFixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(report.requestedProtocolDisplayFiles, protocolDisplayFiles);
  assert.deepEqual(report.missingProtocolDisplayFiles, []);
  assert.equal(report.scope.protocolDisplayMatchedFiles, 4);
  assert.deepEqual(report.scope.protocolDisplayComponentHosts, protocolDisplayComponents);
  assert.deepEqual(report.scope.protocolThreadHosts, protocolThreadHosts);
  assert.deepEqual(report.scope.protocolRoute, protocolRoute);
  assert.equal(report.scope.protocolRenderBoundary, protocolRenderBoundary);
  assert.deepEqual(report.requestedManualSourceFiles, manualProtocolFiles);
  assert.deepEqual(report.missingManualSourceFiles, []);
  assert.equal(report.scope.manualSourceMatchedFiles, 5);
  assert.equal(report.scope.previousScopeMatchedFiles, report.legacyScope.matchedFiles - 4);
  assert.ok(manualProtocolFiles.every(file => !report.files.some(row => row.file === file)));
  assert.ok(report.manualSourceEvidence.every(row => row.classification === "needs_manual_review" && row.method === "source-hash-only" && /^[a-f0-9]{64}$/.test(row.sourceSha256)));
  assert.match(report.manualSourceSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.limits.some(limit => limit.includes("not AST candidate inventories")));
  assert.ok(report.limits.some(limit => limit.includes("not a CLI-inferred call graph")));
  assert.ok(report.limits.some(limit => limit.includes("earlier scopes and candidate meanings are unchanged")));
});

test("each missing protocol AST or manual evidence file fails closed even with wrong-path and production substitutes", t => {
  for (const missing of [...protocolDisplayFiles, ...manualProtocolFiles]) {
    const fixture = cliFixture(t, missing);
    fixture.write(missing.replace(/(\.tsx?)$/, ".production$1"), "export const Unused = () => <p>Unused English</p>;");
    const { result, report } = fixture.run();
    assert.equal(result.status, 1, `${missing}: ${result.stderr}`);
    assert.deepEqual(report.missingProtocolDisplayFiles, protocolDisplayFiles.includes(missing) ? [missing] : []);
    assert.deepEqual(report.missingManualSourceFiles, manualProtocolFiles.includes(missing) ? [missing] : []);
    assert.deepEqual(report.missingRoutedFiles, []);
    assert.deepEqual(report.missingConsumedFiles, []);
    assert.deepEqual(report.unmatchedBasenames, []);
    assert.equal(report.files.some(row => row.file === missing), false);
    const evidence = report.manualSourceEvidence.find(row => row.file === missing);
    if (evidence) assert.equal(evidence.sourceSha256, null);
  }
});

test("helper and named-details source changes alter only the manual hash, never AST counts or the original source hash", t => {
  const fixture = cliFixture(t);
  const original = fixture.report;
  for (const file of manualProtocolFiles) {
    const previous = fixture.run().report;
    fixture.write(file, file.endsWith(".tsx") ? 'export const Details = () => <p>New details copy</p>;'
      : 'const canonical = { wire: "tool_execution", label: "Running tool" }; export function display() { return "New helper copy"; }');
    const { result, report } = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(report.manualSourceSha256, previous.manualSourceSha256);
    assert.notEqual(report.manualSourceEvidence.find(row => row.file === file).sourceSha256, previous.manualSourceEvidence.find(row => row.file === file).sourceSha256);
    assert.equal(report.sourceSha256, original.sourceSha256);
    assert.deepEqual(report.files, original.files);
    assert.deepEqual(report.candidates, original.candidates);
    assert.deepEqual(report.dynamicCandidates, original.dynamicCandidates);
  }
  assert.deepEqual(collectManualSourceEvidence(fixture.root).missingManualSourceFiles, []);
});

test("protocol manual review never labels canonical tables, payloads or user/provider dynamic values untranslated", () => {
  const result = audit(`const canonical = { key: "file_change", label: "Edited files" }; api.send({ action: "submit", title: "Raw provider title" });
    function copy() { return "Local helper requires origin review"; }
    const View = () => <section aria-label={summary.fullLabel}><span>{copy()}</span><span>{item.summary}</span>
      <span>{item.status}</span><span>{"USD"}</span><span>{t("protocol.title", { raw: "Raw user value" })}</span></section>;`);
  assert.deepEqual(result.candidates.map(row => row.text), ["USD"]);
  assert.deepEqual(result.dynamicCandidates.map(row => row.expression), ["summary.fullLabel", "copy()", "item.summary", "item.status"]);
  assert.ok([...result.candidates, ...result.dynamicCandidates].every(row => row.classification === "needs_manual_review"));
});

test("schema 4 extends the published 78-file inventory by exactly four paths without changing prior scope contracts", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "../doc/mimouse/checklists/I18N-AUDIT-20261027-5142.json"), "utf8"));
  assert.equal(baseline.schemaVersion, 3);
  assert.equal(baseline.matchedFiles, 78);
  assert.equal(baseline.totalLiteralCandidates, 278);
  assert.equal(baseline.totalDynamicCandidates, 1849);
  const oldFiles = baseline.files.map(row => row.file);
  const root = path.resolve(__dirname, "..");
  const files = fs.readdirSync(path.join(root, "ui/src"), { recursive: true })
    .filter(file => file.endsWith(".tsx")).map(file => `ui/src/${file.split(path.sep).join("/")}`);
  const inventory = selectInventory(files);
  assert.equal(inventory.legacySelected.length, 82);
  assert.deepEqual(inventory.legacySelected.filter(file => !protocolDisplayFiles.includes(file)), oldFiles);
  assert.deepEqual(routedRoutineFiles, baseline.requestedRoutedFiles);
  assert.deepEqual(consumedUiFiles, baseline.requestedConsumedFiles);
  assert.deepEqual(consumedUiComponents, baseline.scope.consumedComponentHosts);
  assert.deepEqual(routedCompanyFiles, baseline.requestedCompanyRouteFiles);
  assert.deepEqual(routedCompanyPages, baseline.scope.companyRoutes);
  assert.deepEqual(buildObservationFiles, baseline.requestedBuildObservationFiles);
  assert.deepEqual(buildObservationComponents, baseline.scope.buildObservationComponentHosts);
  assert.deepEqual(quotaFiles, baseline.requestedQuotaFiles);
  assert.deepEqual(quotaComponents, baseline.scope.quotaComponentHosts);
  assert.equal(quotaRenderBoundary, baseline.scope.quotaRenderBoundary);
  assert.deepEqual(browserMessageMethods, baseline.scope.browserMessages.methods);
  // Compare row contracts, not totals: subsequent display translations legitimately
  // remove candidates, and the four new files deliberately expand the inventory.
  const rows = audit('const View = () => <span title="Owned label">{item.summary}</span>;');
  assert.deepEqual(Object.keys(rows.candidates[0]), Object.keys(baseline.candidates[0]));
  assert.deepEqual(Object.keys(rows.dynamicCandidates[0]), Object.keys(baseline.dynamicCandidates[0]));
  assert.equal(rows.candidates[0].classification, "needs_manual_review");
  assert.equal(rows.dynamicCandidates[0].classification, "needs_manual_review");
});

test("schema 5 freezes the entire 82-path baseline and verifies its published JSON SHA", () => {
  const root = path.resolve(__dirname, "..");
  const baseline = readBaseline(root);
  assert.equal(baseline.files.length, 82);
  assert.equal(baseline.fileSha256, baselineFileSha256);
  assert.equal(baseline.historicalSourceSha256, "9d72c17c3f37a8e15618db93a8eadb7e3559fe355692347503efcabd5837d6c3");
  assert.equal(baseline.pathSetSha256, pathSetSha256([...baseline.files].reverse()));
  assert.deepEqual(selectInventory(baseline.files).legacySelected, baseline.files);
  assert.ok(baseline.files.every(file => legacyDomain(file)));
});

test("schema 5 selects only exact additions; same basenames, tests and stories cannot replace them", () => {
  const baseline = readBaseline(path.resolve(__dirname, ".."));
  const additions = expandedScopeFiles.filter(file => !baseline.files.includes(file));
  const wrong = additions.flatMap(file => [file.replace("ui/src/", "ui/src/elsewhere/"),
    file.replace(".tsx", ".production.tsx"), file.replace(".tsx", ".test.tsx"), file.replace(".tsx", ".stories.tsx")]);
  assert.deepEqual(selectInventory(wrong).selected, []);
  for (const missing of additions) {
    const result = selectInventory([...baseline.files, ...additions.filter(file => file !== missing), ...wrong]);
    assert.deepEqual(result.missingExpandedScopeFiles, [missing]);
    assert.deepEqual(result.legacySelected, baseline.files);
  }
  assert.ok(manualScopeFiles.every(file => !selectInventory([...baseline.files, ...expandedScopeFiles, ...manualScopeFiles]).selected.includes(file)));
});

test("all expanded imports resolve to exact consumers, including the TaskSidePanel barrel", () => {
  assert.deepEqual(verifyScopeEdges(path.resolve(__dirname, ".."), parse), []);
  for (const edge of [...scopeEdges, ...manualScopeEdges]) {
    const imported = `import { ${edge.symbol} as Alias } from ${JSON.stringify(edge.importSource)};`;
    assert.equal(consumesEdge(imported, edge, parse), false);
    assert.equal(consumesEdge(`import type { ${edge.symbol} as Alias } from ${JSON.stringify(edge.importSource)}; const x = <Alias />;`, edge, parse), false);
    const usage = edge.usage === "jsx" ? "<Alias />" : edge.usage === "call" ? "Alias()" : "Alias";
    assert.equal(consumesEdge(`${imported} const x = ${usage};`, edge, parse), true);
  }
  assert.ok(scopeEdges.some(edge => edge.file.endsWith("/IssuePropertiesArtifactsTab.tsx") && edge.host.endsWith("/TaskSidePanel.tsx")));
  assert.ok(scopeEdges.some(edge => edge.file.endsWith("/OnboardingWizard.tsx") && edge.host.endsWith("/OnboardingWizardVariant.tsx")));
});

test("integrated display helpers preserve canonical sources and remain hash-only outside the AST denominator", () => {
  const original = ["hooks/useDocumentAnnotationMutations.ts", "lib/artifact-card-data.ts", "lib/issue-artifacts.ts",
    "lib/task-side-panel-state.ts", "lib/attention.ts", "lib/blockedInbox.ts", "lib/inbox.ts",
    "lib/activity-format.ts", "pages/audit/audit-navigation.ts"].map(file => `ui/src/${file}`);
  const integrated = ["i18n/attention-row-display.ts", "i18n/blocked-inbox-display.ts", "i18n/decision-desk-display.ts",
    "i18n/inbox-display.ts", "i18n/interaction-audience-display.ts", "i18n/runner-goal-feedback.ts",
    "i18n/task-interaction-feedback-display.ts", "lib/agent-configuration-errors.ts", "lib/credential-access-notice.ts",
    "lib/system-notice-humanizer.ts", "pages/agent-skills/agent-skill-source.ts"].map(file => `ui/src/${file}`).sort();
  assert.deepEqual(integratedDisplayHelperFiles, integrated);
  assert.deepEqual(manualScopeFiles, [...original, ...integrated, "ui/src/hooks/useBrowserViewport.ts"].sort());
  assert.equal(integratedDisplayHelperEdges.length, 30);
  assert.ok(integratedDisplayHelperEdges.every(edge => edge.usage === "call"));
  const baseline = readBaseline(path.resolve(__dirname, ".."));
  const inventory = selectInventory([...baseline.files, ...expandedScopeFiles, ...manualScopeFiles, ...scopeEvidenceFiles]);
  assert.equal(inventory.selected.length, 168);
  assert.ok(manualScopeFiles.every(file => !inventory.selected.includes(file)));
  for (const host of ["BlockedReasonChip", "InteractionAudienceLine", "task-chat/RunnerGoalWidget"]) {
    const file = `ui/src/components/${host}.tsx`;
    assert.ok(scopeEvidenceFiles.includes(file));
    assert.ok(!inventory.selected.includes(file), "evidence-only consumers never enlarge AST coverage");
  }
  const retained = [
    ["lib/attention.ts", "components/DecisionsToolbar.tsx", "countActiveAttentionFilters"],
    ["lib/blockedInbox.ts", "components/BlockedInboxView.tsx", "buildBlockedInboxRows"],
    ["pages/audit/audit-navigation.ts", "pages/audit/AuditHub.tsx", "auditDisplaySections"],
  ];
  for (const [file, host, symbol] of retained) {
    assert.ok(manualScopeEdges.some(edge => edge.file === `ui/src/${file}` && edge.host === `ui/src/${host}` && edge.symbol === symbol && edge.usage === "call"));
  }
});

test("split named imports verify each exact value binding without accepting type-only or unrelated calls", () => {
  const edge = integratedDisplayHelperEdges.find(edge => edge.symbol === "attentionDetailDisplay");
  const imports = `import { attentionDecideByDisplay } from ${JSON.stringify(edge.importSource)};
    import { attentionDetailDisplay as Details } from ${JSON.stringify(edge.importSource)};`;
  assert.equal(consumesEdge(`${imports} Details(item);`, edge, parse), true);
  assert.equal(consumesEdge(`${imports} attentionDecideByDisplay(item);`, edge, parse), false);
  assert.equal(consumesEdge(`import { type attentionDetailDisplay as Details } from ${JSON.stringify(edge.importSource)}; Details(item);`, edge, parse), false);
  assert.equal(consumesEdge(`import { attentionDetailDisplay as Details } from "./wrong-source"; Details(item);`, edge, parse), false);
});

test("visible recovery adds six exact AST paths and a separate resize-error source without double counting", () => {
  const files = ["AgentSecretAccessEditor", "RouteErrorBoundary", "SidebarRecentTasks",
    "task-side-panel/TaskBrowserFooter", "task-side-panel/TaskBrowserPanel", "task-side-panel/TaskSkillPanel"]
    .map(name => `ui/src/components/${name}.tsx`).sort();
  assert.deepEqual(visibleRecoveryScopeFiles, files);
  assert.equal(visibleRecoveryScopeEdges.length, 6);
  assert.ok(visibleRecoveryScopeEdges.every(edge => edge.usage === "jsx"));
  assert.deepEqual(viewportErrorSourceEdge, { domain: "tasks", file: "ui/src/hooks/useBrowserViewport.ts",
    host: "ui/src/components/task-side-panel/TaskBrowserPanel.tsx", symbol: "useBrowserViewport",
    importSource: "@/hooks/useBrowserViewport", usage: "call" });
  const baseline = readBaseline(path.resolve(__dirname, ".."));
  const inventory = selectInventory([...baseline.files, ...expandedScopeFiles, ...files, ...files, viewportErrorSourceEdge.file]);
  assert.equal(inventory.selected.length, 168);
  for (const file of files) assert.equal(inventory.selected.filter(path => path === file).length, 1);
  assert.ok(!inventory.selected.includes(viewportErrorSourceEdge.file));
  assert.ok(!inventory.selected.includes("ui/src/components/Layout.tsx"), "an evidence host is not recursively inventoried");
  assert.deepEqual(collectScopeDenominators(path.resolve(__dirname, ".."), baseline).map(scope => [scope.domain, scope.matchedFiles]),
    [["entry-navigation", 27], ["tasks", 75], ["agents-runs", 17], ["management", 37], ["new-modules", 12]]);
  assert.match(visibleRecoveryRenderBoundary, /conditional task side-panel tabs/);
  assert.match(visibleRecoveryRenderBoundary, /hash-only, not JSX coverage/);
});

test("visible recovery missing files, host and resize producer usage fail closed", t => {
  for (const missing of [...visibleRecoveryScopeFiles, viewportErrorSourceEdge.file, "ui/src/components/Layout.tsx"]) {
    const { result, report } = cliFixture(t, missing);
    assert.equal(result.status, 1, `${missing}: ${result.stderr}`);
    assert.ok([...report.missingExpandedScopeFiles, ...report.manualScope.missingFiles, ...report.hostEvidence.missingFiles].includes(missing));
    assert.ok(report.invalidScopeEdges.some(edge => [edge.file, edge.host].includes(missing)));
  }
  const fixture = cliFixture(t);
  const file = viewportErrorSourceEdge.host;
  const source = fs.readFileSync(path.join(fixture.root, file), "utf8");
  const alias = source.match(/import \{ useBrowserViewport as (Imported\d+) \}/)?.[1];
  assert.ok(alias);
  fixture.write(file, source.replace(`${alias}()`, "null"));
  const { result, report } = fixture.run();
  assert.equal(result.status, 1);
  assert.ok(report.invalidScopeEdges.some(edge => edge.file === viewportErrorSourceEdge.file));
  assert.deepEqual(report.manualScope.missingFiles, []);
});

test("ordinary adapter scope proves the Codex registry mapping without inventing a direct JSX edge", () => {
  assert.deepEqual(adapterConfigurationScopeEdges.map(edge => [edge.file, edge.symbol, edge.usage]), [
    ["ui/src/adapters/claude-local/config-fields.tsx", "ClaudeLocalAdvancedFields", "jsx"],
    ["ui/src/adapters/codex-local/config-fields.tsx", "CodexLocalConfigFields", "reference"],
  ]);
  const ast = file => parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
  const moduleAst = ast(adapterConfigurationDispatch.moduleFile);
  const imported = moduleAst.program.body.find(node => node.type === "ImportDeclaration" && node.source.value === "./config-fields")
    ?.specifiers.find(node => node.type === "ImportSpecifier" && node.imported.name === "CodexLocalConfigFields");
  assert.ok(imported);
  const exported = moduleAst.program.body.find(node => node.type === "ExportNamedDeclaration"
    && node.declaration?.type === "VariableDeclaration"
    && node.declaration.declarations.some(row => row.id.name === "codexLocalUIAdapter"));
  const object = exported?.declaration.declarations.find(row => row.id.name === "codexLocalUIAdapter")?.init;
  assert.equal(object?.type, "ObjectExpression");
  const property = name => object.properties.find(row => row.type === "ObjectProperty" && row.key.name === name)?.value;
  assert.equal(property("type")?.value, "codex_local");
  assert.equal(property("ConfigFields")?.name, imported.local.name);
  const registry = ast(adapterConfigurationDispatch.registryFile);
  assert.ok(registry.program.body.some(node => node.type === "ImportDeclaration" && node.source.value === "./codex-local"
    && node.specifiers.some(row => row.type === "ImportSpecifier" && row.imported.name === "codexLocalUIAdapter")));
  let registered = false;
  walkAst(registry, node => {
    if (node.type !== "ForOfStatement" || node.right.type !== "ArrayExpression"
      || !node.right.elements.some(row => row?.type === "Identifier" && row.name === "codexLocalUIAdapter")) return;
    const binding = node.left.declarations?.[0]?.id.name;
    walkAst(node.body, child => {
      if (child.type === "CallExpression" && child.callee.name === "registerUIAdapter" && child.arguments[0]?.name === binding) registered = true;
    });
  });
  assert.equal(registered, true);
  let lookup = false, dispatch = false, configuration = false;
  walkAst(ast(adapterConfigurationDispatch.hostFile), node => {
    if (node.type === "CallExpression" && node.callee.name === "getUIAdapter" && node.arguments[0]?.name === "adapterType") lookup = true;
    if (node.type === "JSXOpeningElement" && node.name.type === "JSXMemberExpression"
      && node.name.object.name === "uiAdapter" && node.name.property.name === "ConfigFields"
      && node.attributes.some(row => row.name?.name === "section" && row.value?.expression?.name === "section")) dispatch = true;
    if (node.type === "CallExpression" && node.callee.name === "renderAdapterFields" && node.arguments[0]?.value === "configuration") configuration = true;
  });
  assert.deepEqual({ lookup, dispatch, configuration }, { lookup: true, dispatch: true, configuration: true });
  assert.match(adapterConfigurationDispatch.boundary, /external adapter override/);
});

test("ordinary adapter scope fails closed on missing paths or registry evidence and never invents recursive scope", t => {
  for (const missing of [...adapterConfigurationScopeEdges.map(edge => edge.file), adapterConfigurationDispatch.moduleFile, adapterConfigurationDispatch.registryFile]) {
    const { result, report } = cliFixture(t, missing);
    assert.equal(result.status, 1, `${missing}: ${result.stderr}`);
    assert.ok([...report.missingExpandedScopeFiles, ...report.hostEvidence.missingFiles].includes(missing));
  }
  const selected = selectInventory([...expandedScopeFiles, ...scopeEvidenceFiles, ...expandedScopeFiles]).selected;
  assert.ok(!selected.includes(adapterConfigurationDispatch.moduleFile));
  assert.ok(!selected.includes(adapterConfigurationDispatch.registryFile));
  for (const { file } of adapterConfigurationScopeEdges) assert.equal(selected.filter(path => path === file).length, 1);
});

test("CLI emits independently hashed five-domain, frozen legacy, explicit expansion and manual denominators", t => {
  const { report, result, root } = cliFixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.schemaVersion, 5);
  assert.deepEqual(report.legacyScope.requestedFiles, report.baseline.files);
  assert.deepEqual(report.legacyPathDrift, []);
  assert.deepEqual(report.expandedScope.requestedFiles, expandedScopeFiles);
  assert.deepEqual(report.requestedExpandedScopeFiles, expandedScopeFiles);
  assert.deepEqual(report.missingExpandedScopeFiles, []);
  assert.deepEqual(report.invalidScopeEdges, []);
  assert.deepEqual(report.scopeDenominators.map(scope => scope.domain), ["entry-navigation", "tasks", "agents-runs", "management", "new-modules"]);
  const domains = report.scopeDenominators.flatMap(scope => scope.requestedFiles);
  assert.equal(new Set(domains).size, domains.length, "five domains partition the AST denominator");
  assert.deepEqual([...domains].sort(), report.files.map(row => row.file));
  for (const scope of [report.legacyScope, report.expandedScope, report.manualScope, report.hostEvidence, ...report.scopeDenominators]) {
    assert.equal(scope.pathSetSha256, pathSetSha256(scope.requestedFiles));
    assert.deepEqual(scope.missingFiles, []);
    assert.match(scope.sourceSha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(report.manualScope.requestedFiles, manualScopeFiles);
  assert.deepEqual(report.integratedDisplayHelperFiles, integratedDisplayHelperFiles);
  assert.deepEqual(report.visibleRecoveryScopeFiles, visibleRecoveryScopeFiles);
  assert.equal(report.viewportErrorSourceFile, viewportErrorSourceEdge.file);
  assert.equal(report.visibleRecoveryRenderBoundary, visibleRecoveryRenderBoundary);
  assert.deepEqual(report.adapterConfigurationScopeEdges, adapterConfigurationScopeEdges);
  assert.deepEqual(report.adapterConfigurationDispatch, adapterConfigurationDispatch);
  assert.equal(report.scope.unscannedTsxFiles.length + report.files.length, report.scope.eligibleTsxFiles);
  assert.ok(report.scope.unscannedTsxFiles.every(file => !report.files.some(row => row.file === file)));
  assert.deepEqual(report.scope.evidenceOnlyTsxFiles, scopeEvidenceFiles.filter(file => file.endsWith(".tsx") && !report.files.some(row => row.file === file)));
  assert.ok(report.scope.evidenceOnlyTsxFiles.every(file => report.scope.unscannedTsxFiles.includes(file)));
  assert.equal(report.manualScope.method, "source-hash-only");
  assert.ok(report.manualScope.evidence.every(row => row.method === "source-hash-only" && row.classification === "needs_manual_review"));
  assert.ok(manualScopeFiles.every(file => !report.files.some(row => row.file === file)));
  assert.deepEqual(report.scopeDenominators, collectScopeDenominators(root, report.baseline));
  assert.ok(report.limits.some(limit => limit.includes("do not subtract old/new totals")));
  assert.ok(report.limits.some(limit => limit.includes("not binding analysis or runtime reachability")));
});

test("CLI fails closed for a new scope path, manual helper, evidence-only host, barrel and missing import usage", t => {
  for (const missing of ["ui/src/components/InstructionHistory.tsx", ...manualScopeFiles, "ui/src/main.tsx", "ui/src/components/task-side-panel/index.ts"]) {
    const { result, report } = cliFixture(t, missing);
    assert.equal(result.status, 1, `${missing}: ${result.stderr}`);
    assert.ok([...report.missingExpandedScopeFiles, ...report.manualScope.missingFiles, ...report.hostEvidence.missingFiles].includes(missing));
    assert.ok(report.invalidScopeEdges.some(edge => [edge.file, edge.host, edge.through].includes(missing)));
  }
  const fixture = cliFixture(t);
  fixture.write("ui/src/main.tsx", 'import { App } from "./App"; export const Root = () => null;');
  const { result, report } = fixture.run();
  assert.equal(result.status, 1);
  assert.ok(report.invalidScopeEdges.some(edge => edge.host === "ui/src/main.tsx"));
  assert.deepEqual(report.hostEvidence.missingFiles, []);
});

test("CLI rejects unexpected old-basename paths and a tampered frozen report", t => {
  const fixture = cliFixture(t);
  fixture.write("ui/src/elsewhere/Auth.tsx", "export const Auth = () => null;");
  const drift = fixture.run();
  assert.equal(drift.result.status, 1);
  assert.deepEqual(drift.report.legacyPathDrift, ["ui/src/elsewhere/Auth.tsx"]);
  fixture.write(baselineFile, JSON.stringify({ schemaVersion: 4, files: [] }));
  const result = spawnSync(process.execPath, [path.join(fixture.root, "scripts/audit-mimouse-i18n.cjs"), "--parser", parserEntry, "--out", path.join(fixture.root, "tampered.json")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Frozen baseline SHA mismatch/);
  assert.equal(fs.existsSync(path.join(fixture.root, "tampered.json")), false);
});

test("new AST, evidence-only host and pure helper source hashes cannot masquerade as old-scope translation progress", t => {
  const fixture = cliFixture(t), before = fixture.report;
  const append = (file, text) => fixture.write(file, fs.readFileSync(path.join(fixture.root, file), "utf8") + text);
  append("ui/src/components/InstructionHistory.tsx", '\nconst NewCopy = () => <span>Owned system copy</span>;');
  const afterAst = fixture.run().report;
  assert.notEqual(afterAst.sourceSha256, before.sourceSha256);
  assert.notEqual(afterAst.expandedScope.sourceSha256, before.expandedScope.sourceSha256);
  assert.equal(afterAst.legacyScope.sourceSha256, before.legacyScope.sourceSha256);
  assert.equal(afterAst.baseline.fileSha256, before.baseline.fileSha256);
  append("ui/src/main.tsx", "\n// host-only evidence changed\n");
  const afterHost = fixture.run().report;
  assert.notEqual(afterHost.hostEvidence.sourceSha256, afterAst.hostEvidence.sourceSha256);
  assert.equal(afterHost.sourceSha256, afterAst.sourceSha256);
  append(manualScopeFiles[0], '\nconst helperCopy = "Returned system copy needs manual review";');
  const afterHelper = fixture.run().report;
  assert.notEqual(afterHelper.manualScope.sourceSha256, afterHost.manualScope.sourceSha256);
  assert.equal(afterHelper.sourceSha256, afterHost.sourceSha256);
  assert.equal(afterHelper.legacyScope.sourceSha256, before.legacyScope.sourceSha256);
  assert.deepEqual(afterHelper.files, afterHost.files);
  assert.deepEqual(afterHelper.scopeDenominators.map(x => x.pathSetSha256), before.scopeDenominators.map(x => x.pathSetSha256));
});
