/**
 * שירות דפדפן ל-PDF — נקודת הכניסה היחידה לפתיחת Chromium במערכת WEGO.
 *
 * מנוע: playwright-core + @sparticuz/chromium (Serverless‑friendly עבור Vercel / AWS Lambda).
 * אין לפתוח Browser ישירות מתוך Routes — כל הפקת PDF עוברת דרך renderHtmlToPdf() כאן.
 *
 * שמירה על זהות מוחלטת למסמכים הקיימים: אותם locale, אותו emulateMedia("print"),
 * ואותן אפשרויות page.pdf() (A4 landscape, printBackground, preferCSSPageSize, margin 0)
 * שהיו בשימוש בכל ה-routes לפני המעבר. רק המנוע הוחלף.
 */

import sparticuzChromium from "@sparticuz/chromium";
import { chromium, type Browser } from "playwright-core";

const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

/** סביבת Serverless (Vercel / AWS Lambda) — שם נשתמש ב-@sparticuz/chromium. */
function isServerlessRuntime(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_VERSION ||
    process.env.AWS_EXECUTION_ENV
  );
}

/** עקיפה ידנית של נתיב ה-executable (פיתוח מקומי / CI) */
function localExecutableOverride(): string | undefined {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    undefined
  );
}

/**
 * פותח Chromium מתאים לסביבה.
 * - Serverless: בינארי דחוס מ-@sparticuz/chromium (~50MB) — אינו אורז Chromium מלא.
 * - מקומי: executable מפורש (env) או ערוץ ה-Chrome המותקן במערכת.
 */
export async function launchPdfBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    return chromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }

  const override = localExecutableOverride();
  if (override) {
    return chromium.launch({ headless: true, args: LAUNCH_ARGS, executablePath: override });
  }
  // פיתוח מקומי — שימוש ב-Chrome המותקן במערכת
  return chromium.launch({ headless: true, args: LAUNCH_ARGS, channel: "chrome" });
}

/**
 * ממיר HTML ל-PDF (Uint8Array). פותח וסוגר Browser פעם אחת בלבד לכל בקשה
 * (ללא Memory Leak). מחזיר null אם ההרצה נכשלה — כדי לאפשר fallback ל-HTML
 * כפי שהיה נהוג בכל ה-routes.
 *
 * אפשרויות העמוד/PDF זהות לחלוטין למה שהיה לפני המעבר (A4 landscape וכו').
 */
export async function renderHtmlToPdf(html: string): Promise<Uint8Array | null> {
  let browser: Browser | null = null;
  try {
    browser = await launchPdfBrowser();
    const page = await browser.newPage({ locale: "he-IL" });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return new Uint8Array(pdf);
  } catch (error) {
    console.warn("[pdf-browser] render failed — HTML fallback", error);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
