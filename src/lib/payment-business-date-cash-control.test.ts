import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentDayKeyJerusalem, getDailyPaymentContributions } from "@/lib/cash-control-daily";
import { CASH_RECEIPT_TABLE_COLUMNS } from "@/lib/cash-control-channel";
import { CASH_WEEK_FLOW_LINES } from "@/lib/cash-control-week-flow";
import {
  getPaymentReconciliationContributions,
  CASH_RECONCILIATION_LINES,
} from "@/lib/cash-control-reconciliation";
import { resolvePaymentIntakeAccountingPeriod } from "@/lib/payment-intake-accounting-period";
import { defaultPaymentIntakeDateYmd } from "@/lib/payment-intake-default-week";
import { getAhWeekRange, getBusinessWeekClosingDate, parseLocalDate } from "@/lib/work-week";

describe("AH-134 week calendar SSOT", () => {
  it("Sunday 2026-08-02 … Saturday 2026-08-08", () => {
    const range = getAhWeekRange("AH-134");
    assert.ok(range);
    assert.equal(range.from, "2026-08-02");
    assert.equal(range.to, "2026-08-08");
    assert.equal(getBusinessWeekClosingDate("AH-134"), "2026-08-08");
  });
});

describe("resolvePaymentIntakeAccountingPeriod", () => {
  it("AH-135 → AH-134 → 2026-08-08", () => {
    assert.deepEqual(resolvePaymentIntakeAccountingPeriod("AH-135"), {
      intakeWeek: "AH-135",
      financialWeek: "AH-134",
      businessDate: "2026-08-08",
    });
  });

  it("AH-136 → AH-135 → 2026-08-15", () => {
    assert.deepEqual(resolvePaymentIntakeAccountingPeriod("AH-136"), {
      intakeWeek: "AH-136",
      financialWeek: "AH-135",
      businessDate: "2026-08-15",
    });
  });

  it("AH-137 → AH-136 → 2026-08-22", () => {
    assert.deepEqual(resolvePaymentIntakeAccountingPeriod("AH-137"), {
      intakeWeek: "AH-137",
      financialWeek: "AH-136",
      businessDate: "2026-08-22",
    });
  });
});

describe("Cash Control groups by payment business date, not createdAt", () => {
  it("AH-135 intake captured on 2026-09-06 appears under 2026-08-08 / AH-134", () => {
    const intake = parseLocalDate(defaultPaymentIntakeDateYmd("AH-135"));
    const createdAt = parseLocalDate("2026-09-06");
    const key = paymentDayKeyJerusalem({
      intakeDate: intake,
      paymentDate: intake,
      createdAt,
    });
    assert.equal(key, "2026-08-08");
    assert.notEqual(key, "2026-09-06");
    assert.notEqual(key, "2026-08-15");
  });

  it("does not fall back to createdAt when intakeDate is the week Saturday", () => {
    const key = paymentDayKeyJerusalem({
      intakeDate: parseLocalDate("2026-08-08"),
      paymentDate: parseLocalDate("2026-08-08"),
      createdAt: new Date("2026-09-06T14:52:00+03:00"),
    });
    assert.equal(key, "2026-08-08");
  });
});

describe("USD bank transfer stays on BANK_TRANSFER_USD", () => {
  it("visible as its own receipt column and week-flow line", () => {
    assert.ok(CASH_RECEIPT_TABLE_COLUMNS.includes("BANK_TRANSFER_USD"));
    assert.ok(CASH_WEEK_FLOW_LINES.some((l) => l.id === "BANK_TRANSFER_USD"));
    assert.ok(CASH_RECONCILIATION_LINES.some((l) => l.id === "BANK_TRANSFER_USD"));
  });

  it("$500 BANK_TRANSFER USD → BANK_TRANSFER_USD, not ILS", () => {
    const payment = {
      amountIls: null,
      amountUsd: { toString: () => "500" },
      paymentMethod: "BANK_TRANSFER",
      usdPaymentMethod: "BANK_TRANSFER",
      ilsPaymentMethod: null,
    };
    const daily = getDailyPaymentContributions(payment);
    assert.deepEqual(daily, [{ column: "BANK_TRANSFER_USD", amount: 500 }]);

    const recon = getPaymentReconciliationContributions(payment);
    assert.deepEqual(recon, [{ lineId: "BANK_TRANSFER_USD", amount: 500 }]);
    assert.equal(
      recon.reduce((s, c) => s + (c.lineId === "BANK_TRANSFER" ? c.amount : 0), 0),
      0,
    );
  });

  it("ILS ₪5,000 bank transfer stays ILS and is not mixed with USD", () => {
    const payment = {
      amountIls: { toString: () => "5000" },
      amountUsd: null,
      paymentMethod: "BANK_TRANSFER",
      usdPaymentMethod: null,
      ilsPaymentMethod: "BANK_TRANSFER",
    };
    const daily = getDailyPaymentContributions(payment);
    assert.deepEqual(daily, [{ column: "BANK_TRANSFER_ILS", amount: 5000 }]);
    const recon = getPaymentReconciliationContributions(payment);
    assert.deepEqual(recon, [{ lineId: "BANK_TRANSFER", amount: 5000 }]);
  });
});

describe("split payment same business week/date", () => {
  it("$300 cash + $500 USD transfer both map under their method, same Saturday", () => {
    const businessYmd = defaultPaymentIntakeDateYmd("AH-135");
    assert.equal(businessYmd, "2026-08-08");

    const cash = getDailyPaymentContributions({
      amountIls: null,
      amountUsd: { toString: () => "300" },
      paymentMethod: "CASH",
      usdPaymentMethod: "CASH",
      ilsPaymentMethod: null,
    });
    const transfer = getDailyPaymentContributions({
      amountIls: null,
      amountUsd: { toString: () => "500" },
      paymentMethod: "BANK_TRANSFER",
      usdPaymentMethod: "BANK_TRANSFER",
      ilsPaymentMethod: null,
    });
    assert.deepEqual(cash, [{ column: "CASH_USD", amount: 300 }]);
    assert.deepEqual(transfer, [{ column: "BANK_TRANSFER_USD", amount: 500 }]);

    const day = paymentDayKeyJerusalem({
      intakeDate: parseLocalDate(businessYmd),
      paymentDate: parseLocalDate(businessYmd),
      createdAt: parseLocalDate("2026-09-06"),
    });
    assert.equal(day, "2026-08-08");
  });
});
