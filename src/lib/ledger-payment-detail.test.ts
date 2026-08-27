import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLedgerAmountDisplay,
  formatLedgerPaymentTotalUsd,
} from "@/lib/ledger-payment-display";
import {
  buildLedgerPaymentDetail,
  ledgerPaymentExpandLines,
  ledgerPaymentMethodDisplayLines,
  shouldShowLedgerPaymentMethodSubrows,
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

describe("formatLedgerPaymentTotalUsd", () => {
  it("shows normalized USD total only", () => {
    assert.ok(formatLedgerPaymentTotalUsd("4300.00").includes("4,300"));
    assert.ok(formatLedgerPaymentTotalUsd("1000").includes("1,000"));
  });
});

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

  it("builds currency components for dual-currency payment", () => {
    const notes = [
      "קליטת תשלום מעודכן (דו-מטבעי)",
      "#1 USD $400.00 · CASH | vatMode=INCLUDING_VAT",
      "#1 ILS ₪900.00 · CASH | vatMode=INCLUDING_VAT",
    ].join("\n");
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p-dual",
        amountUsd: { toString: () => "4300", toNumber: () => 4300 } as never,
        amountIls: { toString: () => "900", toNumber: () => 900 } as never,
        exchangeRate: { toString: () => "3.6", toNumber: () => 3.6 } as never,
        notes,
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map(),
    });
    assert.ok(detail);
    assert.equal(detail.totalUsd, "4300.00");
    assert.ok(formatLedgerPaymentTotalUsd(detail.totalUsd).includes("4,300"));
    assert.equal(detail.components.length, 2);
    assert.equal(detail.components[0]?.label, "דולר");
    assert.equal(detail.components[0]?.amount, "400.00");
    assert.equal(detail.components[1]?.label, "שקל");
    assert.equal(detail.components[1]?.amount, "900.00");
    assert.ok(shouldShowLedgerPaymentMethodSubrows(detail));
    const expand = ledgerPaymentExpandLines(detail);
    assert.equal(expand.length, 2);
    assert.ok(expand[0]?.display.includes("400"));
    assert.ok(expand[1]?.display.includes("900"));
  });

  it("shows debt closure and credit surplus subrows", () => {
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p-order",
        orderId: "o1",
        amountUsd: { toString: () => "19119.30", toNumber: () => 19119.3 } as never,
      }),
      batchRow({
        id: "p-credit",
        businessType: "CUSTOMER_CREDIT",
        amountUsd: { toString: () => "0.70", toNumber: () => 0.7 } as never,
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map([["o1", "ORD-1"]]),
    });
    assert.ok(detail);
    assert.equal(detail.totalUsd, "19120.00");
    assert.equal(detail.debtClosedUsd, "19119.30");
    assert.equal(detail.creditSurplusUsd, "0.70");
    const expand = ledgerPaymentExpandLines(detail);
    assert.ok(expand.some((l) => l.label === "סגירת חוב"));
    assert.ok(expand.some((l) => l.label.includes("יתרת זכות")));
  });
});
