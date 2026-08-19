/**
 * QA — צפוי ספירת מנהל מקליטת תשלום בפועל
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagerCountExpectedLines,
  expectedAmountsFromIntake,
  initializeManagerCountFormFields,
  managerCountLineStatus,
  type ManagerCountPaymentSource,
} from "@/lib/flow-control/services/manager-count-expected-service";
import { emptyDailyIntake } from "@/lib/cash-control-daily";

function pay(
  partial: Partial<ManagerCountPaymentSource> & Pick<ManagerCountPaymentSource, "id">,
): ManagerCountPaymentSource {
  return {
    amountIls: null,
    amountUsd: null,
    paymentMethod: null,
    usdPaymentMethod: null,
    ilsPaymentMethod: null,
    ...partial,
  };
}

describe("Manager count expected — payment intake SSOT", () => {
  it("TEST 1 — ₪1,000 מזומן PS", () => {
    const lines = buildManagerCountExpectedLines([
      pay({
        id: "p1",
        amountIls: "1000",
        ilsPaymentMethod: "CASH",
        exchangeRate: "3.75",
      }),
    ]);
    const cashIls = lines.find((l) => l.lineId === "CASH_ILS");
    assert.equal(cashIls?.expectedAmount, 1000);
  });

  it("TEST 2 — $500 מזומן PS", () => {
    const lines = buildManagerCountExpectedLines([
      pay({
        id: "p2",
        amountUsd: "500",
        usdPaymentMethod: "CASH",
      }),
    ]);
    assert.equal(lines.find((l) => l.lineId === "CASH_USD")?.expectedAmount, 500);
  });

  it("TEST 3 — ₪2,000 אשראי IL", () => {
    const lines = buildManagerCountExpectedLines([
      pay({
        id: "p3",
        amountIls: "2000",
        ilsPaymentMethod: "CREDIT",
      }),
    ]);
    assert.equal(lines.find((l) => l.lineId === "CREDIT")?.expectedAmount, 2000);
  });

  it("TEST 4 — difference short", () => {
    const st = managerCountLineStatus(2000, 1900, "ILS");
    assert.equal(st.kind, "short");
    assert.equal(st.diff, -100);
  });

  it("uses methodAllocations — actual captured method not planned", () => {
    const lines = buildManagerCountExpectedLines([
      pay({
        id: "p4",
        amountIls: "5000",
        paymentMethod: "CASH",
        methodAllocations: [
          { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: "5000" },
        ],
      }),
    ]);
    assert.equal(lines.find((l) => l.lineId === "BANK_TRANSFER")?.expectedAmount, 5000);
    assert.equal(lines.find((l) => l.lineId === "CASH_ILS")?.expectedAmount, 0);
  });

  it("prefill form when no saved manager count", () => {
    const intake = emptyDailyIntake();
    intake.CASH_ILS = 4500;
    intake.CASH_USD = 1200;
    const expected = expectedAmountsFromIntake(intake);
    const patch = initializeManagerCountFormFields({}, expected);
    assert.equal(patch.countedCashIls, "4500.00");
    assert.equal(patch.countedCashUsd, "1200.00");
  });
});
