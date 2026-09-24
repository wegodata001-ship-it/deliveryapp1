/**
 * QA — כרטסת שנפתחת מיתרות יורשת את cutoff של מסך האב.
 * לא משנה את מנוע החישוב; בודק scope + הצגת תשלום עתידי לפי paymentDate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import {
  balancesCardOpenProps,
  balancesCumulativeCutoffCaption,
  customerCardBalancesCutoffCaption,
} from "@/lib/balances-week-filter";
import { balancesSnapshotToYmd, formatLocalYmd, prevWeekCode } from "@/lib/work-week";

const FUTURE_PAYMENT_CODE = "TR-P-000025";
const AH141_CUTOFF_YMD = "2026-09-19";
const SOURCE_COUNTRY = "TURKEY";

function ledgerHasDoc(ledger: { rows: { document: string }[] }, code: string): boolean {
  return ledger.rows.some((r) => r.document.trim() === code || r.document.includes(code));
}

async function customerByCode(code: string) {
  return prisma.customer.findFirst({
    where: { customerCode: code, deletedAt: null },
    select: { id: true, customerCode: true },
  });
}

describe("customer card inherits balances week cutoff", () => {
  it("AH-141 parent and card default share 19/09/2026", () => {
    const selectedWeekCode = "AH-141";
    const cutoffYmd = balancesSnapshotToYmd(selectedWeekCode);
    const cutoffWeekCode = prevWeekCode(selectedWeekCode);
    assert.equal(cutoffYmd, AH141_CUTOFF_YMD);
    assert.equal(cutoffWeekCode, "AH-140");

    const props = balancesCardOpenProps({
      weekCode: selectedWeekCode,
      snapshotToYmd: cutoffYmd,
      sourceCountry: SOURCE_COUNTRY,
    });
    assert.equal(props.ledgerToYmd, cutoffYmd);
    assert.equal(props.ledgerFromYmd, null);
    assert.equal(props.ledgerSelectedWeekCode, selectedWeekCode);
    assert.equal(props.ledgerCutoffWeekCode, cutoffWeekCode);
    assert.equal(
      balancesCumulativeCutoffCaption({ selectedWeekCode, cutoffWeekCode, cutoffYmd }),
      "יתרות מצטברות עד סוף AH-140 · 19/09/2026",
    );
    assert.equal(
      customerCardBalancesCutoffCaption({ selectedWeekCode, cutoffYmd }),
      "כרטסת עד 19/09/2026 — לפי שבוע עבודה AH-141",
    );
  });

  it("customer 101 AH-141 card vs full card", async () => {
    const customer = await customerByCode("101");
    if (!customer) {
      console.warn("skip: customer 101 not in this database");
      return;
    }

    const [scoped, full] = await Promise.all([
      buildCustomerAccountLedger({
        customerId: customer.id,
        toYmd: AH141_CUTOFF_YMD,
        sourceCountry: SOURCE_COUNTRY,
      }),
      buildCustomerAccountLedger({
        customerId: customer.id,
        sourceCountry: SOURCE_COUNTRY,
      }),
    ]);

    assert.equal(Number(scoped.totalChargesUsd), 17927.5);
    assert.equal(Number(scoped.totalPaymentsUsd), 11059.5);
    assert.equal(Number(scoped.openDebtUsd), 6868);
    assert.equal(ledgerHasDoc(scoped, FUTURE_PAYMENT_CODE), false);

    assert.equal(Number(full.totalChargesUsd), 17927.5);
    assert.equal(Number(full.totalPaymentsUsd), 15895.66);
    assert.equal(Number(full.openDebtUsd), 2031.84);
    assert.equal(ledgerHasDoc(full, FUTURE_PAYMENT_CODE), true);
  });

  it("TR-P-000025 is excluded until its paymentDate, not createdAt", async () => {
    const customer = await customerByCode("101");
    if (!customer) {
      console.warn("skip: customer 101 not in this database");
      return;
    }

    const payment = await prisma.payment.findFirst({
      where: { paymentCode: FUTURE_PAYMENT_CODE, customerId: customer.id },
      select: { paymentDate: true, createdAt: true, amountUsd: true },
    });
    if (!payment) {
      console.warn("skip: TR-P-000025 not in this database");
      return;
    }

    const paymentYmd = payment.paymentDate ? formatLocalYmd(payment.paymentDate) : "";
    assert.equal(paymentYmd, "2026-09-26");
    assert.equal(Number(payment.amountUsd), 4836.16);

    const [beforeCreatedDay, onCreatedDay, onPaymentDay] = await Promise.all([
      buildCustomerAccountLedger({
        customerId: customer.id,
        toYmd: AH141_CUTOFF_YMD,
        sourceCountry: SOURCE_COUNTRY,
      }),
      buildCustomerAccountLedger({
        customerId: customer.id,
        toYmd: "2026-09-24",
        sourceCountry: SOURCE_COUNTRY,
      }),
      buildCustomerAccountLedger({
        customerId: customer.id,
        toYmd: "2026-09-26",
        sourceCountry: SOURCE_COUNTRY,
      }),
    ]);

    assert.equal(ledgerHasDoc(beforeCreatedDay, FUTURE_PAYMENT_CODE), false);
    assert.equal(ledgerHasDoc(onCreatedDay, FUTURE_PAYMENT_CODE), false);
    assert.equal(ledgerHasDoc(onPaymentDay, FUTURE_PAYMENT_CODE), true);
  });

  it("customers 100 and 107 scoped vs full do not regress", async () => {
    for (const code of ["100", "107"] as const) {
      const customer = await customerByCode(code);
      if (!customer) {
        console.warn(`skip: customer ${code} not in this database`);
        continue;
      }

      const [scoped, full] = await Promise.all([
        buildCustomerAccountLedger({
          customerId: customer.id,
          toYmd: AH141_CUTOFF_YMD,
          sourceCountry: SOURCE_COUNTRY,
        }),
        buildCustomerAccountLedger({
          customerId: customer.id,
          sourceCountry: SOURCE_COUNTRY,
        }),
      ]);

      assert.ok(Number.isFinite(Number(scoped.openDebtUsd)));
      assert.ok(Number.isFinite(Number(full.openDebtUsd)));
      assert.ok(Number(scoped.totalPaymentsUsd) <= Number(full.totalPaymentsUsd) + 0.001);

      const laterPays = await prisma.payment.findMany({
        where: {
          customerId: customer.id,
          isPaid: true,
          paymentCode: { not: null },
          paymentDate: { gt: new Date(2026, 8, 19, 23, 59, 59, 999) },
        },
        select: { paymentCode: true },
      });
      for (const p of laterPays) {
        const doc = (p.paymentCode ?? "").trim();
        if (!doc) continue;
        assert.equal(ledgerHasDoc(scoped, doc), false, `${code} scoped card must hide ${doc}`);
      }
    }
  });
});
