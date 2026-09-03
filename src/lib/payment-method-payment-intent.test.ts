import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocatePaymentIntentsAgainstDebt,
  intentsFromDraftPaymentLines,
  planPaymentIntentAdjustments,
  resultingCustomerCreditUsd,
  resultingCustomerFeeUsd,
} from "@/lib/payment-method-payment-intent";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import { classifyCustomerAccountStatus } from "@/lib/customer-account-balances-shared";
import { formatLedgerRunningBalance } from "@/lib/customer-ledger-export";
import { aggregateCapturedPaymentsByMethodCurrency } from "@/lib/payment-method-captured-balances";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

function order(partial: {
  id: string;
  orderNumber: string;
  dateYmd: string;
  remainingUsd: number;
  method?: string;
}): PaymentIntakeOrderRow {
  const rem = partial.remainingUsd;
  return {
    id: partial.id,
    orderNumber: partial.orderNumber,
    dateYmd: partial.dateYmd,
    amountUsd: String(rem),
    commissionUsd: "0",
    totalAmountUsd: String(rem),
    dbPaidUsd: "0",
    dbRemainingUsd: String(rem),
    paymentMethod: partial.method ?? "CASH",
    rate: "3",
    breakdown: [
      {
        method: partial.method ?? "CASH",
        label: "מזומן",
        currency: "USD",
        planned: rem,
        plannedUsd: rem,
        paid: 0,
        paidUsd: 0,
        remaining: rem,
        remainingUsd: rem,
      },
    ],
  } as unknown as PaymentIntakeOrderRow;
}

describe("planPaymentIntentAdjustments", () => {
  it("FIFO מזומן→העברה לפי תשלום ILS מנורמל", () => {
    const orders = [
      order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: 2000 }),
      order({ id: "b", orderNumber: "TR-2", dateYmd: "2026-08-02", remainingUsd: 3000 }),
      order({ id: "c", orderNumber: "TR-3", dateYmd: "2026-08-03", remainingUsd: 4000 }),
    ];
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [{ method: "BANK_TRANSFER", currency: "ILS", amountNative: 20000 }],
      exchangeRate: 3,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.totalPayUsd, 5649.72);
    assert.equal(plan.intents[0]!.grossIls, 20000);
    assert.equal(plan.intents[0]!.vatIls, 3050.85);
    assert.equal(plan.intents[0]!.netIls, 16949.15);
    assert.equal(plan.moves.length, 1);
    assert.equal(plan.moves[0]!.fromMethod, "CASH");
    assert.equal(plan.moves[0]!.toMethod, "BANK_TRANSFER");
    assert.equal(plan.moves[0]!.amountUsd, 5649.72);
    assert.equal(plan.orderChanges.length, 3);
    assert.equal(plan.orderChanges[0]!.moveUsd, 2000);
    assert.equal(plan.orderChanges[1]!.moveUsd, 3000);
    assert.equal(plan.orderChanges[2]!.moveUsd, 649.72);
    assert.equal(plan.orderChanges[2]!.partial, true);
  });

  it("תשלום מורכב — רק החלק שלא תואם דורש התאמה", () => {
    const orders = [
      order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: 2000 }),
      order({ id: "b", orderNumber: "TR-2", dateYmd: "2026-08-02", remainingUsd: 3000 }),
      order({ id: "c", orderNumber: "TR-3", dateYmd: "2026-08-03", remainingUsd: 4000 }),
    ];
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [
        { method: "CASH", currency: "USD", amountNative: 2000 },
        { method: "BANK_TRANSFER", currency: "ILS", amountNative: 9000 },
      ],
      exchangeRate: 3,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.totalPayUsd, 4542.37);
    assert.equal(plan.moves[0]!.amountUsd, 2542.37);
    assert.equal(plan.moves[0]!.toMethod, "BANK_TRANSFER");
  });

  it("מאפשר תשלום מעל החוב — שומר אמצעי במלואם ומחשב יתרת זכות", () => {
    const orders = [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: 100 })];
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [{ method: "CASH", currency: "USD", amountNative: 500 }],
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.hasOverpayment, true);
    assert.equal(plan.closesDebtUsd, 100);
    assert.equal(plan.overpaymentUsd, 400);
    assert.equal(plan.intents[0]!.amountNative, 500);
    assert.equal(plan.intents[0]!.method, "CASH");
  });
});

const DEBT = 2726.17;

