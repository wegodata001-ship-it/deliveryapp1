import { chromium } from "playwright-core";
import path from "node:path";
import { pathToFileURL } from "node:url";

const html = path.resolve("tmp/shipment-list-proof.html");
const out = path.resolve("tmp/shipment-list-proof.png");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
await page.screenshot({ path: out, fullPage: true });
console.log("SCREENSHOT", out);
await browser.close();
