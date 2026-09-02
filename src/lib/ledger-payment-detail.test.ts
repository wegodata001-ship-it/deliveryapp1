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

  it("shows commission-to-fee lineage without changing debt/credit", () => {
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p-009",
        paymentCode: "TR-P-000009",
        orderId: "o1",
        amountUsd: { toString: () => "3.00", toNumber: () => 3 } as never,
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map([["o1", "TR-137-0006"]]),
      commissionFees: [{ amountUsd: 3, orderId: "o1", orderNumber: "TR-137-0006" }],
    });
    assert.ok(detail);
    assert.equal(detail.commissionToFeeUsd, "3.00");
    assert.equal(detail.creditSurplusUsd, null);
    const expand = ledgerPaymentExpandLines(detail);
    const feeLine = expand.find((l) => l.tone === "commission");
    assert.ok(feeLine);
    assert.equal(feeLine!.label, "הוספה לעמלות");
    assert.equal(feeLine!.orderNumber, "TR-137-0006");
  });

  it("כרטסת = קליטה: methodAllocations גוברים על סכום FIFO לחוב", () => {
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p-amnan",
        paymentCode: "TR-P-000006",
        paymentNumber: 6,
        orderId: "o1",
        amountUsd: { toString: () => "4666.67", toNumber: () => 4666.67 } as never,
        amountIls: { toString: () => "14550", toNumber: () => 14550 } as never,
        exchangeRate: { toString: () => "3", toNumber: () => 3 } as never,
        notes: "totalPaymentUsd: $7364.41",
        methodAllocations: [
          { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: 9550, amountUsd: 2697.74 },
          { method: "CASH", currency: "USD", sourceAmount: 3000, amountUsd: 3000 },
          { method: "CASH", currency: "ILS", sourceAmount: 5000, amountUsd: 1666.67 },
        ],
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map([["o1", "TR-134-0010"]]),
      commissionFees: [{ amountUsd: 3183.33, orderId: "o1", orderNumber: "TR-134-0010" }],
    });
    assert.ok(detail);
    assert.equal(detail.totalUsd, "7364.41");
    assert.equal(detail.totalIls, "14550.00");
    assert.equal(detail.debtClosedUsd, "4666.67");
    const methods = ledgerPaymentMethodDisplayLines(detail);
    assert.equal(methods.find((m) => m.method === "CASH" && m.amountIls)?.amountIls, "5000.00");
    assert.equal(methods.find((m) => m.method === "CASH" && !m.amountIls)?.amountUsd, "3000.00");
    assert.equal(methods.find((m) => m.method === "BANK_TRANSFER")?.amountIls, "9550.00");
    const expand = ledgerPaymentExpandLines(detail);
    assert.ok(expand.some((l) => l.label === "מזומן" && l.display.includes("5,000")));
    assert.ok(expand.some((l) => l.label === "מזומן" && l.display.includes("3,000")));
    assert.ok(expand.some((l) => l.label === "העברה בנקאית" && l.display.includes("9,550")));
    assert.ok(expand.some((l) => l.label === "סגירת חוב"));
  });

  it("5,000 ₪ מזומן + 6,000 ₪ העברה נשמרים במלואם גם כשיש עודף מעל החוב", () => {
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p-over",
        paymentCode: "TR-P-000099",
        orderId: "o1",
        amountUsd: { toString: () => "2726.17", toNumber: () => 2726.17 } as never,
        amountIls: { toString: () => "11000", toNumber: () => 11000 } as never,
        exchangeRate: { toString: () => "3", toNumber: () => 3 } as never,
        methodAllocations: [
          { method: "CASH", currency: "ILS", sourceAmount: 5000, amountUsd: 1412.43 },
          { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: 6000, amountUsd: 1694.92 },
        ],
      }),
      batchRow({
        id: "p-credit",
        businessType: "CUSTOMER_CREDIT",
        amountUsd: { toString: () => "381.18", toNumber: () => 381.18 } as never,
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map([["o1", "TR-1"]]),
    });
    assert.ok(detail);
    assert.equal(detail.totalUsd, "3107.35");
    assert.equal(detail.totalIls, "11000.00");
    assert.equal(detail.debtClosedUsd, "2726.17");
    assert.equal(detail.creditSurplusUsd, "381.18");
    const methods = ledgerPaymentMethodDisplayLines(detail);
    assert.equal(methods.find((m) => m.method === "CASH")?.amountIls, "5000.00");
    assert.equal(methods.find((m) => m.method === "BANK_TRANSFER")?.amountIls, "6000.00");
    const expand = ledgerPaymentExpandLines(detail);
    assert.ok(expand.some((l) => l.label.includes("יתרת זכות")));
  });

  it("כאמל: 1530 שהתקבל לא מוחלף ב-FIFO 1529.38 אחרי עודף לעמלה", () => {
    const rows: LedgerPaymentBatchRow[] = [
      batchRow({
        id: "p-014",
        paymentCode: "TR-P-000014",
        paymentNumber: 14,
        orderId: "o1",
        amountUsd: { toString: () => "1529.38", toNumber: () => 1529.38 } as never,
        amountIls: null,
        exchangeRate: { toString: () => "3", toNumber: () => 3 } as never,
        notes: "totalPaymentUsd: $1530.00\nהעודף הועבר לעמלה לפי בחירת המשתמש: $0.62",
        methodAllocations: [
          { method: "CASH", currency: "USD", sourceAmount: 1530, amountUsd: 1530 },
        ],
      }),
    ];
    const detail = buildLedgerPaymentDetail({
      batchRows: rows,
      orderNumberById: new Map([["o1", "TR-137-0004"]]),
      commissionFees: [{ amountUsd: 0.62, orderId: "o1", orderNumber: "TR-137-0004" }],
    });
    assert.ok(detail);
    assert.equal(detail.totalUsd, "1530.00");
    assert.equal(detail.totalIls, null);
    assert.equal(detail.debtClosedUsd, "1529.38");
    assert.equal(detail.commissionToFeeUsd, "0.62");
    assert.equal(detail.creditSurplusUsd, null);
    assert.ok(formatLedgerPaymentTotalUsd(detail.totalUsd).includes("1,530"));
    assert.ok(!formatLedgerPaymentTotalUsd(detail.totalUsd).includes("1,529"));
    const expand = ledgerPaymentExpandLines(detail);
    assert.ok(expand.some((l) => l.label === "סגירת חוב" && l.display.includes("1,529.38")));
    assert.ok(expand.some((l) => l.tone === "commission" && l.display.includes("0.62")));
  });
});
