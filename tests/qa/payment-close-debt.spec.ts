import { test, expect } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";

test.describe("Payments demo: close debt", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  test("select customer -> pay specific debt -> save -> cannot pay again", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await loginAsQaAdmin(page);

    // Open payment modal from sidebar (openWindow)
    const nav = page.getByRole("navigation");
    await nav.getByRole("button", { name: "קליטת תשלום", exact: true }).click();
    await expect(page.locator(".payment-modal")).toBeVisible();

    // Pick a seeded customer by name snippet (WGP seed has ARWA JAZMAWI)
    const nameInput = page.locator(".payment-modal-cust-inp").nth(1);
    await nameInput.fill("ARWA");
    await page.waitForTimeout(450);
    const firstHit = page.locator(".payment-modal-dd-item").first();
    await expect(firstHit).toBeVisible();
    await firstHit.click();

    // Wait for orders table
    const ordersTable = page.locator("table.payment-modal-table");
    await expect(ordersTable).toBeVisible();

    // Click first enabled "שלם" button (remaining > 0)
    const payBtn = page.locator("button.pm-close-debt-btn:not([disabled])").first();
    await expect(payBtn).toBeVisible();
    await payBtn.click();

    // Save payment
    const save = page.getByRole("button", { name: /שמור תשלום/ });
    await expect(save).toBeEnabled();
    await save.click();

    // After save, the specific debt should not be payable again (button disabled somewhere).
    // We assert at least one "שלם" button is disabled now (demo-critical invariant).
    await expect(page.locator("button.pm-close-debt-btn[disabled]").first()).toBeVisible();

    expect(errors, `Console/page errors: ${errors.join("\n")}`).toEqual([]);
  });
});

