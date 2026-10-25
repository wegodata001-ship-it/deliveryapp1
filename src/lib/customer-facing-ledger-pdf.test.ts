import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerLedgerRow } from "@/app/admin/capture/actions";
import {
  buildCustomerFacingLedgerPdfDefinition,
  dedupeCustomerFacingPaymentRows,
  filterCustomerFacingOrderRows,
  filterCustomerFacingPaymentRows,
  pdfMakeRowFromRtlColumns,
  resolveCustomerFacingPeriod,
  sumCustomerFacingOrdersUsd,
  sumCustomerFacingPaymentsUsd,
} from "@/lib/customer-facing-ledger-pdf";

function orderRow(partial: Partial<CustomerLedgerRow> & Pick<CustomerLedgerRow, "id">): CustomerLedgerRow {
  return {
    dateYmd: "2026-10-10",
    kind: "ORDER",
    typeLabel: "הזמנה",
    chargeUsd: "100",
    paymentUsd: "0",
    balanceUsd: "0",
    document: "TR-1",
    orderId: "o1",
    paymentId: null,
    ...partial,
  };
}

function paymentRow(partial: Partial<CustomerLedgerRow> & Pick<CustomerLedgerRow, "id">): CustomerLedgerRow {
  return {
    dateYmd: "2026-10-12",
    kind: "PAYMENT",
    typeLabel: "תשלום",
    chargeUsd: "0",
    paymentUsd: "60",
    balanceUsd: "0",
    document: "TR-P-30",
    orderId: null,
    paymentId: "p1",
    ...partial,
  };
}

describe("resolveCustomerFacingPeriod", () => {
  it("uses ledger range when period mode is ledger", () => {
    const p = resolveCustomerFacingPeriod(
      { fromYmd: "2026-10-01", toYmd: "2026-10-31" },
      { content: "both", periodMode: "ledger", fromYmd: "", toYmd: "" },
    );
    assert.equal(p.fromYmd, "2026-10-01");
    assert.equal(p.toYmd, "2026-10-31");
  });
});

describe("customer facing row filters", () => {
  it("excludes cancelled payments and respects date range", () => {
    const rows = [
      paymentRow({ id: "p1" }),
      paymentRow({ id: "p2", isPaymentCancelled: true }),
      paymentRow({ id: "p3", dateYmd: "2026-09-01" }),
    ];
    const filtered = filterCustomerFacingPaymentRows(rows, {
      fromYmd: "2026-10-01",
      toYmd: "2026-10-31",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "p1");
  });

  it("sums period totals without double counting", () => {
    const orders = [
      orderRow({ id: "o1", chargeUsd: "1000" }),
      orderRow({ id: "o2", chargeUsd: "250.5" }),
    ];
    const payments = [paymentRow({ id: "p1", paymentUsd: "600" })];
    assert.equal(sumCustomerFacingOrdersUsd(orders), 1250.5);
    assert.equal(sumCustomerFacingPaymentsUsd(payments), 600);
  });

  it("filters display order rows only", () => {
    const rows = [
      orderRow({ id: "o1" }),
      orderRow({ id: "o2", isSupersededOrderVersion: true }),
      orderRow({ id: "o3", typeLabel: "משיכה מחוב", isDebtWithdrawal: true }),
    ];
    const filtered = filterCustomerFacingOrderRows(rows, { fromYmd: "", toYmd: "" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "o1");
  });

  it("dedupes payments by paymentId for period totals", () => {
    const dup = [
      paymentRow({ id: "pb-a", paymentId: "p1", paymentUsd: "3530" }),
      paymentRow({ id: "pb-b", paymentId: "p1", paymentUsd: "3530" }),
    ];
    assert.equal(dedupeCustomerFacingPaymentRows(dup).length, 1);
    assert.equal(sumCustomerFacingPaymentsUsd(dup), 3530);
  });
});

describe("pdf table column order", () => {
  it("aligns data cells with rtl headers (date under תאריך)", () => {
    const headers = ["תאריך", "מספר הזמנה", "סכום הזמנה ($)", "סטטוס"];
    const row = pdfMakeRowFromRtlColumns([
      { text: "02/08/2026" },
      { text: "TR-134-0001" },
      { text: "$3,535.00" },
      { text: "הושלם" },
    ]);
    assert.equal(row.length, 4);
    assert.deepEqual(
      row.map((c) => (typeof c === "object" && c && "text" in c ? String(c.text) : "")),
      ["הושלם", "$3,535.00", "TR-134-0001", "02/08/2026"],
    );
    const doc = buildCustomerFacingLedgerPdfDefinition({
      meta: {
        displayName: "לקוח בדיקה",
        customerCode: "TR-134",
        phone: null,
        email: null,
        fromYmd: "2026-08-01",
        toYmd: "2026-08-31",
      },
      ledger: {
        rows: [
          orderRow({
            id: "o1",
            dateYmd: "2026-08-02",
            document: "TR-134-0001",
            chargeUsd: "3535",
            orderOpenRemainingUsd: "0",
          }),
          paymentRow({
            id: "p1",
            dateYmd: "2026-08-08",
            document: "TR-P-000001",
            paymentUsd: "3530",
          }),
        ],
        balanceUsd: "5.00",
        openDebtUsd: "5.00",
        availableCreditUsd: "0",
        commissionBalanceUsd: "0",
        totalChargesUsd: "3535",
        totalPaymentsUsd: "3530",
        totalWithdrawalsUsd: "0",
      },
      options: { content: "both", periodMode: "ledger", fromYmd: "", toYmd: "" },
    });
    assert.ok(Array.isArray(doc.content));
    assert.equal(headers.length, 4);
  });
});
