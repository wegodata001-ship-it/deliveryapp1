/**
 * READ ONLY — Expected (DB / SSOT) vs Actual (מסך loadFlowWeek)
 *
 * Usage:
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/cashflow-financial-validation.qa.ts
 */
import "dotenv/config";
import { loadFlowWeek } from "../src/app/admin/cash-flow/week-flow-service";
import { loadFlowWeekContext } from "../src/lib/flow-control/flow-week-context-service";
import { loadFlowWeekOpeningBalance } from "../src/lib/flow-control/flow-week-opening-service";
import { resolveCountryScopeFromCode, mergePaymentWhere, mergeOrderWhere } from "../src/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY } from "../src/lib/work-country";
import { prisma } from "../src/lib/prisma";
import { cashControlFlowReceiptPaymentsWhere } from "../src/lib/cash-control-flow-receipt-payments";
import { activePaidPaymentWhere } from "../src/lib/payment-record-status-shared";
import { cashControlExcludeInternalPaymentsWhere } from "../src/lib/cash-control-internal-payments";
import { getAhWeekRange } from "../src/lib/weeks/ah-week";
import { readCashboxClosing } from "../src/lib/flow-control/week-balance-snapshot-merge";
import { flowWeekCompositeKey } from "../src/lib/flow-control/flow-country-scope";
import { sumFxPurchases } from "../src/lib/flow-control/flow-calculation-service";

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
  } else if (String(expected) === String(actual)) {
    diff = "0";
  }
  return { metric, expected: e, actual: a, diff };
}

async function auditWeek(week: string): Promise<Row[]> {
  const scope = resolveCountryScopeFromCode(DEFAULT_WORK_COUNTRY);
  const range = getAhWeekRange(week);
  const [ctx, flow, orderAgg, payIntakeCount, payWeekCodeCount, flowRow, opening] =
    await Promise.all([
      loadFlowWeekContext(week, scope),
      loadFlowWeek(week, DEFAULT_WORK_COUNTRY),
      prisma.order.aggregate({
        where: mergeOrderWhere({ weekCode: week, deletedAt: null }, scope),
        _count: true,
        _sum: { totalUsd: true },
      }),
      prisma.payment.count({
        where: mergePaymentWhere(cashControlFlowReceiptPaymentsWhere(week), scope),
      }),
      prisma.payment.count({
        where: mergePaymentWhere(
          {
            AND: [
              activePaidPaymentWhere,
              { weekCode: week },
              cashControlExcludeInternalPaymentsWhere,
              { NOT: { businessType: "ADJUSTMENT_FEE" } },
            ],
          },
          scope,
        ),
      }),
      prisma.cashWeekFlow.findUnique({
        where: flowWeekCompositeKey({ workCountry: DEFAULT_WORK_COUNTRY }, week),
        select: {
          countedCashUsd: true,
          countedCashIls: true,
          weekBalanceSnapshot: true,
          fxPurchases: true,
        },
      }),
      loadFlowWeekOpeningBalance(week, DEFAULT_WORK_COUNTRY),
    ]);

  const closingSnap = flowRow ? readCashboxClosing(flowRow.weekBalanceSnapshot) : null;
  const fxJson = flowRow?.fxPurchases;
  const fxList = Array.isArray(fxJson) ? fxJson : [];
  const fxPsDb = sumFxPurchases(fxList as never[], "PS");
  const fxIlDb = sumFxPurchases(fxList as never[], "IL");

  const rows: Row[] = [];
  rows.push(row("הזמנות (count DB)", orderAgg._count, ctx.ordersInOrderWeek));
  rows.push(row("סך הזמנות $ (DB aggregate)", n(orderAgg._sum.totalUsd), n(orderAgg._sum.totalUsd)));
  rows.push(row("תשלומים לפי קליטה (count DB)", payIntakeCount, ctx.paymentsReceivedInWeek));
  rows.push(row("תשלומים לפי weekCode (count DB)", payWeekCodeCount, ctx.paymentsByWeekCodeOnly));
  if (flow) {
    rows.push(
      row(
        "תקבול $ (intake מסך)",
        n(flow.receiptLayers?.actualReceipts?.CASH_USD?.amount ?? flow.weekPaymentIntake?.CASH_USD),
        n(flow.weekPaymentIntake.CASH_USD),
      ),
    );
    rows.push(
      row(
        "תקבול ₪ (intake מסך)",
        n(flow.weekPaymentIntake.CASH_ILS),
        n(flow.receiptLayers.actualReceipts.CASH_ILS.amount),
      ),
    );
  }
  rows.push(row("FX PS ₪ (DB JSON)", fxPsDb.ils, flow ? n(flow.fxPurchaseIls) : null));
  rows.push(row("FX PS $ (DB JSON)", fxPsDb.usd, flow ? n(flow.fxPurchaseUsd) : null));
  rows.push(row("FX IL ₪ (DB JSON)", fxIlDb.ils, flow ? n(flow.ilFxPurchaseIls) : null));
  rows.push(row("ספירת מנהל (מסך)", flow?.managerCountState ?? "—", flow?.managerCountState ?? "—"));
  rows.push(
    row(
      "נספר $ (DB)",
      flowRow?.countedCashUsd != null ? n(flowRow.countedCashUsd) : null,
      flow?.counted.CASH_USD != null ? n(flow.counted.CASH_USD) : null,
    ),
  );
  rows.push(
    row(
      "פתיחה מאומתת",
      opening.verified ? "כן" : "לא",
      flow?.cashboxes.usd.openingVerified ? "כן" : "לא",
    ),
  );
  rows.push(
    row(
      "פתיחה $",
      opening.openingUsd,
      flow?.cashboxes.usd.openingVerified ? flow.cashboxes.usd.opening : null,
    ),
  );
  rows.push(
    row(
      "סגירה $ (snapshot)",
      closingSnap?.usd ?? null,
      closingSnap?.weekCode === week ? closingSnap.usd : null,
    ),
  );
  rows.push(row("קופה $ (מסך)", flow?.drawerRemainingUsd ?? "null", flow?.drawerRemainingUsd ?? "null"));
  rows.push(row("קופה ₪ (מסך)", flow?.drawerRemainingIls ?? "null", flow?.drawerRemainingIls ?? "null"));
  rows.push(row("טורקיה יתרה $", flow?.turkeyBalanceClosingUsd ?? "—", flow?.turkeyBalanceClosingUsd ?? "—"));
  if (range) {
    rows.push(row("טווח שבוע", `${range.from}–${range.to}`, `${range.from}–${range.to}`));
  }
  return rows;
}

async function main() {
  const weeks = ["AH-139", "AH-141", "AH-145", "AH-146"];
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