describe("תשלום מעל/מתחת/שווה לחוב — allocation + credit SSOT", () => {
  it("Test A: תשלום = חוב → חוב $0 זכות $0", () => {
    const split = computePaymentOverpayment(DEBT, DEBT);
    assert.equal(split.hasOverpayment, false);
    assert.equal(split.closesDebtUsd, DEBT);
    assert.equal(split.overpaymentUsd, 0);
    assert.equal(Math.max(0, split.openDebtUsd - split.incomingPaymentUsd), 0);
    const plan = planPaymentIntentAdjustments({
      orders: [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: DEBT })],
      intents: [{ method: "BANK_TRANSFER", currency: "USD", amountNative: DEBT }],
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.closesDebtUsd, DEBT);
    assert.equal(plan.overpaymentUsd, 0);
    assert.equal(plan.hasOverpayment, false);
    assert.equal(plan.intents[0]!.amountNative, DEBT);
  });

  it("Test B: תשלום < חוב → נשאר חוב נכון", () => {
    const pay = 2000;
    const split = computePaymentOverpayment(DEBT, pay);
    assert.equal(split.hasOverpayment, false);
    assert.equal(split.closesDebtUsd, pay);
    assert.equal(split.overpaymentUsd, 0);
    assert.equal(Math.max(0, Number((DEBT - pay).toFixed(2))), 726.17);
    const plan = planPaymentIntentAdjustments({
      orders: [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: DEBT })],
      intents: [{ method: "BANK_TRANSFER", currency: "USD", amountNative: pay }],
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.closesDebtUsd, pay);
    assert.equal(plan.overpaymentUsd, 0);
    assert.equal(Number((plan.openDebtUsd - plan.totalPayUsd).toFixed(2)), 726.17);
    assert.equal(plan.intents[0]!.amountNative, pay);
  });

  it("Test C: תשלום > חוב → חוב $0 ויתרת זכות נכונה", () => {
    const pay = 3000;
    const split = computePaymentOverpayment(DEBT, pay);
    assert.equal(split.hasOverpayment, true);
    assert.equal(split.closesDebtUsd, DEBT);
    assert.equal(split.overpaymentUsd, 273.83);
    assert.equal(Math.max(0, split.openDebtUsd - split.incomingPaymentUsd), 0);
    const plan = planPaymentIntentAdjustments({
      orders: [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: DEBT })],
      intents: [{ method: "CASH", currency: "USD", amountNative: pay }],
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.hasOverpayment, true);
    assert.equal(plan.closesDebtUsd, DEBT);
    assert.equal(plan.overpaymentUsd, 273.83);
    assert.equal(plan.intents[0]!.amountNative, 3000);
  });

  it("Test D: 5,000 ₪ מזומן + 6,000 ₪ העברה נשמרים במלואם — אין חסימה", () => {
    const plan = planPaymentIntentAdjustments({
      orders: [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: DEBT })],
      intents: [
        { method: "CASH", currency: "ILS", amountNative: 5000 },
        { method: "BANK_TRANSFER", currency: "ILS", amountNative: 6000 },
      ],
      exchangeRate: 3,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const cash = plan.intents.find((i) => i.method === "CASH");
    const bank = plan.intents.find((i) => i.method === "BANK_TRANSFER");
    assert.ok(cash);
    assert.ok(bank);
    assert.equal(cash.amountNative, 5000);
    assert.equal(bank.amountNative, 6000);
    assert.equal(cash.grossIls, 5000);
    assert.equal(bank.grossIls, 6000);
    assert.equal(cash.amountUsd, 1412.43);
    assert.equal(bank.amountUsd, 1694.92);
    assert.equal(plan.totalPayUsd, 3107.35);
    assert.equal(plan.hasOverpayment, true);
    assert.equal(plan.closesDebtUsd, DEBT);
    assert.equal(plan.overpaymentUsd, 381.18);
    assert.notEqual(cash.amountNative, bank.amountNative);
  });

  it("Test E: עודף חדש מתווסף ליתרת זכות קיימת", () => {
    const split = computePaymentOverpayment(DEBT, 3000);
    assert.equal(split.overpaymentUsd, 273.83);
    assert.equal(resultingCustomerCreditUsd(100, split.overpaymentUsd), 373.83);
    assert.equal(resultingCustomerCreditUsd(0, split.overpaymentUsd), 273.83);
  });

  it("Test F: כרטסת — חוב $0, זכות חיובית, לא חוב שלילי", () => {
    const split = computePaymentOverpayment(DEBT, 3000);
    const openDebtUsd = Math.max(0, split.openDebtUsd - split.incomingPaymentUsd);
    const creditUsd = split.overpaymentUsd;
    assert.equal(openDebtUsd, 0);
    assert.equal(creditUsd, 273.83);
    const headerSigned = openDebtUsd - creditUsd;
    assert.equal(headerSigned, -273.83);
    const shown = formatLedgerRunningBalance(String(headerSigned));
    assert.match(shown, /^\(\$\s?273\.83\)$/);
    assert.doesNotMatch(shown, /חוב/);
    assert.ok(!shown.includes("-273.83"));
    assert.notEqual(openDebtUsd, -273.83);
  });

  it("Test G: מסך יתרות — חוב $0, הזכות אינה חוב", () => {
    const split = computePaymentOverpayment(DEBT, 3000);
    const balances = {
      openDebtUsd: Math.max(0, split.openDebtUsd - split.incomingPaymentUsd),
      availableCreditUsd: split.overpaymentUsd,
    };
    assert.equal(balances.openDebtUsd, 0);
    assert.equal(balances.availableCreditUsd, 273.83);
    assert.equal(classifyCustomerAccountStatus(balances), "credit");
    assert.notEqual(classifyCustomerAccountStatus(balances), "debt");
  });

  it("Test H: בקרת קופה מציגה את מלוא המזומן/העברה שהתקבלו", () => {
    const plan = planPaymentIntentAdjustments({
      orders: [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: DEBT })],
      intents: [
        { method: "CASH", currency: "ILS", amountNative: 5000 },
        { method: "BANK_TRANSFER", currency: "ILS", amountNative: 6000 },
      ],
      exchangeRate: 3,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const captured = aggregateCapturedPaymentsByMethodCurrency(
      plan.intents.map((intent) => ({
        amountUsd: intent.currency === "USD" ? String(intent.amountNative) : null,
        amountIls: intent.currency === "ILS" ? String(intent.amountNative) : null,
        exchangeRate: "3",
        paymentMethod: intent.method,
        usdPaymentMethod: intent.currency === "USD" ? intent.method : null,
        ilsPaymentMethod: intent.currency === "ILS" ? intent.method : null,
      })),
    );
    assert.equal(captured.find((r) => r.methodKey === "CASH" && r.currency === "ILS")?.amount, 5000);
    assert.equal(
      captured.find((r) => r.methodKey === "BANK_TRANSFER" && r.currency === "ILS")?.amount,
      6000,
    );
  });
});

