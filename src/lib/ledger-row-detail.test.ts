import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";
import { formatLedgerActorDisplay, isTechnicalLedgerId } from "@/lib/ledger-actor-display";
import { buildLedgerRowDetailView, hasLedgerRowDetail } from "@/lib/ledger-row-detail";

function row(partial: Partial<CustomerLedgerRow> & Pick<CustomerLedgerRow, "id">): CustomerLedgerRow {
  return {
    dateYmd: "2026-09-03",
    kind: "BALANCE_RESET",
    typeLabel: "איפוס יתרת זכות לעמלות",
    chargeUsd: "0.00",
    paymentUsd: "15.00",
    balanceUsd: "0.00",
    document: "איפוס יתרת זכות לעמלות",
    orderId: null,
    paymentId: null,
    isBalanceReset: true,
    ...partial,
  };
}

describe("ledger actor display", () => {
  it("hides UUID and maps a real name", () => {
    const id = "1195cfb5-1c99-4707-b249-1a164ec30d6e";
    assert.equal(isTechnicalLedgerId(id), true);
    assert.equal(formatLedgerActorDisplay(id), "מערכת");
    assert.equal(
      formatLedgerActorDisplay(id, new Map([[id, "System Admin"]])),
      "System Admin",
    );
    assert.equal(formatLedgerActorDisplay("System Admin"), "System Admin");
  });
});

describe("ledger row detail", () => {
  it("combines before/after and never lists raw source or ids", () => {
    const view = buildLedgerRowDetailView(
      row({
        balanceResetDetail: {
          amountBeforeUsd: "15.00",
          amountResetUsd: "15.00",
          amountAfterUsd: "0.00",
          performedBy: "1195cfb5-1c99-4707-b249-1a164ec30d6e",
          performedAt: "2026-09-03T10:00:00.000Z",
          source: "DIRECT_RESET",
          reason: null,
          resetKind: "CREDIT",
          creditPaymentIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
          orderIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
          openDebtBeforeUsd: "0.00",
          openDebtAfterUsd: "0.00",
          creditBeforeUsd: "15.00",
          creditAfterUsd: "0.00",
          commissionBeforeUsd: "23.00",
          commissionAfterUsd: "38.00",
        },
      }),
    );
    assert.equal(view.title, "איפוס יתרת זכות לעמלות");
    assert.deepEqual(
      view.fields.map((f) => f.label),
      ["סכום שאופס", "יתרת זכות", "יתרת עמלות", "בוצע על ידי", "תאריך", "סוג פעולה"],
    );
    assert.equal(view.fields.find((f) => f.label === "יתרת זכות")?.value, "$15.00 → $0.00");
    assert.equal(view.fields.find((f) => f.label === "יתרת עמלות")?.value, "$23.00 → $38.00");
    assert.equal(view.fields.find((f) => f.label === "בוצע על ידי")?.value, "מערכת");
    assert.equal(view.fields.find((f) => f.label === "סוג פעולה")?.value, "איפוס ידני");
    assert.ok(!view.fields.some((f) => f.value.includes("1195cfb5")));
    assert.ok(!view.fields.some((f) => f.label === "מקור"));
  });

  it("plain orders stay without a detail popup", () => {
    assert.equal(
      hasLedgerRowDetail(
        row({
          id: "o1",
          kind: "ORDER",
          typeLabel: "הזמנה",
          document: "TR-1",
          orderId: "ord-1",
          isBalanceReset: false,
        }),
      ),
      false,
    );
  });
});
