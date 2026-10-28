/**
 * READ ONLY — השוואת Expected / Actual לשבועות AH-139, AH-141, AH-145
 */
import "dotenv/config";
import { loadFlowWeek } from "../src/app/admin/cash-flow/week-flow-service";
import { loadFlowWeekContext } from "../src/lib/flow-control/flow-week-context-service";
import { resolveCountryScopeFromCode } from "../src/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY } from "../src/lib/work-country";
import { prisma } from "../src/lib/prisma";
import { cashControlFlowReceiptPaymentsWhere } from "../src/lib/cash-control-flow-receipt-payments";
import { mergePaymentWhere } from "../src/lib/country-data-scope";

type Row = { metric: string; expected: string; actual: string; diff: string };

function n(v: unknown): number {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
}

function row(metric: string, expected: number | string | null, actual: number | string | null): Row {
  const e = expected == null ? "—" : String(expected);
  const a = actual == null ? "—" : String(actual);
  let diff = "—";
  if (typeof expected === "number" && typeof actual === "number") {
    const d = Math.round((actual - expected) * 100) / 100;
    diff = d === 0 ? "0" : String(d);
  }
  return { metric, expected: e, actual: a, diff };
}

async function auditWeek(week: string): Promise<Row[]> {
  const scope = resolveCountryScopeFromCode(DEFAULT_WORK_COUNTRY);
  const [ctx, flow, orderAgg, payIntake] = await Promise.all([
    loadFlowWeekContext(week, scope),
    loadFlowWeek(week, DEFAULT_WORK_COUNTRY),
    prisma.order.aggregate({
      where: { weekCode: week },
      _count: true,
      _sum: { totalUsd: true },
    }),
    prisma.payment.count({
      where: mergePaymentWhere(cashControlFlowReceiptPaymentsWhere(week), scope),
    }),
  ]);
  const payWeekCode = ctx.paymentsByWeekCodeOnly;

  const rows: Row[] = [];
  rows.push(row("הזמנות (weekCode)", orderAgg._count, ctx.ordersInOrderWeek));
  rows.push(row("סך הזמנות $", n(orderAgg._sum.totalUsd), "—"));
  rows.push(row("תשלומים לפי קליטה", payIntake, ctx.paymentsReceivedInWeek));
  rows.push(row("תשלומים לפי weekCode", payWeekCode, ctx.paymentsByWeekCodeOnly));
  rows.push(row("ספירת מנהל", flow?.managerCountState ?? "—", flow?.managerCountState ?? "—"));
  rows.push(
    row(
      "יתרת פתיחה $ מאומתת",
      flow?.cashboxes.usd.openingVerified ? "כן" : "לא",
      flow?.cashboxes.usd.openingVerified ? String(flow.cashboxes.usd.opening) : flow?.cashboxes.openingMessageHe ?? "—",
    ),
  );
  rows.push(
    row(
      "יתרת פתיחה ₪ מאומתת",
      flow?.cashboxes.ils.openingVerified ? "כן" : "לא",
      flow?.cashboxes.ils.openingVerified ? String(flow.cashboxes.ils.opening) : flow?.cashboxes.openingMessageHe ?? "—",
    ),
  );
  rows.push(row("קופה $ (מסך)", flow?.drawerRemainingUsd ?? "null", flow?.drawerRemainingUsd ?? "null"));
  rows.push(row("קופה ₪ (מסך)", flow?.drawerRemainingIls ?? "null", flow?.drawerRemainingIls ?? "null"));
  rows.push(row("FX PS ₪", "—", flow?.fxPurchaseIls ?? "0"));
  rows.push(row("FX PS $", "—", flow?.fxPurchaseUsd ?? "0"));
  rows.push(row("FX IL ₪", "—", flow?.ilFxPurchaseIls ?? "0"));
  rows.push(row("טורקיה יתרה $", "—", flow?.turkeyBalanceClosingUsd ?? "0"));
  return rows;
}

async function main() {
  const weeks = ["AH-139", "AH-141", "AH-145"];
  for (const w of weeks) {
    console.log("\n#", w);
    console.table(await auditWeek(w));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
