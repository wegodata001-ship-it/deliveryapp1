import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPaymentNavigationStore } from "@/lib/payment-navigation-store";

describe("PaymentNavigationStore", () => {
  const IDS = ["pay-a", "pay-b", "pay-c"];

  it("next/prev move index only", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 1 });
    const next = store.nextPayment();
    assert.equal(next?.paymentId, "pay-c");
    assert.equal(store.getState().currentIndex, 2);
    const prev = store.prevPayment();
    assert.equal(prev?.paymentId, "pay-b");
    assert.equal(store.getState().currentIndex, 1);
  });

  it("prev at start returns null without changing index", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 0 });
    assert.equal(store.prevPayment(), null);
    assert.equal(store.getState().currentIndex, 0);
  });

  it("next at end returns null", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 2 });
    assert.equal(store.nextPayment(), null);
    assert.equal(store.getState().currentIndex, 2);
  });

  it("after customer search simulation — index unchanged until explicit nav", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 1 });
    // שינויי מסך לא נוגעים ב-store
    assert.equal(store.getState().currentIndex, 1);
    assert.equal(store.currentPaymentId(), "pay-b");
    assert.ok(store.canGoPrev());
    assert.ok(store.canGoNext());
  });

  it("after refresh — setPaymentIds preserves index by current id", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 1 });
    store.setPaymentIds(["pay-x", "pay-b", "pay-y"]);
    assert.equal(store.getState().currentIndex, 1);
    assert.equal(store.currentPaymentId(), "pay-b");
  });

  it("after save — appendPaymentId does not reset index", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 1 });
    store.appendPaymentId("pay-d");
    assert.equal(store.getState().currentIndex, 1);
    assert.equal(store.getState().paymentIds.length, 4);
    assert.equal(store.currentPaymentId(), "pay-b");
  });

  it("after country change — syncPaymentId keeps position", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 2 });
    store.setPaymentIds(["pay-c", "pay-z"], { syncPaymentId: "pay-c" });
    assert.equal(store.getState().currentIndex, 0);
    assert.equal(store.currentPaymentId(), "pay-c");
  });

  it("peekNext from unset index targets first payment", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: -1 });
    assert.equal(store.peekNext()?.paymentId, "pay-a");
    assert.equal(store.getState().currentIndex, -1);
    const step = store.nextPayment();
    assert.equal(step?.paymentId, "pay-a");
    assert.equal(store.getState().currentIndex, 0);
  });

  it("loadPayment syncToPaymentId updates index only", () => {
    const store = createPaymentNavigationStore({ paymentIds: IDS, currentIndex: 0 });
    store.syncToPaymentId("pay-c");
    assert.equal(store.getState().currentIndex, 2);
    store.syncToPaymentId("missing");
    assert.equal(store.getState().currentIndex, 2);
  });
});
