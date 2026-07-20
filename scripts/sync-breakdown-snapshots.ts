/**
 * Historical cleanup: sync OrderPaymentBreakdown paid/remaining to Ledger via Matching V2.
 *
 * Does NOT delete Orders/Payments/Breakdown rows.
 * Does NOT change Order totals or Payment amounts.
 *
 * Usage:
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/sync-breakdown-snapshots.ts --dry-run
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/sync-breakdown-snapshots.ts
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  orderNeedsBreakdownSync,
  rebuildBreakdownSnapshots,
  type BreakdownSyncOrderInput,
  type BreakdownSyncResult,
} from "@/lib/finance-data/services/breakdown-snapshot-sync-service";
import { nearlyEqual, roundMoney2, FINANCE_EPS } from "@/lib/finance-data/types";
import { validateBreakdown } from "@/lib/finance-data/validators";

function n(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(String(v));
}

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function loadCandidates(): Promise<BreakdownSyncOrderInput[]> {
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      paymentBreakdown: { some: {} },
      status: { notIn: ["CANCELLED", "DEBT_WITHDRAWAL"] },
    },
    select: {
      id: true,
      orderNumber: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
      exchangeRate: true,
      usdRateUsed: true,
      snapshotFinalDollarRate: true,
      paymentBreakdown: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          paymentMethod: true,
          amount: true,
          currency: true,
          paidAmount: true,
          remainingAmount: true,
        },
      },
      payments: {
        where: { status: "ACTIVE" },
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          amountUsd: true,
          amountIls: true,
          paymentMethod: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
          paymentDate: true,
          createdAt: true,
          methodAllocations: {
            select: {
              method: true,
              currency: true,
              sourceAmount: true,
              amountUsd: true,
            },
          },
        },
      },
    },
  });

  return orders.map((o) => {
    const deal = n(o.amountUsd);
    const com = n(o.commissionUsd);
    const total = n(o.totalUsd) || roundMoney2(deal + com);
    const rate =
      n(o.usdRateUsed) || n(o.snapshotFinalDollarRate) || n(o.exchangeRate) || 0;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      totalUsd: total,
      exchangeRate: rate,
      breakdown: o.paymentBreakdown.map((b) => ({
        id: b.id,
        paymentMethod: b.paymentMethod,
        amount: n(b.amount),
        currency: b.currency,
        paidAmount: n(b.paidAmount),
        remainingAmount: b.remainingAmount == null ? null : n(b.remainingAmount),
      })),
      payments: o.payments.map((p) => ({
        id: p.id,
        amountUsd: n(p.amountUsd),
        amountIls: n(p.amountIls),
        paymentMethod: p.paymentMethod,
        usdPaymentMethod: p.usdPaymentMethod,
        ilsPaymentMethod: p.ilsPaymentMethod,
        paymentDate: p.paymentDate,
        createdAt: p.createdAt,
        allocations: p.methodAllocations.map((a) => ({
          method: a.method,
          currency: a.currency,
          sourceAmount: n(a.sourceAmount),
          amountUsd: n(a.amountUsd),
        })),
      })),
    } satisfies BreakdownSyncOrderInput;
  });
}

async function persistUpdates(
  result: BreakdownSyncResult,
  dryRun: boolean,
): Promise<void> {
  if (!result.fixed || result.updates.length === 0) return;
  if (dryRun) return;
  for (const u of result.updates) {
    await prisma.orderPaymentBreakdown.update({
      where: { id: u.breakdownId },
      data: {
        paidAmount: new Prisma.Decimal(u.paidAmount.toFixed(4)),
        remainingAmount: new Prisma.Decimal(u.remainingAmount.toFixed(4)),
      },
    });
  }
}

async function verifyAll(): Promise<{
  remainingSync: boolean;
  paidSync: boolean;
  usdOk: boolean;
  ilsOk: boolean;
  failures: string[];
}> {
  const inputs = await loadCandidates();
  const failures: string[] = [];
  let remainingSync = true;
  let paidSync = true;
  let usdOk = true;
  let ilsOk = true;

  for (const input of inputs) {
    const paidUsd = roundMoney2(input.payments.reduce((s, p) => s + p.amountUsd, 0));
    const openDebtUsd = roundMoney2(Math.max(0, input.totalUsd - paidUsd));
    let sumPaidUsd = 0;
    let sumRemUsd = 0;
    let sumPaidIls = 0;
    let sumRemIls = 0;
    const rows = input.breakdown.map((b) => {
      const cur = b.currency.toUpperCase() === "ILS" ? "ILS" : "USD";
      const paid = roundMoney2(b.paidAmount);
      const rem =
        b.remainingAmount != null
          ? roundMoney2(Math.max(0, b.remainingAmount))
          : roundMoney2(Math.max(0, b.amount - b.paidAmount));
      if (cur === "ILS") {
        sumPaidIls = roundMoney2(sumPaidIls + paid);
        sumRemIls = roundMoney2(sumRemIls + rem);
      } else {
        sumPaidUsd = roundMoney2(sumPaidUsd + paid);
        sumRemUsd = roundMoney2(sumRemUsd + rem);
      }
      return {
        id: b.id,
        paymentMethod: b.paymentMethod,
        amount: b.amount,
        currency: cur as "USD" | "ILS",
        paidAmount: paid,
        remainingAmount: rem,
      };
    });

    if (!nearlyEqual(sumRemUsd, openDebtUsd, FINANCE_EPS)) {
      remainingSync = false;
      usdOk = false;
      failures.push(`${input.orderNumber ?? input.orderId}: remaining ${sumRemUsd} ≠ openDebt ${openDebtUsd}`);
    }
    // Paid sync: when open debt 0, snapshot paid should cover planned USD (or equal ledger paid)
    if (openDebtUsd <= FINANCE_EPS && paidUsd > FINANCE_EPS) {
      if (sumPaidUsd <= FINANCE_EPS && sumRemUsd > FINANCE_EPS) {
        paidSync = false;
        failures.push(`${input.orderNumber ?? input.orderId}: paid snapshot still 0`);
      }
    }
    const v = validateBreakdown({
      orderId: input.orderId,
      openDebtUsd,
      openDebtIls: sumRemIls,
      rows,
    });
    if (!v.ok) {
      usdOk = false;
      for (const issue of v.issues) {
        if (issue.code.includes("ILS")) ilsOk = false;
        failures.push(`${input.orderNumber ?? input.orderId}: ${issue.code}`);
      }
    }
  }

  return { remainingSync, paidSync, usdOk, ilsOk, failures };
}

async function main() {
  const dryRun = isDryRun();
  const all = await loadCandidates();
  const toFix = all.filter(orderNeedsBreakdownSync);
  const results: BreakdownSyncResult[] = [];

  for (const input of toFix) {
    const rebuilt = rebuildBreakdownSnapshots(input);
    await persistUpdates(rebuilt, dryRun);
    results.push(rebuilt);
    console.log(
      JSON.stringify({
        dryRun,
        orderNumber: rebuilt.orderNumber,
        orderId: rebuilt.orderId,
        before: rebuilt.before,
        after: rebuilt.after,
        validationOk: rebuilt.validationOk,
        updates: rebuilt.updates.length,
      }),
    );
  }

  // Re-load and validate entire set after writes
  const verify = dryRun
    ? {
        remainingSync: results.every((r) => r.validationOk && nearlyEqual(r.after.sumRemainingUsd, r.after.openDebtUsd, FINANCE_EPS)),
        paidSync: results.every((r) => r.after.sumPaidUsd > FINANCE_EPS || r.after.openDebtUsd > FINANCE_EPS || r.before.sumPaidUsd <= FINANCE_EPS),
        usdOk: results.every((r) => r.validationOk),
        ilsOk: true,
        failures: results.filter((r) => !r.validationOk).map((r) => r.orderId),
      }
    : await verifyAll();

  const fixedOk = results.filter((r) => r.fixed && r.validationOk).length;
  const fixedFail = results.filter((r) => r.fixed && !r.validationOk).length;

  console.log("\n=== Breakdown Snapshot Sync Report ===\n");
  console.log(`Mode\t${dryRun ? "DRY-RUN" : "APPLY"}`);
  console.log(`Orders שנבדקו\t${all.length}`);
  console.log(`Orders שתוקנו\t${results.length}${dryRun ? " (simulated)" : ""}`);
  console.log(`Orders שלא נזקקו לתיקון\t${all.length - toFix.length}`);
  console.log(`Orders תוקנו + validation OK\t${fixedOk}`);
  console.log(`Orders תוקנו + validation FAIL\t${fixedFail}`);
  console.log(`Remaining Sync\t${verify.remainingSync ? "✅" : "❌"}`);
  console.log(`Paid Sync\t${verify.paidSync ? "✅" : "❌"}`);
  console.log(`USD Validation\t${verify.usdOk ? "✅" : "❌"}`);
  console.log(`ILS Validation\t${verify.ilsOk ? "✅" : "❌"}`);
  if (verify.failures.length > 0) {
    console.log("\nFailures:");
    for (const f of verify.failures.slice(0, 30)) console.log(` - ${f}`);
  }

  const ok = verify.remainingSync && verify.paidSync && verify.usdOk && verify.ilsOk && fixedFail === 0;
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(2);
});
