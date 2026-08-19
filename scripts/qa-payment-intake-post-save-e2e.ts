/**
 * QA E2E — post-save payment intake (DB assertions).
 * Usage: node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/qa-payment-intake-post-save-e2e.ts
 *
 * Validates SSOT calculations and, when DATABASE_URL is available,
 * reads persisted payment/order state for the canonical scenarios.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { calculateBalanceReset } from "../src/lib/balance-reset-calculation";
import { computePaymentIntakePostSaveOutcome } from "../src/lib/payment-intake-post-save";
import { computeOrderOpenDebtUsd } from "../src/lib/order-remaining-debt";
import { activePaidPaymentWhere } from "../src/lib/payment-record-status-shared";
import { getCustomerInternalBalanceUsd } from "../src/lib/customer-open-debt";

for (const file of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1]!.trim();
      let val = m[2]!.trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* ok */
  }
}

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Post-save payment intake — E2E QA ===\n");

// --- Pure SSOT scenarios (no DB) ---
{
  const exact = computePaymentIntakePostSaveOutcome({
    remainingDebtUsd: 0,
    deferredSurplusUsd: 0,
  });
  assert("Exact payment — no modals", !exact.needsSurplusDisposition && !exact.needsShortfallResolution);

  const over = computePaymentIntakePostSaveOutcome({
    remainingDebtUsd: 0,
    deferredSurplusUsd: 7.28,
  });
  assert("Overpayment $7.28 — surplus modal", over.needsSurplusDisposition && over.surplusUsd === 7.28);

  const partial = computePaymentIntakePostSaveOutcome({
    remainingDebtUsd: 2.72,
    deferredSurplusUsd: 0,
  });
  assert("Partial $2.72 — shortfall modal", partial.needsShortfallResolution && partial.remainingDebtUsd === 2.72);

  const shortfallReset = calculateBalanceReset({
    totalBeforeUsd: 52.72,
    paidUsd: 50,
    commissionBeforeUsd: 0,
  });
  assert(
    "Shortfall reset — negative commission delta",
    shortfallReset.differenceUsd === -2.72 && shortfallReset.commissionAfterUsd === -2.72,
    `got diff=${shortfallReset.differenceUsd} commissionAfter=${shortfallReset.commissionAfterUsd}`,
  );

  const surplusFee = calculateBalanceReset({
    totalBeforeUsd: 52.72,
    paidUsd: 60,
    commissionBeforeUsd: 0,
  });
  assert(
    "Surplus to commission — positive delta",
    surplusFee.differenceUsd === 7.28 && surplusFee.commissionAfterUsd === 7.28,
    `got diff=${surplusFee.differenceUsd}`,
  );
}

// --- DB verification (optional) ---
async function verifyDbPatterns() {
  if (!process.env.DATABASE_URL) {
    console.log("\n(DB skipped — no DATABASE_URL)\n");
    return;
  }

  const prisma = new PrismaClient();
  try {
    console.log("\n--- DB pattern checks ---\n");

    const recentCredits = await prisma.payment.findMany({
      where: {
        businessType: "CUSTOMER_CREDIT",
        orderId: null,
        ...activePaidPaymentWhere,
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        customerId: true,
        amountUsd: true,
        paymentNumber: true,
        notes: true,
      },
    });
    for (const c of recentCredits) {
      const creditUsd = Number(c.amountUsd ?? 0);
      if (!c.customerId) continue;
      const balance = await getCustomerInternalBalanceUsd(c.customerId);
      assert(
        `Credit row $${creditUsd.toFixed(2)} — customer balance includes credit`,
        balance >= creditUsd - 0.02,
        `balance=${balance.toFixed(2)} customer=${c.customerId}`,
      );
    }

    const recentFees = await prisma.paymentAdjustmentFee.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        amountUsd: true,
        reason: true,
        payment: { select: { businessType: true, amountUsd: true } },
      },
    });
    for (const f of recentFees) {
      const amt = Number(f.amountUsd ?? 0);
      const payAmt = Number(f.payment?.amountUsd ?? 0);
      assert(
        `Adjustment fee sign preserved (${f.reason ?? "?"})`,
        Math.sign(amt) === Math.sign(payAmt) || payAmt === 0,
        `fee=${amt} payment=${payAmt}`,
      );
    }

    const resetOrders = await prisma.order.findMany({
      where: { status: "COMPLETED", commissionUsd: { lt: 0 } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, totalUsd: true, amountUsd: true, commissionUsd: true },
    });
    for (const o of resetOrders) {
      const paidAgg = await prisma.payment.aggregate({
        where: { orderId: o.id, amountUsd: { not: null }, ...activePaidPaymentWhere },
        _sum: { amountUsd: true },
      });
      const paid = Number(paidAgg._sum.amountUsd ?? 0);
      const total = Number(o.totalUsd ?? Number(o.amountUsd ?? 0) + Number(o.commissionUsd ?? 0));
      const open = computeOrderOpenDebtUsd(total, paid);
      assert(
        `Negative-commission closed order ${o.id.slice(0, 8)} — open debt 0`,
        open <= 0.01,
        `open=${open.toFixed(2)} total=${total.toFixed(2)} paid=${paid.toFixed(2)} commission=${Number(o.commissionUsd).toFixed(2)}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

verifyDbPatterns()
  .then(() => {
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