describe("התאמה אוטומטית — תשלום יתר / allocation / יעד עודף", () => {
  it("TEST 1 — exact: תשלום = חוב → אין עודף", () => {
    const split = computePaymentOverpayment(1000, 1000);
    assert.equal(split.hasOverpayment, false);
    assert.equal(split.closesDebtUsd, 1000);
    assert.equal(split.overpaymentUsd, 0);
    const rows = allocatePaymentIntentsAgainstDebt(
      [
        {
          method: "CASH",
          currency: "USD",
          amountNative: 1000,
          amountUsd: 1000,
          grossIls: null,
          vatIls: 0,
          netIls: null,
        },
      ],
      1000,
    );
    assert.equal(rows[0]!.appliedUsd, 1000);
    assert.equal(rows[0]!.excessUsd, 0);
  });

  it("TEST 2 — partial: תשלום < חוב → חוב נשאר, אין עודף", () => {
    const split = computePaymentOverpayment(1000, 600);
    assert.equal(split.hasOverpayment, false);
    assert.equal(split.closesDebtUsd, 600);
    assert.equal(split.overpaymentUsd, 0);
    assert.equal(roundRemain(1000, 600), 400);
    const rows = allocatePaymentIntentsAgainstDebt(
      [
        {
          method: "BANK_TRANSFER",
          currency: "USD",
          amountNative: 600,
          amountUsd: 600,
          grossIls: null,
          vatIls: 0,
          netIls: null,
        },
      ],
      1000,
    );
    assert.equal(rows[0]!.appliedUsd, 600);
    assert.equal(rows[0]!.excessUsd, 0);
  });

  it("TEST 3 — excess → Credit: התשלום נשאר מלא והעודף מתווסף לזכות", () => {
    const split = computePaymentOverpayment(1000, 1200);
    assert.equal(split.hasOverpayment, true);
    assert.equal(split.closesDebtUsd, 1000);
    assert.equal(split.overpaymentUsd, 200);
    assert.equal(resultingCustomerCreditUsd(0, 200), 200);
    assert.equal(roundRemain(1000, 1200), 0);
  });

  it("TEST 4 — excess → Fees: התשלום נשאר מלא והעודף מתווסף לעמלות", () => {
    const split = computePaymentOverpayment(1000, 1200);
    assert.equal(split.overpaymentUsd, 200);
    assert.equal(resultingCustomerFeeUsd(0, 200), 200);
    assert.equal(resultingCustomerFeeUsd(75, 200), 275);
  });

  it("TEST 5 — existing credit אינו נסגר אוטומטית על החוב (אין double application)", () => {
    const existingCredit = 50;
    const split = computePaymentOverpayment(1000, 1200);
    assert.equal(split.closesDebtUsd, 1000);
    assert.equal(split.overpaymentUsd, 200);
    assert.equal(resultingCustomerCreditUsd(existingCredit, split.overpaymentUsd), 250);
    assert.notEqual(split.closesDebtUsd, 950);
  });

  it("TEST 6 — multi-method: מזומן נסגר קודם, העודף מההעברה", () => {
    const rows = allocatePaymentIntentsAgainstDebt(
      [
        {
          method: "BANK_TRANSFER",
          currency: "USD",
          amountNative: 4000,
          amountUsd: 4000,
          grossIls: null,
          vatIls: 0,
          netIls: null,
        },
        {
          method: "CASH",
          currency: "USD",
          amountNative: 2000,
          amountUsd: 2000,
          grossIls: null,
          vatIls: 0,
          netIls: null,
        },
      ],
      5000,
    );
    const cash = rows.find((row) => row.method === "CASH");
    const bank = rows.find((row) => row.method === "BANK_TRANSFER");
    assert.ok(cash);
    assert.ok(bank);
    assert.equal(cash.appliedUsd, 2000);
    assert.equal(cash.excessUsd, 0);
    assert.equal(bank.appliedUsd, 3000);
    assert.equal(bank.excessUsd, 1000);
    assert.equal(
      rows.reduce((sum, row) => sum + row.excessUsd, 0),
      1000,
    );
  });

  it("TEST 6b — עודף מורכב מכמה אמצעים נשמר בפירוט", () => {
    const rows = allocatePaymentIntentsAgainstDebt(
      [
        {
          method: "CASH",
          currency: "USD",
          amountNative: 800,
          amountUsd: 800,
          grossIls: null,
          vatIls: 0,
          netIls: null,
        },
        {
          method: "BANK_TRANSFER",
          currency: "USD",
          amountNative: 900,
          amountUsd: 900,
          grossIls: null,
          vatIls: 0,
          netIls: null,
        },
      ],
      700,
    );
    const cash = rows.find((row) => row.method === "CASH");
    const bank = rows.find((row) => row.method === "BANK_TRANSFER");
    assert.equal(cash?.appliedUsd, 700);
    assert.equal(cash?.excessUsd, 100);
    assert.equal(bank?.appliedUsd, 0);
    assert.equal(bank?.excessUsd, 900);
  });

  it("חוב אחרי תשלום יתר אינו שלילי", () => {
    const split = computePaymentOverpayment(5762.9, 7300);
    assert.equal(split.closesDebtUsd, 5762.9);
    assert.equal(split.overpaymentUsd, 1537.1);
    assert.equal(Math.max(0, split.openDebtUsd - split.incomingPaymentUsd), 0);
    assert.ok(split.openDebtUsd >= 0);
  });
});

function roundRemain(debt: number, pay: number): number {
  return Math.max(0, Number((debt - pay).toFixed(2)));
}

describe("intentsFromDraftPaymentLines", () => {
  it("מאגד טיוטת תשלום דו-מטבעית", () => {
    const intents = intentsFromDraftPaymentLines([
      {
        usdAmount: 2000,
        ilsAmount: 9000,
        usdPaymentMethod: "CASH",
        ilsPaymentMethod: "BANK_TRANSFER",
      },
    ]);
    assert.equal(intents.length, 2);
    assert.ok(intents.some((i) => i.method === "CASH" && i.currency === "USD" && i.amountNative === 2000));
    assert.ok(
      intents.some((i) => i.method === "BANK_TRANSFER" && i.currency === "ILS" && i.amountNative === 9000),
    );
  });
});
