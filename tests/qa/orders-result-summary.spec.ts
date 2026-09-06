import { test, expect } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";

test.describe("Orders result summary", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  test("KPI cards drive matching summary rows from the same filtered list", async ({ page }) => {
    const ordersGets: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/admin/orders") && req.method() === "GET") ordersGets.push(url);
    });

    await loginAsQaAdmin(page);
    await page.goto("/admin/orders?ordersWeek=AH-134");
    await expect(page.locator(".adm-orders-table-host")).toBeVisible({ timeout: 60_000 });

    const summary = page.getByTestId("orders-result-summary");
    const kpi = (title: string) => page.getByRole("button", { name: new RegExp(`^${title}`) });

    await kpi("בוצע").click();
    await expect(page).toHaveURL(/ordersKpi=completed/);
    await expect(summary).toBeVisible();
    await expect(summary.locator('[data-summary-key="completed"]')).toHaveCount(1);
    await expect(summary.locator('[data-summary-key="operationalCompleted"]')).toHaveCount(0);
    await expect(summary.locator('[data-summary-key="total"]')).toHaveCount(1);

    await kpi("הושלם").click();
    await expect(page).toHaveURL(/ordersKpi=.*completed.*operationalCompleted|ordersKpi=.*operationalCompleted.*completed/);
    await expect(summary.locator('[data-summary-key="completed"]')).toHaveCount(1);
    await expect(summary.locator('[data-summary-key="operationalCompleted"]')).toHaveCount(1);
    await expect(summary.locator("tbody tr")).toHaveCount(2);
    await expect(summary.locator('[data-summary-key="total"]')).toHaveCount(1);

    await kpi("הכל").click();
    await expect(page).not.toHaveURL(/ordersKpi=/);
    await expect(page.locator(".adm-global-loading")).toHaveCount(0);

    const afterKpi = ordersGets.length;
    await page.getByRole("button", { name: /^בוצע/ }).click();
    await expect(summary.locator('[data-summary-key="completed"]')).toBeVisible();
    expect(ordersGets.length - afterKpi).toBeLessThanOrEqual(2);
  });

  test("summary total is the filtered set, not the current page", async ({ page }) => {
    await loginAsQaAdmin(page);
    await page.goto("/admin/orders?ordersWeek=AH-134&ordersKpi=completed");
    const summary = page.getByTestId("orders-result-summary");
    await expect(summary).toBeVisible({ timeout: 60_000 });

    const totalCount = Number(await summary.locator('[data-summary-key="total"]').getAttribute("data-total-count"));
    expect(totalCount).toBeGreaterThan(0);

    const label = await page.locator(".adm-orders-pagination__label, .adm-orders-pagination").first().innerText();
    const match = label.match(/מתוך\s+([\d,]+)/);
    expect(match).toBeTruthy();
    const filteredTotal = Number((match?.[1] ?? "0").replace(/,/g, ""));
    expect(totalCount).toBe(filteredTotal);

    const next = page.getByRole("link", { name: "הבא" });
    if (await next.count()) {
      await next.click();
      await expect(page).toHaveURL(/page=2/);
      await expect(summary.locator('[data-summary-key="total"]')).toHaveAttribute(
        "data-total-count",
        String(totalCount),
      );
    }
  });
});
