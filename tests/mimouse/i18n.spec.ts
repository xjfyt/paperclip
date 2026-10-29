import { expect, test } from "@playwright/test";

const variants = [
  { locale: "en", language: "Language", tasks: "Tasks", dashboard: "Dashboard" },
  { locale: "zh-CN", language: "语言", tasks: "任务", dashboard: "概览" },
  { locale: "es", language: "Idioma", tasks: "Tareas", dashboard: "Panel" },
  { locale: "ja", language: "言語", tasks: "タスク", dashboard: "ダッシュボード" },
];
for (const variant of variants) {
  test(`${variant.locale}: navigation, persistence and untouched user content`, async ({ page, request }, testInfo) => {
    const companyResponse = await request.post("/api/companies", { data: { name: `Locale ${variant.locale} ${Date.now()}` } });
    expect(companyResponse.ok()).toBeTruthy();
    const company = await companyResponse.json();
    const title = `原始中文内容 User content ${variant.locale}`;
    const taskResponse = await request.post(`/api/companies/${company.id}/issues`, { data: { title, status: "backlog" } });
    expect(taskResponse.ok(), await taskResponse.text()).toBeTruthy();
    const navigation = await page.goto(`/${company.issuePrefix}/dashboard`);
    expect(navigation?.ok(), "The static UI must be present before locale interaction").toBe(true);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption(variant.locale);
    await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
    await expect(page.getByRole("combobox", { name: variant.language, exact: true })).toHaveValue(variant.locale);
    await page.getByRole("link", { name: variant.tasks, exact: true }).first().click();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const screenshot = testInfo.outputPath(`tasks-${variant.locale}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    await testInfo.attach(`tasks-${variant.locale}`, { path: screenshot, contentType: "image/png" });
    // The fixture creates no assigned Agent and invokes no model provider.
  });
}
