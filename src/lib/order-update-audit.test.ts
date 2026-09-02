import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderEditDiffRow } from "@/lib/order-edit-snapshot";
import {
  buildOrderUpdateAuditMetadata,
  parseOrderUpdateLedgerDetail,
  ORDER_UPDATE_LEDGER_KIND,
} from "@/lib/order-update-audit";

function diff(rows: Array<Pick<OrderEditDiffRow, "key" | "before" | "after"> & { label?: string }>): OrderEditDiffRow[] {
  return rows.map((r) => ({
    key: r.key,
    label: r.label ?? r.key,
    before: r.before,
    after: r.after,
  }));
}

const baseMeta = {
  orderId: "o1",
  orderNumber: "TR-134-0014",
  customerId: "c1",
  requestedBy: "עובד",
  approvedBy: "מנהל",
};

describe("buildOrderUpdateAuditMetadata — financial vs audit", () => {
  it("notes only — audit without ledgerKind", () => {
    const meta = buildOrderUpdateAuditMetadata({
      ...baseMeta,
      diff: diff([{ key: "notes", label: "הערות", before: "", after: "עם הסחורה" }]),
    });
    assert.ok(meta);
    assert.equal(meta.financialLedger, false);
    assert.equal(meta.ledgerKind, undefined);
    assert.equal((meta.changes as { field: string }[]).some((c) => c.field === "notes"), true);
  });

  it("amount change — ledger event + delta", () => {
    const meta = buildOrderUpdateAuditMetadata({
      ...baseMeta,
      diff: diff([{ key: "amountUsd", label: "סכום ($)", before: "$555.50", after: "$700.00" }]),
    });
    assert.ok(meta);
    assert.equal(meta.financialLedger, true);
    assert.equal(meta.ledgerKind, ORDER_UPDATE_LEDGER_KIND);
  });

  it("payment method only — ledger event, no money delta", () => {
    const meta = buildOrderUpdateAuditMetadata({
      ...baseMeta,
      diff: diff([{ key: "paymentMethod", label: "אמצעי תשלום", before: "מזומן", after: "העברה" }]),
    });
    assert.ok(meta);
    assert.equal(meta.financialLedger, true);
    assert.equal((meta.changes as { deltaUsd: string | null }[])[0]?.deltaUsd, null);
  });

  it("rate change — ledger event", () => {
    const meta = buildOrderUpdateAuditMetadata({
      ...baseMeta,
      diff: diff([{ key: "usdRateUsed", label: "שער המרה", before: "3.00", after: "3.15" }]),
    });
    assert.ok(meta);
    assert.equal(meta.financialLedger, true);
  });

  it("notes + amount — one financial ledger payload", () => {
    const meta = buildOrderUpdateAuditMetadata({
      ...baseMeta,
      diff: diff([
        { key: "notes", label: "הערות", before: "א", after: "ב" },
        { key: "amountUsd", label: "סכום ($)", before: "$555.50", after: "$600.00" },
      ]),
    });
    assert.ok(meta);
    assert.equal(meta.financialLedger, true);
    assert.equal((meta.changes as unknown[]).length, 2);
  });

  it("empty diff — no audit write payload", () => {
    assert.equal(buildOrderUpdateAuditMetadata({ ...baseMeta, diff: [] }), null);
  });
});

describe("parseOrderUpdateLedgerDetail — backfill + display", () => {
  it("legacy notes-only ORDER_UPDATE is not a ledger event", () => {
    const detail = parseOrderUpdateLedgerDetail({
      ledgerKind: ORDER_UPDATE_LEDGER_KIND,
      orderNumber: "TR-134-0014",
      changes: [{ field: "notes", label: "הערות", before: "", after: "עם הסחורה" }],
    });
    assert.equal(detail, null);
  });

  it("legacy notes identified by Hebrew label only", () => {
    const detail = parseOrderUpdateLedgerDetail({
      ledgerKind: ORDER_UPDATE_LEDGER_KIND,
      orderNumber: "TR-134-0014",
      changes: [{ field: "הערות", label: "הערות", before: "x", after: "y" }],
    });
    assert.equal(detail, null);
  });

  it("explicit financialLedger false never appears", () => {
    const detail = parseOrderUpdateLedgerDetail({
      financialLedger: false,
      orderNumber: "TR-134-0014",
      changes: [{ field: "amountUsd", label: "סכום ($)", before: "$1", after: "$2" }],
    });
    assert.equal(detail, null);
  });

  it("amount change appears; notes stripped from ledger detail", () => {
    const detail = parseOrderUpdateLedgerDetail({
      ledgerKind: ORDER_UPDATE_LEDGER_KIND,
      financialLedger: true,
      orderNumber: "TR-134-0014",
      requestedBy: "עובד",
      approvedBy: "מנהל",
      changes: [
        { field: "notes", label: "הערות", before: "א", after: "ב" },
        { field: "amountUsd", label: "סכום ($)", before: "$555.50", after: "$600.00", deltaUsd: "+$ 44.50" },
      ],
    });
    assert.ok(detail);
    assert.deepEqual(detail.changes.map((c) => c.field), ["amountUsd"]);
  });

  it("payment method change appears with $0 balance impact", () => {
    const detail = parseOrderUpdateLedgerDetail({
      ledgerKind: ORDER_UPDATE_LEDGER_KIND,
      orderNumber: "TR-134-0014",
      changes: [{ field: "paymentMethod", label: "אמצעי תשלום", before: "מזומן", after: "העברה" }],
    });
    assert.ok(detail);
    assert.equal(detail.changes[0]?.deltaUsd, null);
  });
});
