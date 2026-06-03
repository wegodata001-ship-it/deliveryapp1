/**
 * בדיקת איחוד מקור FinancialSettings — מריץ מקומית (לא Next server actions).
 * Usage: npx tsx scripts/verify-finance-audit.ts
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  loadFinanceSettingsSerialized,
  persistFinanceSettingsRow,
} from "../src/lib/financial-settings";
import { finalRateFromBaseAndFee } from "../src/lib/financial-calc";

const EXPECT = {
  baseDollarRate: "4.0000",
  dollarFee: "0.2000",
  finalDollarRate: "4.2000",
  defaultCommissionPercent: "5.0000",
};

async function main() {
  console.log("=== Finance audit verification ===\n");

  const base = new Prisma.Decimal("4.00");
  const fee = new Prisma.Decimal("0.20");
  const commission = new Prisma.Decimal("5");

  await persistFinanceSettingsRow({
    consumer: "verify-script-save",
    baseDollarRate: base,
    dollarFee: fee,
    defaultCommissionPercent: commission,
    source: "MANUAL",
  });

  const final = finalRateFromBaseAndFee(base, fee);
  console.log("Saved:", {
    base: base.toString(),
    fee: fee.toString(),
    final: final.toString(),
    commission: commission.toString(),
  });
  console.log("");

  const consumers = ["admin-settings", "order-capture", "payment-capture"] as const;
  const loaded: Record<string, Awaited<ReturnType<typeof loadFinanceSettingsSerialized>>> = {};

  for (const c of consumers) {
    loaded[c] = await loadFinanceSettingsSerialized(c);
  }

  let allMatch = true;
  for (const c of consumers) {
    const v = loaded[c];
    const ok =
      v.baseDollarRate === EXPECT.baseDollarRate &&
      v.dollarFee === EXPECT.dollarFee &&
      v.finalDollarRate === EXPECT.finalDollarRate &&
      v.defaultCommissionPercent === EXPECT.defaultCommissionPercent;
    if (!ok) allMatch = false;
    console.log(`[finance] loaded values — consumer: ${c}`);
    console.log(JSON.stringify(v, null, 2));
    console.log(ok ? "  ✓ matches expected\n" : "  ✗ MISMATCH\n");
  }

  const rows = await prisma.financialSettings.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      baseDollarRate: true,
      dollarFee: true,
      finalDollarRate: true,
      defaultCommissionPercent: true,
      updatedAt: true,
    },
  });

  const latest = rows[0];
  console.log("DB FinancialSettings — latest row (active):");
  console.log(
    JSON.stringify(
      {
        id: latest?.id,
        baseDollarRate: latest?.baseDollarRate?.toString(),
        dollarFee: latest?.dollarFee?.toString(),
        finalDollarRate: latest?.finalDollarRate?.toString(),
        defaultCommissionPercent: latest?.defaultCommissionPercent?.toString(),
        updatedAt: latest?.updatedAt,
        totalRowsInTable: await prisma.financialSettings.count(),
        note: "Active = latest by updatedAt; older rows are history",
      },
      null,
      2,
    ),
  );

  const crossEqual =
    consumers.every(
      (c) =>
        loaded[c].finalDollarRate === loaded[consumers[0]].finalDollarRate &&
        loaded[c].defaultCommissionPercent === loaded[consumers[0]].defaultCommissionPercent,
    ) && allMatch;

  console.log("\n=== Result ===");
  console.log(crossEqual ? "PASS — all consumers + DB latest agree" : "FAIL — see mismatches above");
  process.exit(crossEqual ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
