import { expect, test } from "@playwright/test";
test("actual HTTP/DB task lifecycle and safe auth capabilities", async ({ request }) => {
  const health = await request.get("/api/health"); expect(health.ok()).toBeTruthy();
  const capabilities = await request.get("/api/instance/auth-capabilities");
  expect(await capabilities.json()).toEqual({ password: true, providers: [] });
  const companyResponse = await request.post("/api/companies", { data: { name: `MiMouse API fixture ${Date.now()}` } });
  expect(companyResponse.ok(), await companyResponse.text()).toBeTruthy();
  const company = await companyResponse.json();
  const response = await request.post(`/api/companies/${company.id}/issues`, { data: { title: "真实数据库中的中文任务", status: "backlog", description: "API fixture only; no Agent assignment." } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const issue = await response.json(); expect(issue.companyId).toBe(company.id);
  const fetched = await request.get(`/api/issues/${issue.id}`); expect(fetched.ok()).toBeTruthy();
  expect((await fetched.json()).title).toBe("真实数据库中的中文任务");
  const updated = await request.patch(`/api/issues/${issue.id}`, { data: { status: "done" } });
  expect(updated.ok(), await updated.text()).toBeTruthy(); expect((await updated.json()).status).toBe("done");
});

test("actual server serves the production HTML and its referenced local JS/CSS assets", async ({ request }) => {
  const page = await request.get("/"); expect(page.ok()).toBe(true); expect(page.headers()["content-type"]).toContain("text/html");
  const html = await page.text(); expect(html).toContain("<title>Paperclip</title>");
  const sources = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"[^>]*>/g)].map(match => match[1]);
  expect(sources.some(source => source.endsWith(".js"))).toBe(true); expect(sources.some(source => source.endsWith(".css"))).toBe(true);
  for (const source of new Set(sources)) {
    const asset = await request.get(source); expect(asset.ok(), source).toBe(true);
    expect(asset.headers()["content-type"], source).not.toContain("text/html"); expect((await asset.body()).length, source).toBeGreaterThan(100);
  }
  // This verifies delivery, not browser execution, layout or accessibility.
});


test("setup capability hints use the actual company and never stand in for mutation authorization", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `setup capability fixture ${Date.now()}` } })).json();
  const response = await request.get(`/api/companies/${company.id}/setup-capabilities`);
  expect(response.ok(), await response.text()).toBe(true); expect(await response.json()).toEqual({ canCreateAgents: true });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/api/companies/00000000-0000-4000-8000-000000000000/setup-capabilities")).status()).toBe(404);
});
