/**
 * Reconciliation read-only — חמש שכבות לפירוט שבוע (ללא כתיבה ל-DB).
 */
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { aggregateTrackIntakeFromTotals } from "@/lib/flow-control/cash-flow-track-ssot";
import { buildFlowBusinessReconciliation } from "@/lib/flow-control/flow-week-business-reconciliation";
import { orderWeekForDueCollectionWeek } from "@/lib/flow-control/flow-week-due-orders";

export type FiveLayerReconciliation = {
  layer1Orders: {
    ordersCreatedCount: number;
    ordersCreatedUsd: string;
    ordersDueSourceWeek: string | null;
    ordersDueCount: number;
    ordersDueUsd: string;
    remainingToPayUsd: string;
  };
  layer2Receipts: {
    intakePsIls: number;
    intakePsUsd: number;
    intakeIlIls: number;
    intakeIlUsd: number;
    paymentIntakeIls: string;
    paymentsReceivedInWeek: number;
    paymentsByWeekCodeOnly: number;
  };
  layer3Tracks: ReturnType<typeof aggregateTrackIntakeFromTotals>;
  layer4Movements: {
    fxPsIls: string | null;
    fxPsUsd: string | null;
    fxIlIls: string | null;
    expensesIls: string;
    expensesUsd: string;
    turkeyTransferredUsd: string | null;
    turkeyClosingUsd: string | null;
    turkeyNote: string;
  };
  layer5Closing: ReturnType<typeof buildFlowBusinessReconciliation>["rows"];
  summary: ReturnType<typeof buildFlowBusinessReconciliation>["verifiedExceptionCount"];
};

export function buildFiveLayerWeekReconciliation(input: {
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
}): FiveLayerReconciliation {
  const { row, drill } = input;
  const track = {
    ps: { ils: Number(row.intakePsIls), usd: Number(row.intakePsUsd) },
    il: { ils: Number(row.intakeIlIls), usd: Number(row.intakeIlUsd) },
    unassigned: {
      ils: Number(row.intakeUnassignedIls),
      usd: Number(row.intakeUnassignedUsd),
    },
  };
  if (drill?.flow.weekPaymentIntake) {
    Object.assign(track, aggregateTrackIntakeFromTotals(drill.flow.weekPaymentIntake));
  }

  const recon = buildFlowBusinessReconciliation({
    drill,
    overview: row,
    week: row.week,
  });

  return {
    layer1Orders: {
      ordersCreatedCount: row.totalOrders,
      ordersCreatedUsd: row.totalOrdersUsd,
      ordersDueSourceWeek: row.ordersDueSourceWeek ?? orderWeekForDueCollectionWeek(row.week),
      ordersDueCount: row.ordersDueCount ?? 0,
      ordersDueUsd: row.ordersDueUsd ?? "0.00",
      remainingToPayUsd: row.remainingToPayUsd,
    },
    layer2Receipts: {
      intakePsIls: Number(row.intakePsIls ?? track.ps.ils),
      intakePsUsd: Number(row.intakePsUsd ?? track.ps.usd),
      intakeIlIls: Number(row.intakeIlIls ?? track.il.ils),
      intakeIlUsd: Number(row.intakeIlUsd ?? track.il.usd),
      paymentIntakeIls: row.paymentIntakeIls,
      paymentsReceivedInWeek: row.paymentsReceivedInWeek ?? 0,
      paymentsByWeekCodeOnly: row.paymentsByWeekCodeOnly ?? 0,
    },
    layer3Tracks: track,
    layer4Movements: {
      fxPsIls: row.fxPurchaseIls,
      fxPsUsd: row.fxPurchaseUsd,
      fxIlIls: row.ilFxPurchaseIls,
      expensesIls: row.expensesIls,
      expensesUsd: row.expensesUsd,
      turkeyTransferredUsd: row.turkeyTransferredUsd,
      turkeyClosingUsd: row.turkeyClosingUsd,
      turkeyNote:
        "יתרת closing מ-TurkeyTransferMovement — יתרה מצטברת לשבוע, לא תקבול לקוח בשבוע זה",
    },
    layer5Closing: recon.rows.filter((r) => r.group === "COUNT" || r.group === "CASHBOX"),
    summary: recon.verifiedExceptionCount,
  };
}
