import { test, expect, type Page } from "@playwright/test";
import { USERNAME, PASSWORD, loginAsQaAdmin } from "./helpers/auth";
import path from "node:path";

test.use({ channel: "chrome", video: "off", trace: "off" });

test.describe("Payment intake — יתרת לקוח card", () => {
  test.skip(!USERNAME || !PASSWORD, "Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD");

  async function openPaymentModal(page: Page) {
    const dock = page.getByRole("toolbar", { name: "פעולות מהירות" });
    await dock.getByRole("button", { name: "קליטת תשלום", exact: true }).click();
    const modal = page.locator(".payment-modal");
    await expect(modal).toBeVisible({ timeout: 60_000 });
    return modal;
  }

  async function selectCustomerByQuery(page: Page, query: string, hitText?: string) {
    const nameInput = page.locator(".payment-modal-cust-inp--name");
    await nameInput.fill(query);
    await page.getByRole("button", { name: "חיפוש לפי שם לקוח" }).click();
    const hit = hitText
      ? page.locator(".payment-modal-dd-item").filter({ hasText: hitText }).first()
      : page.locator(".payment-modal-dd-item").first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();
  }

  async function expectKhalilCurrentCredit(page: Page) {
    const card = page.getByTestId("payment-customer-balance-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".payment-modal-live-kpi__lbl")).toHaveText("יתרת לקוח");
    await expect(card.locator(".payment-modal-live-kpi__hero-v")).not.toHaveText("טוען…");
    await expect(card).toContainText("+$409.00");
    await expect(card).toContainText("יתרת זכות ללקוח");
    await expect(card).not.toContainText("נשאר לתשלום");
    await expect(card.locator(".payment-modal-live-kpi__hero-v")).toHaveText("+$409.00");
    const weekDebt = page.getByTestId("payment-week-order-debt");
    await expect(weekDebt).toContainText("חוב הזמנות בשבוע הנבחר");
    await expect(weekDebt).toContainText("$0.00");
    return card;
  }

  test("101 CURRENT +$409 on AH-144, week switch, typed amount, reopen", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsQaAdmin(page);
    await openPaymentModal(page);

    await selectCustomerByQuery(page, "חליל", "101");
    const card = await expectKhalilCurrentCredit(page);

    await card.screenshot({ path: path.join("test-results", "khalil-customer-balance-card.png") });
    await page.locator(".payment-modal").screenshot({
      path: path.join("test-results", "khalil-payment-intake-modal.png"),
    });

    const weekInp = page.locator(".payment-modal-week-inp");
    await weekInp.fill("AH-145");
    await weekInp.blur();
    await expectKhalilCurrentCredit(page);

    await weekInp.fill("AH-144");
    await weekInp.blur();
    await expectKhalilCurrentCredit(page);

    const amountBox = page.locator(".payment-modal-inp--amount").first();
    await amountBox.fill("50");
    await expect(amountBox).toHaveValue(/50/);
    await expect(page.getByTestId("payment-customer-balance-before")).toContainText("+$409.00");
    await expect(page.getByTestId("payment-customer-balance-after")).toContainText("יתרת לקוח צפויה");
    await expectKhalilCurrentCredit(page);

    await page.locator(".ui-close").first().click();
    await expect(page.locator(".payment-modal")).toHaveCount(0);

    await openPaymentModal(page);
    await selectCustomerByQuery(page, "חליל", "101");
    await expectKhalilCurrentCredit(page);
  });

  test("customer change replaces 101 card then 101 returns to +$409", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsQaAdmin(page);
    await openPaymentModal(page);
    await selectCustomerByQuery(page, "חליל", "101");
    await expectKhalilCurrentCredit(page);

    await selectCustomerByQuery(page, "עומר", "102");
    const otherCard = page.getByTestId("payment-customer-balance-card");
    await expect(otherCard).toBeVisible({ timeout: 30_000 });
    await expect(otherCard.locator(".payment-modal-live-kpi__lbl")).toHaveText("יתרת לקוח");
    await expect(otherCard.locator(".payment-modal-live-kpi__hero-v")).not.toHaveText("טוען…");

    await selectCustomerByQuery(page, "חליל", "101");
    await expectKhalilCurrentCredit(page);
  });

  test("107 CURRENT debt stays on the card when week remaining is $0", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsQaAdmin(page);
    await openPaymentModal(page);
    await selectCustomerByQuery(page, "חנאן", "107");
    const card = page.getByTestId("payment-customer-balance-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".payment-modal-live-kpi__lbl")).toHaveText("יתרת לקוח");
    await expect(card).toContainText("-$1,212.00");
    await expect(card).toContainText("חוב פתוח");
    await page.locator(".payment-modal-week-inp").fill("AH-144");
    await page.locator(".payment-modal-week-inp").blur();
    await expect(card).toContainText("-$1,212.00");
    await expect(page.getByTestId("payment-week-order-debt")).toContainText("חוב הזמנות בשבוע הנבחר");
  });
});
