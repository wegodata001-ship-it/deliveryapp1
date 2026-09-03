import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanLivePaymentCancellationIntegrity } from "@/lib/payment-cancellation-integrity-scan";

describe("payment cancellation integrity scan", () => {
  it("finds zero active effects hanging off cancelled payments", async () => {
    const result = await scanLivePaymentCancellationIntegrity();
    assert.equal(
      result.anomalies.length,
      0,
      result.anomalies
        .slice(0, 8)
        .map((a) => `${a.kind} payment=${a.paymentCode ?? a.paymentId} child=${a.childId}`)
        .join(" | "),
    );
  });
});
