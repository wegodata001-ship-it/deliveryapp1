import { test, expect } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";

/** תואם ל־moneyIls ב־reports/actions.ts (he-IL, 2 ספרות) */
function moneyIlsHe(n: number): string {
  return `₪ ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

test.describe("Reports demo: customer balances", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  test("יתרות לקוחות: כל הלקוחות הפעילים מוצגים; יתרה 0 ויתרה פתוחה", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (res) => {
      if (res.status() >= 500) errors.push(`HTTP ${res.status()} ${res.url()}`);
    });

    await loginAsQaAdmin(page);

    await page.goto("/admin/reports?from=2026-05-01&to=2026-05-31&week=AH-119");
    await expect(page.getByRole("heading", { name: "דוחות" })).toBeVisible();

    const card = page.locator("article").filter({ hasText: "יתרות לקוחות" }).first();
    const openBtn = card.getByRole("button", { name: /צפייה בדוח|צפייה/ }).first();
    await openBtn.click();

    await expect(page.getByRole("heading", { name: /יתרות לקוחות/ })).toBeVisible();

    const modal = page.locator(".ui-modal");
    const table = modal.locator("table.adm-report-table");
    await expect(table).toBeVisible({ timeout: 90_000 });
    const tbody = table.locator("tbody");

    await expect(tbody).toBeVisible();
    await expect(tbody).toContainText("QA-REPORT-ZERO");
    await expect(tbody).toContainText("QA-REPORT-OPEN");

    const openRow = tbody.locator("tr").filter({ hasText: "QA-REPORT-OPEN" }).first();
    await expect(openRow).toBeVisible();
    const cells = openRow.locator("td");
    await expect(cells.nth(2)).toContainText(moneyIlsHe(5000));
    await expect(cells.nth(3)).toContainText(moneyIlsHe(2000));
    await expect(cells.nth(4)).toContainText(moneyIlsHe(3000));

    const zeroRow = tbody.locator("tr").filter({ hasText: "QA-REPORT-ZERO" }).first();
    await expect(zeroRow).toBeVisible();
    await expect(zeroRow).toContainText("מאוזן");

    const summary = modal.locator(".adm-report-summary");
    await expect(summary).toBeVisible();

    expect(errors, `Console/page/network errors: ${errors.join("\n")}`).toEqual([]);
  });
});
