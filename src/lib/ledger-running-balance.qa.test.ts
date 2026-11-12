import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayCustomerLedgerRunning } from "@/lib/ledger-running-replay";
import {
  bindSkippedBalanceResetReceipts,
  type RunningResetCandidate,
} from "@/lib/ledger-running-balance";

function day(iso: string): number {
  return new Date(iso).getTime();
}

function resetRow(iso: string, displayUsd: number): RunningResetCandidate {
  return {
    dateMs: day(iso),
    displayUsd,
    runningUsd: 0,
    affectsRunning: false,
    isBalanceReset: true,
  };
}

describe("ledger running balance fixtures", () => {
  it("clears Iman's $0.33 once and ends on the official signed balance", () => {
    const rows = [
      resetRow("2026-08-31T10:43:16.280Z", 0.33),
      resetRow("2026-09-02T13:37:44.862Z", 0.33),
      resetRow("2026-09-02T13:39:09.174Z", 0.33),
      resetRow("2026-09-03T12:58:20.569Z", 0.33),
    ];
    const bound = bindSkippedBalanceResetReceipts(rows, [
      { dateMs: day("2026-09-03T00:00:00.000Z"), amountUsd: 0.33 },
    ]);
    assert.deepEqual(bound.boundIndexes, [3]);
    assert.deepEqual(bound.unbound, []);
    assert.equal(rows[0].runningUsd, 0);
    assert.equal(rows[1].runningUsd, 0);
    assert.equal(rows[2].runningUsd, 0);
    assert.equal(rows[3].runningUsd, 0.33);

    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 8787 },
      { kind: "PAYMENT", amountUsd: 8786.67 },
      { kind: "SKIP", amountUsd: 0.33 },
      { kind: "SKIP", amountUsd: 0.33 },
      { kind: "SKIP", amountUsd: 0.33 },
      { kind: "PAYMENT", amountUsd: 0.33 },
      { kind: "CHARGE", amountUsd: 6565 },
      { kind: "PAYMENT", amountUsd: 6533.9 },
      { kind: "PAYMENT", amountUsd: 60 },
    ]);
    assert.equal(replay.balances.at(-1), -28.9);
  });

  it("keeps an open debt when payments do not cover the order", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 1000 },
      { kind: "PAYMENT", amountUsd: 400 },
    ]);
    assert.equal(replay.balances.at(-1), 600);
  });

  it("shows customer credit as a negative running balance", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 100 },
      { kind: "PAYMENT", amountUsd: 100 },
      { kind: "PAYMENT", amountUsd: 28.9 },
    ]);
    assert.equal(replay.balances.at(-1), -28.9);
  });

  it("does not apply a balance reset twice", () => {
    const rows = [
      {
        dateMs: day("2026-09-03T12:00:00.000Z"),
        displayUsd: 0.33,
        runningUsd: 0.33,
        affectsRunning: true,
        isBalanceReset: true,
      },
    ];
    const bound = bindSkippedBalanceResetReceipts(rows, [
      { dateMs: day("2026-09-03T00:00:00.000Z"), amountUsd: 0.33 },
    ]);
    assert.deepEqual(bound.unbound, []);
    assert.equal(rows[0].runningUsd, 0.33);
    assert.equal(bound.boundIndexes.length, 1);
  });

  it("ignores a cancelled payment in the running balance", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 50 },
      { kind: "SKIP", amountUsd: 50 },
      { kind: "PAYMENT", amountUsd: 20 },
    ]);
    assert.equal(replay.balances[1], 50);
    assert.equal(replay.balances.at(-1), 30);
  });

  it("places a backdated payment by its payment date, not its entry order", () => {
    const steps = [
      { date: "2026-10-10", kind: "CHARGE" as const, amountUsd: 100 },
      { date: "2026-09-03", kind: "PAYMENT" as const, amountUsd: 40 },
      { date: "2026-10-20", kind: "PAYMENT" as const, amountUsd: 10 },
    ].sort((a, b) => a.date.localeCompare(b.date));
    const replay = replayCustomerLedgerRunning(steps.map(({ kind, amountUsd }) => ({ kind, amountUsd })));
    assert.equal(replay.balances[0], -40);
    assert.equal(replay.balances[1], 60);
    assert.equal(replay.balances[2], 50);
  });

  it("accumulates payments from different weeks", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 300 },
      { kind: "PAYMENT", amountUsd: 100 },
      { kind: "PAYMENT", amountUsd: 80 },
      { kind: "PAYMENT", amountUsd: 20 },
    ]);
    assert.deepEqual(replay.balances, [300, 200, 120, 100]);
  });
});
