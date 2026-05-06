import { test, expect } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";

test.describe("Global week/date/country sync (Header)", () => {
  test("unauth redirect keeps next param", async ({ page }) => {
    await page.goto("/admin?week=AH-118&from=2026-04-26&to=2026-05-02&country=TURKEY");
    await expect(page).toHaveURL(/\/admin-login\?next=%2Fadmin/);
  });

  test("week ↔ date sync (requires auth)", async ({ page }) => {
    test.skip(!USERNAME || !PASSWORD, "Auth env vars missing");

    await loginAsQaAdmin(page);

    const bar = page.locator(".adm-filter-bar");
    await expect(bar).toBeVisible();

    const weekInput = bar.locator('input[list="adm-week-options"]');
    const fromInput = bar.getByLabel("מתאריך");
    const toInput = bar.getByLabel("עד תאריך");

    // Set week -> dates change
    await weekInput.fill("AH-118");
    await weekInput.blur();
    await expect(fromInput).toHaveValue("2026-04-26");
    await expect(toInput).toHaveValue("2026-05-02");

    // Set non-week range -> week becomes "—"
    await fromInput.fill("2026-05-01");
    await toInput.fill("2026-05-15");
    await expect(weekInput).toHaveValue("—");

    // Exact week range -> week restored
    await fromInput.fill("2026-05-03");
    await toInput.fill("2026-05-09");
    await expect(weekInput).toHaveValue("AH-119");
  });
});

