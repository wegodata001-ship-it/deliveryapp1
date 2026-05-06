import { test, expect } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";

test.describe("Demo flow (critical)", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  test("Login + week sync + screens open with AH-120", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await loginAsQaAdmin(page);

    const bar = page.locator(".adm-filter-bar");
    await expect(bar).toBeVisible();

    const weekInput = bar.locator('input[list="adm-week-options"]');
    const fromInput = bar.getByLabel("מתאריך");
    const toInput = bar.getByLabel("עד תאריך");

    // Week -> dates
    await weekInput.fill("AH-120");
    await weekInput.blur();
    await expect(fromInput).toHaveValue("2026-05-10");
    await expect(toInput).toHaveValue("2026-05-16");

    // Non-week range -> "—"
    await fromInput.fill("2026-05-01");
    await toInput.fill("2026-05-15");
    await expect(weekInput).toHaveValue("—");

    // Back to exact week
    await fromInput.fill("2026-05-10");
    await toInput.fill("2026-05-16");
    await expect(weekInput).toHaveValue("AH-120");

    // Orders list
    await page.goto("/admin/orders?week=AH-120&from=2026-05-10&to=2026-05-16&country=TURKEY", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await expect(page).toHaveURL(/\/admin\/orders\?(.+&)?week=AH-120/);

    // Reports
    await page.goto("/admin/reports?week=AH-120&from=2026-05-10&to=2026-05-16&country=TURKEY", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await expect(page.getByRole("heading", { name: "דוחות" })).toBeVisible();

    // Receipt control
    await page.goto("/admin/receipt-control?week=AH-120&from=2026-05-10&to=2026-05-16&country=TURKEY");
    await expect(page.getByRole("heading", { name: "בקרת תקבולים" })).toBeVisible();

    // Back home and open key modals via sidebar labels (openWindow)
    await page.goto("/admin?week=AH-120&from=2026-05-10&to=2026-05-16&country=TURKEY", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    const nav = page.getByRole("navigation");

    await nav.getByRole("button", { name: "קליטת הזמנה" }).click();
    await expect(page.locator(".adm-win-panel--order-capture")).toBeVisible();
    await page.keyboard.press("Escape");

    await nav.getByRole("button", { name: "קליטת תשלום", exact: true }).click();
    await expect(page.locator(".payment-modal")).toBeVisible();
    await page.keyboard.press("Escape");

    await nav.getByRole("button", { name: "קליטת תשלום מעודכן", exact: true }).click();
    await expect(page.locator(".adm-win-panel--payment-capture-updated")).toBeVisible();
    await page.keyboard.press("Escape");

    expect(errors, `Console/page errors: ${errors.join("\n")}`).toEqual([]);
  });
});

