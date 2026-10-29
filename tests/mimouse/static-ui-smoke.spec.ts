import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ extraHTTPHeaders: { origin: "http://127.0.0.1:3100" } });
async function fixture(request: APIRequestContext) {
  const health = await request.get("/api/health");
  expect((await health.json()).deploymentMode, "Run local static UI smoke separately from authenticated recovery/bootstrap tests").toBe("local_trusted");
  const response = await request.post("/api/companies", { data: { name: "Frozen static UI fixture" } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
function observe(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && /\/assets\/.*\.(?:js|css)(?:\?|$)/.test(response.url())) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  return () => expect(errors, "No browser runtime or static-chunk load errors").toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: file, contentType: "image/png" });
}
async function open(page: Page, route: string) {
  const response = await page.goto(route);
  expect(response?.ok(), "Expected static application HTML").toBe(true);
}
async function noExecution(request: APIRequestContext, companyId: string) {
  const runs = await request.get(`/api/companies/${companyId}/heartbeat-runs`);
  expect(runs.ok()).toBe(true); expect(await runs.json()).toEqual([]);
}

test("frozen production dashboard loads its chart cards without starting an Agent", async ({ page, request }, info) => {
  const healthy = observe(page), company = await fixture(request);
  await open(page, `/${company.issuePrefix}/dashboard`);
  for (const name of ["Run Activity", "Tasks by Status", "Success Rate"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await capture(page, info, "dashboard-charts");
  healthy(); await noExecution(request, company.id);
});

test("frozen production rich editor accepts and preserves an unsent task draft", async ({ page, request }, info) => {
  const healthy = observe(page), company = await fixture(request);
  const title = `Editor fixture ${randomUUID()}`;
  const response = await request.post(`/api/companies/${company.id}/issues`, { data: { title, description: "Synthetic editor fixture; no Agent assignment.", status: "backlog" } });
  expect(response.ok(), await response.text()).toBe(true); const issue = await response.json();
  await open(page, `/${company.issuePrefix}/issues/${issue.identifier}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const editor = page.getByTestId("task-chat-composer-input").locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  const draft = "Unsent draft — 中文 and English remain intact.";
  await editor.fill(draft);
  await page.getByRole("heading", { name: title, exact: true }).click();
  await expect(editor).toContainText(draft);
  await capture(page, info, "rich-editor-draft");
  healthy(); await noExecution(request, company.id);
});

test("frozen production Markdown lazy-loads Mermaid and renders its SVG", async ({ page, request }, info) => {
  const healthy = observe(page), company = await fixture(request);
  const title = `Diagram fixture ${randomUUID()}`;
  const response = await request.post(`/api/companies/${company.id}/issues`, { data: { title, description: "# Synthetic diagram\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Verified]\n```\n", status: "backlog" } });
  expect(response.ok(), await response.text()).toBe(true); const issue = await response.json();
  await open(page, `/${company.issuePrefix}/issues/${issue.identifier}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const diagram = page.locator(".paperclip-mermaid svg").first();
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await expect(diagram).toContainText("Verified");
  await capture(page, info, "markdown-mermaid");
  healthy(); await noExecution(request, company.id);
});
