import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";

async function main() {
  const outDir = path.join(process.cwd(), ".tmp-ledger-rtl");
  await mkdir(outDir, { recursive: true });

  const font = await readFile(path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf"));
  const meta: CustomerLedgerExportMeta = {
    customerCode: "701",
    displayName: "אחמד",
    phone: "-",
    email: null,
    city: "טורקיה",
    fromYmd: "2026-06-10",
    toYmd: "2026-06-17",
  };
  const ledger: CustomerLedgerPayload = {
    rows: [
      {
        id: "opening",
        dateYmd: "2026-06-10",
        kind: "OPENING_BALANCE",
        typeLabel: "יתרת פתיחה",
        chargeUsd: "0.00",
        paymentUsd: "0.00",
        balanceUsd: "500.00",
        document: "יתרת פתיחה",
        orderId: null,
        paymentId: null,
      },
      {
        id: "ahmad",
        dateYmd: "2026-06-16",
        kind: "ORDER",
        typeLabel: "הזמנה",
        chargeUsd: "800.00",
        paymentUsd: "0.00",
        balanceUsd: "1300.00",
        document: "TR-127-0001 אחמד",
        orderId: "order-1",
        paymentId: null,
      },
      {
        id: "ali",
        dateYmd: "2026-06-14",
        kind: "PAYMENT",
        typeLabel: "תשלום",
        chargeUsd: "0.00",
        paymentUsd: "200.00",
        balanceUsd: "1100.00",
        document: "TR-P-00012 עלי",
        orderId: null,
        paymentId: "pay-1",
        paymentDetail: {
          paymentCode: "TR-P-00012",
          totalUsd: "600.00",
          totalIls: null,
          methods: [
            { method: "CASH", label: "מזומן", amountIls: null, amountUsd: "100.00" },
            { method: "BANK_TRANSFER", label: "העברה בנקאית", amountIls: null, amountUsd: "200.00" },
            { method: "CREDIT", label: "אשראי", amountIls: null, amountUsd: "300.00" },
          ],
          checks: [],
          orders: [],
        },
      },
      {
        id: "shadi",
        dateYmd: "2026-06-13",
        kind: "PAYMENT",
        typeLabel: "תשלום",
        chargeUsd: "0.00",
        paymentUsd: "100.00",
        balanceUsd: "1000.00",
        document: "TR-P-00010 שאדי",
        orderId: null,
        paymentId: "pay-2",
      },
      {
        id: "mohammad",
        dateYmd: "2026-06-12",
        kind: "ORDER",
        typeLabel: "הזמנה",
        chargeUsd: "300.00",
        paymentUsd: "0.00",
        balanceUsd: "1300.00",
        document: "TR-126-0005 محمد",
        orderId: "order-2",
        paymentId: null,
      },
      {
        id: "tasnim",
        dateYmd: "2026-06-11",
        kind: "PAYMENT",
        typeLabel: "ביטול הזמנה",
        chargeUsd: "0.00",
        paymentUsd: "1414.00",
        balanceUsd: "1550.00",
        document: "TR-126-0004 תסנים",
        orderId: "order-3",
        paymentId: null,
        isOrderCancelled: true,
        orderCancelDetail: {
          orderNumber: "TR-127-0004",
          amountUsd: "1414.00",
          balanceBeforeUsd: "1678.62",
          balanceAfterUsd: "3092.62",
          approvedBy: "System Admin",
          reason: "בקשת לקוח",
        },
      },
    ],
    totalChargesUsd: "1350.00",
    totalPaymentsUsd: "300.00",
    totalWithdrawalsUsd: "0.00",
    balanceUsd: "1550.00",
  };

  const html = buildCustomerLedgerPdfHtml({
    meta,
    ledger,
    font: {
      family: "Noto Sans Hebrew",
      mimeType: "font/ttf",
      base64: font.toString("base64"),
    },
  });
  await writeFile(path.join(outDir, "ledger-rtl-test.html"), html, "utf8");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage({ locale: "he-IL", viewport: { width: 1600, height: 1000 } });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outDir, "ledger-rtl-test.png"), fullPage: true });
    await page.pdf({
      path: path.join(outDir, "ledger-rtl-test.pdf"),
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  console.log("Wrote .tmp-ledger-rtl/ledger-rtl-test.pdf");
  console.log("Wrote .tmp-ledger-rtl/ledger-rtl-test.png");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
