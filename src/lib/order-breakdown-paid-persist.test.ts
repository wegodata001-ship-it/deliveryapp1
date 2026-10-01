import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADJUSTMENT_SAVE_FAILED_USER_MESSAGE,
  breakdownPersistKey,
  isPersistedBreakdownId,
  isPrismaMissingRecordError,
  resolveBreakdownPaidPersistTarget,
} from "@/lib/order-breakdown-paid-persist";

const existing = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    orderId: "ord-140",
    paymentMethod: "CASH",
    currency: "USD",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    orderId: "ord-140",
    paymentMethod: "BANK_TRANSFER",
    currency: "USD",
  },
];

describe("order-breakdown-paid-persist", () => {
  it("rejects synthetic auto-adjust ids and non-uuid client ids", () => {
    assert.equal(isPersistedBreakdownId("auto-adjust:ord-140:CASH:USD"), false);
    assert.equal(isPersistedBreakdownId("stale-client-id"), false);
    assert.equal(isPersistedBreakdownId(""), false);
    assert.equal(isPersistedBreakdownId(undefined), false);
    assert.equal(isPersistedBreakdownId("11111111-1111-4111-8111-111111111111"), true);
  });

  it("does not update a missing synthetic id — creates by authoritative key", () => {
    const used = new Set<string>();
    const target = resolveBreakdownPaidPersistTarget(
      [],
      {
        breakdownId: "auto-adjust:ord-140:CASH:USD",
        orderId: "ord-140",
        method: "CASH",
        currency: "USD",
        planned: 758.01,
        paid: 758.01,
        remaining: 0,
      },
      used,
    );
    assert.deepEqual(target, {
      action: "create",
      orderId: "ord-140",
      paymentMethod: "CASH",
      currency: "USD",
    });
  });

  it("updates the reloaded row by method+currency after adjustment rewrite", () => {
    const used = new Set<string>();
    const target = resolveBreakdownPaidPersistTarget(
      existing,
      {
        breakdownId: "auto-adjust:ord-140:CASH:USD",
        orderId: "ord-140",
        method: "CASH",
        currency: "USD",
        planned: 758.01,
        paid: 758.01,
        remaining: 0,
      },
      used,
    );
    assert.equal(target.action, "update");
    if (target.action === "update") {
      assert.equal(target.id, "11111111-1111-4111-8111-111111111111");
    }
  });

  it("ignores a stale real id that no longer exists and matches by key", () => {
    const used = new Set<string>();
    const target = resolveBreakdownPaidPersistTarget(
      existing,
      {
        breakdownId: "99999999-9999-4999-8999-999999999999",
        orderId: "ord-140",
        method: "BANK_TRANSFER",
        currency: "USD",
        planned: 41.99,
        paid: 41.99,
        remaining: 0,
      },
      used,
    );
    assert.equal(target.action, "update");
    if (target.action === "update") {
      assert.equal(target.id, "22222222-2222-4222-8222-222222222222");
    }
  });

  it("does not reuse the same existing row twice", () => {
    const used = new Set<string>();
    const first = resolveBreakdownPaidPersistTarget(
      existing,
      {
        breakdownId: undefined,
        orderId: "ord-140",
        method: "CASH",
        currency: "USD",
        planned: 500,
        paid: 500,
        remaining: 0,
      },
      used,
    );
    assert.equal(first.action, "update");
    if (first.action === "update") used.add(first.id);

    const second = resolveBreakdownPaidPersistTarget(
      existing,
      {
        breakdownId: undefined,
        orderId: "ord-140",
        method: "CASH",
        currency: "USD",
        planned: 258.01,
        paid: 258.01,
        remaining: 0,
      },
      used,
    );
    assert.deepEqual(second, {
      action: "create",
      orderId: "ord-140",
      paymentMethod: "CASH",
      currency: "USD",
    });
  });

  it("skips empty balances so duplicates are not created", () => {
    const target = resolveBreakdownPaidPersistTarget(
      [],
      {
        breakdownId: undefined,
        orderId: "ord-140",
        method: "CASH",
        currency: "USD",
        planned: 0,
        paid: 0,
        remaining: 0,
      },
      new Set(),
    );
    assert.equal(target.action, "skip");
  });

  it("maps Prisma record-not-found to the user-facing adjustment message", () => {
    assert.equal(isPrismaMissingRecordError({ code: "P2025" }), true);
    assert.equal(
      isPrismaMissingRecordError(new Error("An operation failed because it depends on one or more records that were required but not found. No record was found for an update.")),
      true,
    );
    assert.equal(isPrismaMissingRecordError(new Error("חסר לקוח")), false);
    assert.equal(ADJUSTMENT_SAVE_FAILED_USER_MESSAGE, "לא ניתן היה לשמור את ההתאמה. לא בוצעו שינויים.");
    assert.equal(breakdownPersistKey("o", "CASH", "usd"), "o::USD::CASH");
  });
});
