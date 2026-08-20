import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchPdfBrowser } from "@/lib/pdf/browser";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";
import type { CustomerLedgerExportMeta, LedgerPdfMode } from "@/lib/customer-ledger-export";

type Scenario = {
  slug: string;
  mode?: LedgerPdfMode;
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
};

function money(n: number): string {
  return n.toFixed(2);
}

function orderRow(id: string, dateYmd: string, document: string, chargeUsd: number, balanceUsd: number) {
  return {
    id,
    dateYmd,
    kind: "ORDER" as const,
    typeLabel: "הזמנה",
    chargeUsd: money(chargeUsd),
    paymentUsd: "0.00",
    balanceUsd: money(balanceUsd),
    document,
    orderId: id,
    paymentId: null,
  };
}

function paymentRow(id: string, dateYmd: string, document: string, paymentUsd: number, balanceUsd: number) {
  return {
    id,
    dateYmd,
    kind: "PAYMENT" as const,
    typeLabel: "תשלום",
    chargeUsd: "0.00",
    paymentUsd: money(paymentUsd),
    balanceUsd: money(balanceUsd),
    document,
    orderId: null,
    paymentId: id,
  };
}

function buildMultipageLedger(): CustomerLedgerPayload {
  const rows: CustomerLedgerPayload["rows"] = [
    {
      id: "opening",
      dateYmd: "2026-08-01",
      kind: "OPENING_BALANCE",
      typeLabel: "יתרת פתיחה",
      chargeUsd: "0.00",
      paymentUsd: "0.00",
      balanceUsd: "250.00",
      document: "יתרת פתיחה",
      orderId: null,
      paymentId: null,
    },
  ];

  let balance = 250;
  for (let i = 1; i <= 32; i += 1) {
    const day = String((i % 28) + 1).padStart(2, "0");
    balance += 150 + i;
    rows.push(
      orderRow(
        `order-${i}`,
        `2026-08-${day}`,
        `TR-136-${String(i).padStart(4, "0")}`,
        150 + i,
        balance,
      ),
    );
    if (i % 2 === 0) {
      balance -= 90 + i;
      rows.push(
        paymentRow(
          `payment-${i}`,
          `2026-08-${day}`,
          `TR-P-${String(400 + i).padStart(6, "0")}`,
          90 + i,
          balance,
        ),
      );
    }
  }

  const totalCharges = rows.reduce((sum, row) => sum + Number(row.chargeUsd ?? 0), 0);
  const totalPayments = rows.reduce((sum, row) => sum + Number(row.paymentUsd ?? 0), 0);
  return {
    rows,
    totalChargesUsd: money(totalCharges),
    totalPaymentsUsd: money(totalPayments),
    totalWithdrawalsUsd: "0.00",
    balanceUsd: money(balance),
  };
}

async function writeScenario(outDir: string, fontBase64: string, scenario: Scenario): Promise<void> {
  const html = buildCustomerLedgerPdfHtml({
    meta: scenario.meta,
    ledger: scenario.ledger,
    mode: scenario.mode ?? "regular",
    font: {
      family: "Noto Sans Hebrew",
      mimeType: "font/ttf",
      base64: fontBase64,
    },
  });

  const htmlPath = path.join(outDir, `${scenario.slug}.html`);
  const pngPath = path.join(outDir, `${scenario.slug}.png`);
  const pdfPath = path.join(outDir, `${scenario.slug}.pdf`);
  await writeFile(htmlPath, html, "utf8");

  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage({ locale: "he-IL", viewport: { width: 1600, height: 1000 } });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.screenshot({ path: pngPath, fullPage: true });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  console.log(`Wrote .tmp-ledger-rtl/${scenario.slug}.pdf`);
  console.log(`Wrote .tmp-ledger-rtl/${scenario.slug}.png`);
}

async function main() {
  const outDir = path.join(process.cwd(), ".tmp-ledger-rtl");
  await mkdir(outDir, { recursive: true });

  const font = await readFile(path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf"));
  const fontBase64 = font.toString("base64");

  const scenarios: Scenario[] = [
    {
      slug: "ledger-single-order",
      meta: {
        customerCode: "101",
        displayName: "789",
        phone: "050-1111111",
        email: null,
        city: "איסטנבול",
        fromYmd: "2026-08-20",
        toYmd: "2026-08-20",
        quickFilterLabel: "הכל",
        sortLabel: "ישן → חדש",
      },
      ledger: {
        rows: [
          {
            id: "single-order",
            dateYmd: "2026-08-20",
            kind: "ORDER",
            typeLabel: "הזמנה",
            chargeUsd: "1515.00",
            paymentUsd: "0.00",
            balanceUsd: "1515.00",
            document: "TR-136-0001",
            orderId: "single-order",
            paymentId: null,
          },
        ],
        totalChargesUsd: "1515.00",
        totalPaymentsUsd: "0.00",
        totalWithdrawalsUsd: "0.00",
        balanceUsd: "1515.00",
      },
    },
    {
      slug: "ledger-mixed-transactions",
      mode: "detailed",
      meta: {
        customerCode: "701",
        displayName: "אחמד אר",
        phone: "050-2222222",
        email: null,
        city: "איסטנבול",
        fromYmd: "2026-06-10",
        toYmd: "2026-06-17",
        quickFilterLabel: "הכל",
        sortLabel: "חדש → ישן",
      },
      ledger: {
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
          orderRow("order-1", "2026-06-16", "TR-127-0001", 800, 1300),
          {
            ...paymentRow("pay-1", "2026-06-14", "TR-P-000012", 600, 700),
            paymentDetail: {
              paymentCode: "TR-P-000012",
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
          paymentRow("pay-2", "2026-06-13", "TR-P-000010", 100, 600),
          orderRow("order-2", "2026-06-12", "TR-126-0005", 300, 900),
          {
            id: "cancel-row",
            dateYmd: "2026-06-11",
            kind: "PAYMENT",
            typeLabel: "ביטול הזמנה",
            chargeUsd: "0.00",
            paymentUsd: "1414.00",
            balanceUsd: "1550.00",
            document: "TR-126-0004",
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
        totalChargesUsd: "1100.00",
        totalPaymentsUsd: "2114.00",
        totalWithdrawalsUsd: "0.00",
        balanceUsd: "1550.00",
      },
    },
    {
      slug: "ledger-multipage",
      meta: {
        customerCode: "999",
        displayName: "לקוח עם הרבה תנועות",
        phone: "050-3333333",
        email: null,
        city: "איסטנבול",
        fromYmd: "2026-08-01",
        toYmd: "2026-08-28",
        quickFilterLabel: "הכל",
        sortLabel: "ישן → חדש",
      },
      ledger: buildMultipageLedger(),
    },
  ];

  for (const scenario of scenarios) {
    await writeScenario(outDir, fontBase64, scenario);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
