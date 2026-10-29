import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerCollectibleReconciliation,
  resolveBalanceResetShortfallCapUsd,
  resolveNetCollectibleUsd,
} from "@/lib/customer-collectible-reconciliation";
import { buildPaymentPreview } from "@/lib/payment-intake-preview";

describe("customer-collectible-reconciliation", () => {
  it("customer 101 AH-145: CURRENT 601 caps week 2384.83", () => {
    const net = resolveNetCollectibleUsd({
      currentOpenDebtUsd: 601,
      weekScopedOrderRemainingUsd: 2384.83,
      ssotLoaded: true,
      hasEligibleOrderSet: true,
    });
    assert.equal(net, 601);
    const rec = buildCustomerCollectibleReconciliation({
      currentOpenDebtUsd: 601,
      currentAvailableCreditUsd: 0,
      weekScopedOrderRemainingUsd: 2384.83,
      plannedOpenRemainingUsd: 2384.83,
      grossCreditUsd: 2793.83,
    });
    assert.equal(rec.planningAdjustmentGapUsd, 1783.83);
    assert.equal(rec.weekVsNetCollectibleGapUsd, 1783.83);
  });

  it("preview uses same net collectible when CURRENT below week sum", () => {
    const p = buildPaymentPreview({
      financialState: {
        openDebtUsd: 601,
        availableCreditUsd: 0,
        commissionBalanceUsd: 0,
      },
      draftPaymentUsd: 0,
      selectedOrdersRemainingUsd: 2384.83,
    });
    assert.equal(p.debtBefore, 601);
    assert.equal(p.selectedOrdersRemaining, 2384.83);
  });

  it("week due below CURRENT uses week amount", () => {
    assert.equal(
      resolveNetCollectibleUsd({
        currentOpenDebtUsd: 601,
        weekScopedOrderRemainingUsd: 500,
        ssotLoaded: true,
        hasEligibleOrderSet: true,
      }),
      500,
    );
  });

  it("customer 101: reset cap after $76.67 draft on $601 net", () => {
    const cap = resolveBalanceResetShortfallCapUsd({
      netCollectibleBeforeUsd: 601,
      draftPaymentAppliedToDebtUsd: 76.67,
      pendingCreditApplyUsd: 0,
    });
    assert.equal(cap, 524.33);
  });

  it("zero week remaining with eligible set → 0 collectible", () => {
    assert.equal(
      resolveNetCollectibleUsd({
        currentOpenDebtUsd: 758.01,
        weekScopedOrderRemainingUsd: 0,
        ssotLoaded: true,
        hasEligibleOrderSet: true,
      }),
      0,
    );
  });
});
