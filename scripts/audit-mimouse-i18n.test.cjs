const { test } = require("node:test");
const assert = require("node:assert/strict");
const { collectCandidates } = require("./audit-mimouse-i18n.cjs");
const { parse } = require("../node_modules/.pnpm/@babel+parser@7.29.8/node_modules/@babel/parser/lib/index.js");
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
