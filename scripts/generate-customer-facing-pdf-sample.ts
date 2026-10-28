/**
 * node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/generate-customer-facing-pdf-sample.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import { buildCustomerFacingLedgerPdfDefinition } from "@/lib/customer-facing-ledger-pdf";
import { getLedgerPdfMake } from "@/lib/ledger-pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

type PdfMakeBuffer = {
  getBuffer: (cb: (buf: Buffer) => void) => void;
};

function order(id: string, dateYmd: string, document: string, chargeUsd: string) {
  return {
    id,
    dateYmd,
    kind: "ORDER" as const,
    typeLabel: "הזמנה",
    chargeUsd,
    paymentUsd: "0",
    balanceUsd: "0",
    document,
    orderId: id,
    paymentId: null,
    orderOpenRemainingUsd: "0",
  };
}

function payment(id: string, dateYmd: string, document: string, paymentUsd: string, paymentId: string) {
  return {
    id,
    dateYmd,
    kind: "PAYMENT" as const,
    typeLabel: "תשלום",
    chargeUsd: "0",
    paymentUsd,
    balanceUsd: "0",
    document,
    orderId: null,
    paymentId,
  };
}

const ledger: CustomerLedgerPayload = {
  rows: [
    order("o1", "2026-08-02", "TR-134-0001", "3535.00"),
    payment("pb-1", "2026-08-08", "TR-P-000001", "3530.00", "pay-1"),
    ...Array.from({ length: 28 }, (_, i) =>
      order(`o-${i + 2}`, `2026-08-${String((i % 27) + 2).padStart(2, "0")}`, `TR-134-${String(i + 2).padStart(4, "0")}`, "120.00"),
    ),
  ],
  balanceUsd: "5.00",
  openDebtUsd: "5.00",
  availableCreditUsd: "0.00",
  commissionBalanceUsd: "0.00",
  totalChargesUsd: "7000.00",
  totalPaymentsUsd: "3530.00",
  totalWithdrawalsUsd: "0.00",
};

async function main() {
  const pdfMake = await getLedgerPdfMake();
  const doc = buildCustomerFacingLedgerPdfDefinition({
    meta: {
      displayName: "לקוח דוגמה בעברית",
      customerCode: "TR-134",
      phone: "0500000000",
      email: "demo@example.com",
      fromYmd: "2026-08-01",
      toYmd: "2026-08-31",
    },
    ledger,
    options: { content: "both", periodMode: "ledger", fromYmd: "", toYmd: "" },
  });

  const outDir = path.join(process.cwd(), "tmp");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "customer-facing-ledger-sample.pdf");

  const factory = pdfMake as unknown as { createPdf: (d: TDocumentDefinitions) => PdfMakeBuffer };
  await new Promise<void>((resolve, reject) => {
    factory.createPdf(doc).getBuffer(async (buf) => {
      try {
        await writeFile(outPath, buf);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });

  console.log(`Wrote ${outPath} (${ledger.rows.length} ledger rows, period payments should be 3530 USD)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
