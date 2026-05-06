import { expect, type Page } from "@playwright/test";

const USERNAME = process.env.E2E_ADMIN_USERNAME || "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";

export { USERNAME, PASSWORD };

export async function loginAsQaAdmin(page: Page, opts?: { navigationTimeoutMs?: number }) {
  const navTimeout = opts?.navigationTimeoutMs ?? 60_000;
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin-login/);
  await page.locator("#username").fill(USERNAME);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form.al-form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin(\?|$)/, { timeout: navTimeout });
}
