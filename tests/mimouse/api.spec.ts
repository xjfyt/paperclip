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
