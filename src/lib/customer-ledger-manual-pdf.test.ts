import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/lib/customer-account-ledger";
import {
  applyManualLedgerSelection,
  filterLedgerRowsBySelectedIds,
  sortSelectedLedgerRowsChronological,
} from "@/lib/customer-ledger-manual-pdf";

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

const ledger: CustomerLedgerPayload = {
  rows: [
    row({ id: "o1", dateYmd: "2026-06-01", document: "TR-1", chargeUsd: "1000.00", balanceUsd: "1000.00" }),
    row({
      id: "p1",
      dateYmd: "2026-06-02",
      kind: "PAYMENT",
      typeLabel: "תשלום",
      document: "TR-P-1",
      paymentUsd: "300.00",
      balanceUsd: "700.00",
    }),
    row({ id: "o2", dateYmd: "2026-06-03", document: "TR-2", chargeUsd: "500.00", balanceUsd: "1200.00" }),
  ],
  totalChargesUsd: "1500.00",
  totalPaymentsUsd: "300.00",
  totalWithdrawalsUsd: "0.00",
  balanceUsd: "1200.00",
  openDebtUsd: "1200.00",
  availableCreditUsd: "0.00",
  commissionBalanceUsd: "0.00",
};

describe("manual ledger PDF selection", () => {
  it("keeps historical running balance — no replay of selected rows only", () => {
    const res = applyManualLedgerSelection(ledger, ["o2", "o1"]);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.ledger.rows.map((r) => r.id), ["o1", "o2"]);
    assert.equal(res.ledger.rows[1]?.balanceUsd, "1200.00");
    assert.notEqual(res.ledger.rows[1]?.balanceUsd, "1500.00");
    assert.equal(res.summary.lastSelectedBalanceUsd, "1200.00");
  });

  it("sorts selected rows old → new even if picked newest first", () => {
    const sorted = sortSelectedLedgerRowsChronological([ledger.rows[2]!, ledger.rows[0]!]);
    assert.deepEqual(sorted.map((r) => r.id), ["o1", "o2"]);
  });

  it("rejects IDs that are not in this customer ledger", () => {
    const res = filterLedgerRowsBySelectedIds(ledger.rows, ["o1", "other-customer-row"]);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.deepEqual(res.missingIds, ["other-customer-row"]);
  });

  it("single row and empty selection", () => {
    const one = applyManualLedgerSelection(ledger, ["p1"]);
    assert.equal(one.ok, true);
    if (one.ok) {
      assert.equal(one.ledger.rows.length, 1);
      assert.equal(one.ledger.rows[0]?.balanceUsd, "700.00");
      assert.equal(one.summary.selectedCount, 1);
    }
    const empty = applyManualLedgerSelection(ledger, []);
    assert.equal(empty.ok, true);
    if (empty.ok) assert.equal(empty.ledger.rows.length, 0);
  });
});
