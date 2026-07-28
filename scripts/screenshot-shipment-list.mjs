/**
 * צילום מסך לרשימת משלוחים
 * node scripts/screenshot-shipment-list.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL || "http://localhost:3000";
const BATCH =
  process.env.BATCH_ID || "19c6bab6-acdf-49c6-beac-dbbed0f362bf";
const USER = process.env.ADMIN_USER || "wego-super";
const PASS = process.env.ADMIN_PASS || "WegoDev2026!Aa";
const OUT = path.resolve("tmp/shipment-list-proof.png");

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
const page = await context.newPage();

try {
  // login via API (sets cookie)
  const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: USER, password: PASS, next: `/admin/shipments/${BATCH}` },
    headers: { "content-type": "application/json" },
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  console.log("login status", loginRes.status(), loginBody?.ok ?? loginBody);

  if (!loginRes.ok()) {
    // fallback UI login
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('input[type="password"]', { timeout: 20000 });
    const inputs = page.locator("form input");
    await inputs.nth(0).fill(USER);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
  }

  const url = `${BASE}/admin/shipments/${BATCH}?country=TURKEY`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector("table.shp-table", { timeout: 45000 });
  await page.waitForTimeout(2000);

  const headers = await page.$$eval("table.shp-table thead th", (ths) =>
    ths.map((th) => (th.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean),
  );
  console.log("HEADERS:", headers);

  if (headers.some((h) => h.includes("מקום מסירה מעודכן"))) {
    throw new Error('Column "מקום מסירה מעודכן" still visible');
  }
  if (!headers.some((h) => h.includes("אזור חלוקה"))) {
    throw new Error('Missing "אזור חלוקה"');
  }
  if (!headers.some((h) => h.includes("יתרת לקוח"))) {
    throw new Error('Missing "יתרת לקוח"');
  }

  const zones = await page.$$eval("table.shp-table tbody tr .c-zone", (cells) =>
    cells.slice(0, 15).map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()),
  );
  console.log("ZONES:", zones);

  const bals = await page.$$eval("table.shp-table tbody tr .c-bal", (cells) =>
    cells.slice(0, 15).map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()),
  );
  console.log("BALANCES:", bals);

  const table = page.locator("table.shp-table").first();
  await table.screenshot({ path: OUT });
  console.log("SCREENSHOT:", OUT);
} finally {
  await browser.close();
}
