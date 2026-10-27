const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { collectCandidates, collectAudit, selectInventory, routedRoutineFiles } = require("./audit-mimouse-i18n.cjs");
const { parse } = require(process.env.AUDIT_I18N_PARSER
  ? path.resolve(process.env.AUDIT_I18N_PARSER)
  : "../node_modules/.pnpm/@babel+parser@7.29.8/node_modules/@babel/parser/lib/index.js");
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
    "ui/src/components/routine-sections/operate-sections.test.tsx",
    "ui/src/components/routine-triggers/TriggerWizard.stories.tsx",
  ]);
  assert.equal(routedRoutineFiles.length, 12);
  assert.deepEqual(inventory.selected, ["ui/src/pages/Auth.tsx", ...routedRoutineFiles].sort());
  assert.deepEqual(inventory.missingRoutedFiles, []);
  const missing = routedRoutineFiles[0];
  assert.deepEqual(selectInventory(routedRoutineFiles.slice(1)).missingRoutedFiles, [missing]);
});
