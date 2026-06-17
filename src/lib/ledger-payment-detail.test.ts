import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLedgerAmountDisplay } from "@/lib/ledger-payment-display";
import {
  buildLedgerPaymentDetail,
  ledgerPaymentMethodDisplayLines,
  type LedgerPaymentBatchRow,
} from "@/lib/ledger-payment-detail";

function batchRow(partial: Partial<LedgerPaymentBatchRow> & Pick<LedgerPaymentBatchRow, "id">): LedgerPaymentBatchRow {
  return {
    paymentCode: "TR-P-00001",
    paymentNumber: 1,
    paymentDate: new Date("2026-06-10"),
    orderId: null,
    amountUsd: null,
    amountIls: null,
    exchangeRate: null,
    paymentMethod: null,
    usdPaymentMethod: null,
    ilsPaymentMethod: null,
    notes: null,
    status: "ACTIVE",
    ...partial,
  };
}

describe("formatLedgerAmountDisplay", () => {
  it("shows ILS primary and USD in parentheses", () => {
    const d = formatLedgerAmountDisplay("1000.00", "333.33");
    assert.ok(d.lines[0]?.includes("1,000"));
    assert.ok(d.lines[1]?.includes("333.33"));
  });

  it("shows USD only when no ILS", () => {
    const d = formatLedgerAmountDisplay(null, "333.33");
    assert.ok(d.lines[0]?.includes("333.33"));
  });
});

describe("buildLedgerPaymentDetail", () => {
  it("merges cash and bank transfer from intake notes", () => {
    const notes = [
      "קליטת תשלום מעודכן (דו-מטבעי)",
      "#1 | ILS ₪500.00 · CASH | vatMode=INCLUDING_VAT",
      "#2 | ILS ₪1000.00 · BANK_TRANSFER | vatMode=INCLUDING_VAT",
    ].join("\n");
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p1",
        amountUsd: { toString: () => "500", toNumber: () => 500 } as never,
        amountIls: { toString: () => "1500", toNumber: () => 1500 } as never,
        exchangeRate: { toString: () => "3", toNumber: () => 3 } as never,
        notes,
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map(),
    });
    assert.ok(detail);
    const lines = ledgerPaymentMethodDisplayLines(detail);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.label, "מזומן");
    assert.equal(lines[0]?.amountIls, "500.00");
    assert.equal(lines[1]?.label, "העברה בנקאית");
    assert.equal(lines[1]?.amountIls, "1000.00");
    assert.equal(detail.totalIls, "1500.00");
    assert.equal(detail.totalUsd, "500.00");
  });
});
