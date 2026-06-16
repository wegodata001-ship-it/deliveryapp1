import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";
import {
  filterLedgerRowsForDisplay,
  prepareLedgerRowsForDisplay,
  sortLedgerRowsForDisplay,
} from "@/lib/customer-ledger-display";

function row(partial: Partial<CustomerLedgerRow> & Pick<CustomerLedgerRow, "id">): CustomerLedgerRow {
  return {
    dateYmd: "2026-06-10",
    kind: "ORDER",
    typeLabel: "הזמנה",
    chargeUsd: "0.00",
    paymentUsd: "0.00",
    balanceUsd: "0.00",
    document: "TR-126-0004",
    orderId: null,
    paymentId: null,
    ...partial,
  };
}

describe("filterLedgerRowsForDisplay", () => {
  const rows: CustomerLedgerRow[] = [
    row({ id: "o1", kind: "ORDER", typeLabel: "הזמנה" }),
    row({ id: "p1", kind: "PAYMENT", typeLabel: "תשלום", document: "TR-P-00010" }),
    row({ id: "c1", kind: "PAYMENT", typeLabel: "ביטול חשבונית באישור מנהל", isPaymentCancelled: true }),
    row({ id: "ob", kind: "OPENING_BALANCE", typeLabel: "יתרת פתיחה", document: "יתרת פתיחה" }),
  ];

  it("all — keeps every row", () => {
    assert.equal(filterLedgerRowsForDisplay(rows, "all").length, 4);
  });

  it("payments — only regular payments", () => {
    const out = filterLedgerRowsForDisplay(rows, "payments");
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, "p1");
  });

  it("orders — only regular orders", () => {
    const out = filterLedgerRowsForDisplay(rows, "orders");
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, "o1");
  });
});

describe("sortLedgerRowsForDisplay", () => {
  it("sorts by date desc then document desc", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "a", dateYmd: "2026-06-10", document: "TR-126-0004" }),
      row({ id: "b", dateYmd: "2026-06-16", document: "TR-127-0001" }),
      row({ id: "c", dateYmd: "2026-06-14", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
      row({ id: "d", dateYmd: "2026-06-13", document: "TR-P-00010", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows).map((r) => `${r.dateYmd}:${r.document}`);
    assert.deepEqual(sorted, [
      "2026-06-16:TR-127-0001",
      "2026-06-14:TR-P-00012",
      "2026-06-13:TR-P-00010",
      "2026-06-10:TR-126-0004",
    ]);
  });

  it("same day — newer document number first", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "a", dateYmd: "2026-06-14", document: "TR-P-00010", kind: "PAYMENT", typeLabel: "תשלום" }),
      row({ id: "b", dateYmd: "2026-06-14", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows).map((r) => r.document);
    assert.deepEqual(sorted, ["TR-P-00012", "TR-P-00010"]);
  });
});

describe("prepareLedgerRowsForDisplay", () => {
  it("filters then sorts", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "o-old", dateYmd: "2026-06-01", document: "TR-120-0001" }),
      row({ id: "o-new", dateYmd: "2026-06-16", document: "TR-127-0001" }),
      row({ id: "p1", dateYmd: "2026-06-14", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const out = prepareLedgerRowsForDisplay(rows, "orders").map((r) => r.id);
    assert.deepEqual(out, ["o-new", "o-old"]);
  });
});
