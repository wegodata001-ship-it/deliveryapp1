import { test, expect } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";

test.describe("Orders week picker UX", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  test("compact overlay, local search, no fetch on open/type", async ({ page }) => {
    await loginAsQaAdmin(page);
    await page.goto("/admin/orders");
    await expect(page.locator(".ofb-week-picker, .awp").first()).toBeVisible({ timeout: 60_000 });

    const kpiTopBefore = await page.locator(".adm-orders-status-kpi").first().boundingBox();
    const chip = page.locator(".ofb-week-picker__chip, .awp button[aria-haspopup='listbox']").first();
    await chip.click();

    const dropdown = page.locator(".awp__dropdown");
    await expect(dropdown).toBeVisible();
    const box = await dropdown.boundingBox();
    const chipBox = await chip.boundingBox();
    expect(box).toBeTruthy();
    expect(chipBox).toBeTruthy();
    expect(box!.height).toBeLessThanOrEqual(360);
    expect(Math.abs(box!.x - chipBox!.x)).toBeLessThan(80);
    expect(box!.y).toBeGreaterThan(chipBox!.y);

    const kpiTopAfter = await page.locator(".adm-orders-status-kpi").first().boundingBox();
    if (kpiTopBefore && kpiTopAfter) {
      expect(Math.abs(kpiTopAfter.y - kpiTopBefore.y)).toBeLessThan(8);
    }

    const ordersRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/admin/orders") && req.method() === "GET") {
        ordersRequests.push(url);
      }
    });

    const search = dropdown.locator('input[aria-label="חיפוש שבוע"]');
    await search.fill("139");
    await expect(dropdown.getByRole("option").filter({ hasText: "AH-139" }).first()).toBeVisible();
    expect(ordersRequests.length).toBe(0);

    await page.keyboard.press("Escape");
    await expect(dropdown).toHaveCount(0);

    for (let i = 0; i < 10; i++) {
      await chip.click();
      await expect(dropdown).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dropdown).toHaveCount(0);
    }
    expect(ordersRequests.length).toBe(0);
  });

  test("select week updates URL once and keeps table host", async ({ page }) => {
    await loginAsQaAdmin(page);
    await page.goto("/admin/orders?ordersWeek=AH-138");
    await expect(page.locator(".ofb-week-picker, .awp").first()).toBeVisible({ timeout: 60_000 });

    const chip = page.locator(".ofb-week-picker__chip, .awp button[aria-haspopup='listbox']").first();
    await chip.click();
    const dropdown = page.locator(".awp__dropdown");
    await dropdown.locator('input[aria-label="חיפוש שבוע"]').fill("139");
    await dropdown.getByRole("option").filter({ hasText: "AH-139" }).first().click();
    await expect(dropdown).toHaveCount(0);
    await expect(page).toHaveURL(/ordersWeek=AH-139/);
    await expect(page.locator(".adm-global-loading")).toHaveCount(0);
    await expect(page.locator(".adm-orders-table-host")).toBeVisible();
  });

  test("hard refresh keeps ordersWeek", async ({ page }) => {
    await loginAsQaAdmin(page);
    await page.goto("/admin/orders?ordersWeek=AH-139");
    await expect(page.locator(".ofb-week-picker__chip, .awp button[aria-haspopup='listbox']").first()).toContainText(
      "AH-139",
      { timeout: 60_000 },
    );
    await page.reload();
    await expect(page.locator(".ofb-week-picker__chip, .awp button[aria-haspopup='listbox']").first()).toContainText(
      "AH-139",
    );
    await expect(page).toHaveURL(/ordersWeek=AH-139/);
  });
});

test.describe("Balances week picker UX", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  test("compact overlay does not use native datalist", async ({ page }) => {
    await loginAsQaAdmin(page);
    await page.goto("/admin/balances");
    await expect(page.locator(".adm-report-week-nav").first()).toBeVisible({ timeout: 60_000 });
    await page.locator(".adm-report-week-nav__chip").first().click();
    await expect(page.locator(".awp__dropdown")).toBeVisible();
    await expect(page.locator("datalist")).toHaveCount(0);
    await page.locator(".awp__dropdown input").fill("139");
    await expect(page.locator(".awp__dropdown").getByRole("option").filter({ hasText: "AH-139" })).toBeVisible();
  });
});
