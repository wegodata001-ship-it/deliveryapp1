import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BALANCES_TIMEOUT_MESSAGE,
  isBalancesTimeoutError,
  toSafeBalancesListError,
  withTimeout,
} from "@/lib/balances-list-load";

describe("balances list load helpers", () => {
  it("maps Prisma pool/timeout codes to the user timeout message", () => {
    const err = Object.assign(new Error("Timed out fetching a new connection from the connection pool"), {
      code: "P2024",
    });
    assert.equal(toSafeBalancesListError(err).message, BALANCES_TIMEOUT_MESSAGE);
    assert.equal(isBalancesTimeoutError(err), true);
  });

  it("does not leak connection strings", () => {
    const err = toSafeBalancesListError(new Error("query failed postgresql://user:pass@host/db"));
    assert.equal(err.message, "טעינת היתרות נכשלה");
    assert.equal(err.message.includes("postgresql"), false);
  });

  it("withTimeout rejects hung work and leaves the original promise running", async () => {
    let finished = false;
    const hung = new Promise<string>((resolve) => {
      setTimeout(() => {
        finished = true;
        resolve("late");
      }, 40);
    });
    await assert.rejects(() => withTimeout(hung, 10), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, BALANCES_TIMEOUT_MESSAGE);
      return true;
    });
    assert.equal(finished, false);
    await hung;
    assert.equal(finished, true);
  });
});
