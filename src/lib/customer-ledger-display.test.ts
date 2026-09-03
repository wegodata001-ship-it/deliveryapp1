import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";
import {
  DEFAULT_CUSTOMER_LEDGER_DATE_SORT,
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

  it("all — keeps balance reset as its own movement", () => {
    const withReset = [
      ...rows,
      row({
        id: "br1",
        kind: "BALANCE_RESET",
        typeLabel: "איפוס יתרה",
        isBalanceReset: true,
        document: "איפוס יתרה",
      }),
    ];
    const out = filterLedgerRowsForDisplay(withReset, "all");
    assert.ok(out.some((r) => r.id === "br1"));
    assert.equal(filterLedgerRowsForDisplay(withReset, "payments").some((r) => r.id === "br1"), false);
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

  it("orders filter keeps order-update history rows", () => {
    const withUpdate = [
      ...rows,
      row({
        id: "u1",
        kind: "ORDER",
        typeLabel: "עדכון הזמנה",
        isOrderUpdated: true,
        document: "TR-126-0004",
      }),
    ];
    const out = filterLedgerRowsForDisplay(withUpdate, "orders");
    assert.deepEqual(out.map((r) => r.id), ["o1", "u1"]);
  });
});

describe("sortLedgerRowsForDisplay", () => {
  it("default is old → new (ישן → חדש)", () => {
    assert.equal(DEFAULT_CUSTOMER_LEDGER_DATE_SORT, "old_new");
    const rows: CustomerLedgerRow[] = [
      row({ id: "a", dateYmd: "2026-06-10", document: "TR-126-0004" }),
      row({ id: "b", dateYmd: "2026-06-16", document: "TR-127-0001" }),
      row({ id: "c", dateYmd: "2026-06-14", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
      row({ id: "d", dateYmd: "2026-06-13", document: "TR-P-00010", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows).map((r) => `${r.dateYmd}:${r.document}`);
    assert.deepEqual(sorted, [
      "2026-06-10:TR-126-0004",
      "2026-06-13:TR-P-00010",
      "2026-06-14:TR-P-00012",
      "2026-06-16:TR-127-0001",
    ]);
  });

  it("sorts by date desc then document desc when asked", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "a", dateYmd: "2026-06-10", document: "TR-126-0004" }),
      row({ id: "b", dateYmd: "2026-06-16", document: "TR-127-0001" }),
      row({ id: "c", dateYmd: "2026-06-14", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
      row({ id: "d", dateYmd: "2026-06-13", document: "TR-P-00010", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows, "new_old").map((r) => `${r.dateYmd}:${r.document}`);
    assert.deepEqual(sorted, [
      "2026-06-16:TR-127-0001",
      "2026-06-14:TR-P-00012",
      "2026-06-13:TR-P-00010",
      "2026-06-10:TR-126-0004",
    ]);
  });

  it("same day — older document number first (default)", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "a", dateYmd: "2026-06-14", document: "TR-P-00010", kind: "PAYMENT", typeLabel: "תשלום" }),
      row({ id: "b", dateYmd: "2026-06-14", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows).map((r) => r.document);
    assert.deepEqual(sorted, ["TR-P-00010", "TR-P-00012"]);
  });

  it("same day — createdAt / timestamp wins over document number", () => {
    const rows: CustomerLedgerRow[] = [
      row({
        id: "later-doc",
        dateYmd: "2026-06-14",
        document: "TR-P-00001",
        kind: "PAYMENT",
        typeLabel: "תשלום",
        occurredAtMs: Date.parse("2026-06-14T18:00:00.000Z"),
      }),
      row({
        id: "earlier-doc",
        dateYmd: "2026-06-14",
        document: "TR-P-00099",
        kind: "PAYMENT",
        typeLabel: "תשלום",
        occurredAtMs: Date.parse("2026-06-14T09:00:00.000Z"),
      }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows, "old_new").map((r) => r.id);
    assert.deepEqual(sorted, ["earlier-doc", "later-doc"]);
  });

  it("same day + same timestamp — stable id tie-breaker", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "z-later", dateYmd: "2026-06-14", document: "TR-P-00010", occurredAtMs: 1_000 }),
      row({ id: "a-earlier", dateYmd: "2026-06-14", document: "TR-P-00010", occurredAtMs: 1_000 }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows).map((r) => r.id);
    assert.deepEqual(sorted, ["a-earlier", "z-later"]);
  });

  it("opening balance stays first in default old → new", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "o1", dateYmd: "2026-06-01", document: "TR-120-0001" }),
      row({
        id: "opening",
        dateYmd: "2026-06-01",
        kind: "OPENING_BALANCE",
        typeLabel: "יתרת פתיחה",
        document: "יתרת פתיחה",
        occurredAtMs: 0,
      }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows).map((r) => r.id);
    assert.deepEqual(sorted, ["opening", "o1"]);
  });

  it("same day new_old — later timestamp first", () => {
    const rows: CustomerLedgerRow[] = [
      row({
        id: "morning",
        dateYmd: "2026-06-14",
        document: "TR-P-00010",
        occurredAtMs: Date.parse("2026-06-14T09:00:00.000Z"),
      }),
      row({
        id: "evening",
        dateYmd: "2026-06-14",
        document: "TR-P-00011",
        occurredAtMs: Date.parse("2026-06-14T18:00:00.000Z"),
      }),
    ];
    const sorted = sortLedgerRowsForDisplay(rows, "new_old").map((r) => r.id);
    assert.deepEqual(sorted, ["evening", "morning"]);
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
    assert.deepEqual(out, ["o-old", "o-new"]);
  });

  it("supports payments filter with old_new sort", () => {
    const rows: CustomerLedgerRow[] = [
      row({ id: "o1", dateYmd: "2026-06-01", document: "TR-120-0001" }),
      row({ id: "p-new", dateYmd: "2026-06-16", document: "TR-P-00012", kind: "PAYMENT", typeLabel: "תשלום" }),
      row({ id: "p-old", dateYmd: "2026-06-04", document: "TR-P-00002", kind: "PAYMENT", typeLabel: "תשלום" }),
    ];
    const out = prepareLedgerRowsForDisplay(rows, "payments", "old_new").map((r) => r.id);
    assert.deepEqual(out, ["p-old", "p-new"]);
  });
});
