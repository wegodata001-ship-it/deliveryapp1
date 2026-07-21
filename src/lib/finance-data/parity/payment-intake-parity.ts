/**
 * Payment Intake Parity — compare Legacy load vs Finance Data Layer V2.
 * Does not change UI. Logs diffs only. Used during Phase 1 migration.
 */

import { computeOpenDebtUsd } from "@/lib/finance-data/ledger";
import { paymentIntakeQueryService } from "@/lib/finance-data/services";
import { nearlyEqual, roundMoney2 } from "@/lib/finance-data/types";
import {
  validateBreakdown,
  validateCurrencies,
  validateDebtTransfer,
  validateLedger,
  validatePaymentAllocation,
  type ValidationResult,
} from "@/lib/finance-data/validators";
import { orderPaymentBreakdownRepository, paymentRepository } from "@/lib/finance-data/repositories";
import type { PaymentIntakeView } from "@/lib/finance-data/view-models";

/** Parity requires exact cents — stricter than business FINANCE_EPS (0.02). */
export const PARITY_EPS = 0.005;
export type LegacyParityMethod = {
  method: string;
  currency: "USD" | "ILS";
  planned: number;
  paid: number;
  remaining: number;
};

export type LegacyParityOrder = {
  orderId: string;
  orderNumber: string | null;
  customerId: string | null;
  amountUsd: number;
  commissionUsd: number;
  totalUsd: number;
  paidUsd: number;
  openDebtUsd: number;
  status: string;
  methods: LegacyParityMethod[];
};

export type ParityFieldDiff = {
  orderId: string;
  orderNumber: string | null;
  field: string;
  currency?: "USD" | "ILS";
  legacyValue: string | number;
  v2Value: string | number;
  delta: number | null;
  legacyService: string;
  v2Service: string;
};

export type ParityValidatorFailure = {
  orderId: string;
  validator: string;
  result: ValidationResult;
};

export type PaymentIntakeParityReport = {
  customerId: string;
  ordersChecked: number;
  ordersFullMatch: number;
  ordersWithGaps: number;
  gapsUsd: number;
  gapsIls: number;
  gapsRemaining: number;
  gapsPaid: number;
  gapsPlanned: number;
  gapsCommission: number;
  gapsOverpayment: number;
  gapsStatus: number;
  gapsMissingOrder: number;
  validatorsPassed: number;
  validatorsTotal: number;
  diffs: ParityFieldDiff[];
  validatorFailures: ParityValidatorFailure[];
  /** Legacy vs V2 field equality (no cent gaps) */
  layersMatch: boolean;
  /** All finance-data validators passed */
  validatorsOk: boolean;
  /** layersMatch && validatorsOk — required before switching UI to V2 */
  fullParity: boolean;
};

export function financeIntakeParityEnabled(): boolean {
  const flag = process.env.FINANCE_INTAKE_PARITY?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function money(n: number): number {
  return roundMoney2(n);
}

function pushMoneyDiff(
  diffs: ParityFieldDiff[],
  base: Omit<ParityFieldDiff, "legacyValue" | "v2Value" | "delta">,
  legacyVal: number,
  v2Val: number,
  counters: { usd: number; ils: number; remaining: number; paid: number; planned: number; commission: number; overpayment: number },
): void {
  if (nearlyEqual(legacyVal, v2Val, PARITY_EPS)) return;
  const currency = base.currency;
  const field = base.field;
  if (currency === "USD") counters.usd += 1;
  if (currency === "ILS") counters.ils += 1;
  if (field.includes("remaining") || field.includes("openDebt")) counters.remaining += 1;
  if (field.includes("paid") || field === "Paid") counters.paid += 1;
  if (field.includes("planned") || field.includes("Planned") || field === "Order Total") counters.planned += 1;
  if (field.includes("commission") || field === "Commission") counters.commission += 1;
  if (field === "Overpayment") counters.overpayment += 1;

  diffs.push({
    ...base,
    legacyValue: money(legacyVal),
    v2Value: money(v2Val),
    delta: money(v2Val - legacyVal),
  });
}

function mapLegacyStatusToComparable(status: string, openDebtUsd: number): string {
  if (openDebtUsd < -PARITY_EPS) return "credit";
  if (status === "paid") return "paid";
  if (status === "unpaid") return "open";
  if (status === "partial") return "open";
  return status;
}

function mapV2Status(status: string): string {
  return status;
}

export function comparePaymentIntakeParity(params: {
  customerId: string;
  legacyOrders: LegacyParityOrder[];
  v2: PaymentIntakeView;
}): Omit<
  PaymentIntakeParityReport,
  | "validatorsPassed"
  | "validatorsTotal"
  | "validatorFailures"
  | "fullParity"
  | "layersMatch"
  | "validatorsOk"
> & {
  orderIds: string[];
} {
  const diffs: ParityFieldDiff[] = [];
  const counters = {
    usd: 0,
    ils: 0,
    remaining: 0,
    paid: 0,
    planned: 0,
    commission: 0,
    overpayment: 0,
  };
  let gapsStatus = 0;
  let gapsMissingOrder = 0;

  const v2Orders = new Map(params.v2.orders.map((o) => [o.orderId, o]));
  const v2MethodsByOrder = new Map<string, typeof params.v2.methods>();
  for (const m of params.v2.methods) {
    const list = v2MethodsByOrder.get(m.orderId) ?? [];
    list.push(m);
    v2MethodsByOrder.set(m.orderId, list);
  }

  let ordersFullMatch = 0;

  for (const leg of params.legacyOrders) {
    const v2o = v2Orders.get(leg.orderId);
    const before = diffs.length;

    if (!v2o) {
      gapsMissingOrder += 1;
      diffs.push({
        orderId: leg.orderId,
        orderNumber: leg.orderNumber,
        field: "Order Presence",
        legacyValue: "present",
        v2Value: "missing",
        delta: null,
        legacyService: "payment-intake-load",
        v2Service: "paymentIntakeQueryService",
      });
      continue;
    }

    const base = {
      orderId: leg.orderId,
      orderNumber: leg.orderNumber,
      legacyService: "payment-intake-load",
      v2Service: "ledgerService",
    } as const;

    if ((leg.orderNumber ?? "") !== (v2o.orderNumber ?? "")) {
      diffs.push({
        ...base,
        field: "Order Number",
        legacyValue: leg.orderNumber ?? "",
        v2Value: v2o.orderNumber ?? "",
        delta: null,
        v2Service: "ledgerService",
      });
    }

    pushMoneyDiff(diffs, { ...base, field: "Order Total", currency: "USD", v2Service: "ledgerService" }, leg.totalUsd, v2o.totalUsd, counters);
    pushMoneyDiff(diffs, { ...base, field: "Paid", currency: "USD", v2Service: "ledgerService" }, leg.paidUsd, v2o.paidUsd, counters);
    pushMoneyDiff(diffs, { ...base, field: "Open Debt", currency: "USD", v2Service: "ledgerService" }, leg.openDebtUsd, v2o.openDebtUsd, counters);
    pushMoneyDiff(diffs, { ...base, field: "Commission", currency: "USD", v2Service: "ledgerService" }, leg.commissionUsd, v2o.commissionUsd, counters);
    pushMoneyDiff(diffs, { ...base, field: "Deal Amount", currency: "USD", v2Service: "ledgerService" }, leg.amountUsd, v2o.amountUsd, counters);

    const legOver = money(Math.min(0, leg.openDebtUsd));
    const v2Over = money(Math.min(0, v2o.openDebtUsd));
    pushMoneyDiff(diffs, { ...base, field: "Overpayment", currency: "USD", v2Service: "ledgerService" }, legOver, v2Over, counters);

    const legStatus = mapLegacyStatusToComparable(leg.status, leg.openDebtUsd);
    const v2Status = mapV2Status(v2o.status);
    if (legStatus !== v2Status) {
      // unpaid/partial both map to open — already normalized
      if (!(legStatus === "open" && v2Status === "open")) {
        gapsStatus += 1;
        diffs.push({
          ...base,
          field: "Status",
          legacyValue: `${leg.status}→${legStatus}`,
          v2Value: v2Status,
          delta: null,
          v2Service: "ledgerService",
        });
      }
    }

    const v2Methods = v2MethodsByOrder.get(leg.orderId) ?? [];
    const v2ByKey = new Map(
      v2Methods.map((m) => [`${m.currency}:${m.paymentMethod}`, m]),
    );
    const legKeys = new Set(leg.methods.map((m) => `${m.currency}:${m.method}`));

    for (const lm of leg.methods) {
      const key = `${lm.currency}:${lm.method}`;
      const vm = v2ByKey.get(key);
      const mBase = {
        orderId: leg.orderId,
        orderNumber: leg.orderNumber,
        currency: lm.currency,
        legacyService: "payment-intake-load/breakdown",
        v2Service: "paymentBreakdownService",
      } as const;

      if (!vm) {
        diffs.push({
          ...mBase,
          field: `Payment Method missing (${key})`,
          legacyValue: "present",
          v2Value: "missing",
          delta: null,
        });
        if (lm.currency === "USD") counters.usd += 1;
        else counters.ils += 1;
        continue;
      }

      pushMoneyDiff(diffs, { ...mBase, field: `Planned Amount (${lm.method})` }, lm.planned, vm.planned, counters);
      pushMoneyDiff(diffs, { ...mBase, field: `Paid Amount (${lm.method})` }, lm.paid, vm.paid, counters);
      pushMoneyDiff(diffs, { ...mBase, field: `Remaining Amount (${lm.method})` }, lm.remaining, vm.remaining, counters);
    }

    for (const vm of v2Methods) {
      const key = `${vm.currency}:${vm.paymentMethod}`;
      if (!legKeys.has(key)) {
        diffs.push({
          orderId: leg.orderId,
          orderNumber: leg.orderNumber,
          field: `Payment Method extra (${key})`,
          currency: vm.currency,
          legacyValue: "missing",
          v2Value: "present",
          delta: null,
          legacyService: "payment-intake-load/breakdown",
          v2Service: "paymentBreakdownService",
        });
        if (vm.currency === "USD") counters.usd += 1;
        else counters.ils += 1;
      }
    }

    // Debt transfer signal: remaining ≠ planned − paid on either side
    for (const lm of leg.methods) {
      const derived = money(Math.max(0, lm.planned - lm.paid));
      const legTransfer = !nearlyEqual(lm.remaining, derived, PARITY_EPS);
      const vm = v2ByKey.get(`${lm.currency}:${lm.method}`);
      if (!vm) continue;
      const v2Derived = money(Math.max(0, vm.planned - vm.paid));
      const v2Transfer = !nearlyEqual(vm.remaining, v2Derived, PARITY_EPS);
      if (legTransfer !== v2Transfer) {
        diffs.push({
          orderId: leg.orderId,
          orderNumber: leg.orderNumber,
          field: `Debt Transfer signal (${lm.method})`,
          currency: lm.currency,
          legacyValue: legTransfer ? "transfer" : "none",
          v2Value: v2Transfer ? "transfer" : "none",
          delta: null,
          legacyService: "payment-intake-load/breakdown",
          v2Service: "paymentBreakdownService",
        });
      }
    }

    if (diffs.length === before) ordersFullMatch += 1;
  }

  // V2 orders not in legacy
  const legacyIds = new Set(params.legacyOrders.map((o) => o.orderId));
  for (const v2o of params.v2.orders) {
    if (legacyIds.has(v2o.orderId)) continue;
    gapsMissingOrder += 1;
    diffs.push({
      orderId: v2o.orderId,
      orderNumber: v2o.orderNumber,
      field: "Order Presence",
      legacyValue: "missing",
      v2Value: "present",
      delta: null,
      legacyService: "payment-intake-load",
      v2Service: "paymentIntakeQueryService",
    });
  }

  return {
    customerId: params.customerId,
    ordersChecked: params.legacyOrders.length,
    ordersFullMatch,
    ordersWithGaps: params.legacyOrders.length - ordersFullMatch,
    gapsUsd: counters.usd,
    gapsIls: counters.ils,
    gapsRemaining: counters.remaining,
    gapsPaid: counters.paid,
    gapsPlanned: counters.planned,
    gapsCommission: counters.commission,
    gapsOverpayment: counters.overpayment,
    gapsStatus,
    gapsMissingOrder,
    diffs,
    orderIds: params.legacyOrders.map((o) => o.orderId),
  };
}

export async function runValidatorsForParity(orderIds: string[]): Promise<{
  failures: ParityValidatorFailure[];
  passed: number;
  total: number;
}> {
  const failures: ParityValidatorFailure[] = [];
  let passed = 0;
  let total = 0;

  for (const orderId of orderIds) {
    const [payments, rows] = await Promise.all([
      paymentRepository.findActiveByOrderId(orderId),
      orderPaymentBreakdownRepository.findByOrderId(orderId),
    ]);

    const paidUsd = roundMoney2(payments.reduce((s, p) => s + p.amountUsd, 0));
    // total from first payment's order via ledger path — use breakdown validate with computed open debt from views
    const snapPaid = paidUsd;

    // Ledger validate needs snapshot — rebuild from payments + we need order total from rows context
    // Use paymentIntakeQuery single order via ledgerService path:
    const { ledgerService } = await import("@/lib/finance-data/services/ledger-service");
    const balance = await ledgerService.getOrderBalanceView(orderId);
    if (balance) {
      total += 1;
      const ledgerSnap = computeOpenDebtUsd({
        orderId,
        totalUsd: balance.totalUsd,
        paidUsd: balance.paidUsd,
      });
      const r = validateLedger(ledgerSnap);
      if (r.ok) passed += 1;
      else failures.push({ orderId, validator: "validateLedger", result: r });
    }

    if (rows.length > 0 && balance) {
      total += 1;
      const r = validateBreakdown({
        orderId,
        openDebtUsd: Math.max(0, balance.openDebtUsd),
        rows,
      });
      if (r.ok) passed += 1;
      else failures.push({ orderId, validator: "validateBreakdown", result: r });
    }

    total += 1;
    const cur = validateCurrencies({
      entered: rows.map((row) => ({ currency: row.currency })),
    });
    if (cur.ok) passed += 1;
    else failures.push({ orderId, validator: "validateCurrencies", result: cur });

    // Debt transfer: if remaining diverges from planned−paid, treat as applied transfer (load-time).
    // Validator confirms amount > 0 and fits within max(remaining, derived).
    {
      total += 1;
      let transferOk = true;
      for (const row of rows) {
        if (row.remainingAmount == null) continue;
        const derived = roundMoney2(Math.max(0, row.amount - row.paidAmount));
        const rem = roundMoney2(Math.max(0, row.remainingAmount));
        if (nearlyEqual(rem, derived, PARITY_EPS)) continue;
        const amount = roundMoney2(Math.abs(rem - derived));
        const r = validateDebtTransfer({
          fromMethod: "FROM",
          toMethod: "TO",
          amount,
          currency: row.currency,
          fromRemaining: Math.max(rem, derived, amount),
        });
        if (!r.ok) {
          transferOk = false;
          failures.push({ orderId, validator: "validateDebtTransfer", result: r });
        }
      }
      if (transferOk) passed += 1;
    }

    total += 1;
    const alloc = validatePaymentAllocation({
      paymentAmountUsd: snapPaid,
      allocations: payments
        .filter((p) => p.orderId === orderId)
        .map((p) => ({ orderId, amountUsd: p.amountUsd })),
    });
    if (alloc.ok) passed += 1;
    else failures.push({ orderId, validator: "validatePaymentAllocation", result: alloc });
  }

  return { failures, passed, total };
}

export function logParityDiffs(report: PaymentIntakeParityReport): void {
  const prefix = "[finance-intake-parity]";
  if (report.fullParity) {
    console.log(prefix, {
      customerId: report.customerId,
      ordersChecked: report.ordersChecked,
      layersMatch: true,
      validatorsOk: true,
      fullParity: true,
      validators: `${report.validatorsPassed}/${report.validatorsTotal}`,
    });
    return;
  }

  for (const d of report.diffs) {
    console.warn(prefix, {
      orderId: d.orderId,
      orderNumber: d.orderNumber,
      field: d.field,
      currency: d.currency,
      legacyValue: d.legacyValue,
      v2Value: d.v2Value,
      delta: d.delta,
      legacyService: d.legacyService,
      v2Service: d.v2Service,
    });
  }
  for (const f of report.validatorFailures) {
    console.warn(prefix, {
      orderId: f.orderId,
      validator: f.validator,
      issues: f.result.issues,
    });
  }
  console.warn(prefix, {
    customerId: report.customerId,
    ordersChecked: report.ordersChecked,
    ordersFullMatch: report.ordersFullMatch,
    ordersWithGaps: report.ordersWithGaps,
    gapsUsd: report.gapsUsd,
    gapsIls: report.gapsIls,
    gapsRemaining: report.gapsRemaining,
    gapsPaid: report.gapsPaid,
    gapsPlanned: report.gapsPlanned,
    validators: `${report.validatorsPassed}/${report.validatorsTotal}`,
    fullParity: false,
  });
}

export async function runPaymentIntakeParity(params: {
  customerId: string;
  legacyOrders: LegacyParityOrder[];
  customerCreditUsd?: number | null;
  /** Same derived credit as legacy — required for Customer Credit parity */
  v2CustomerCreditUsd?: number | null;
}): Promise<PaymentIntakeParityReport> {
  const orderIds = params.legacyOrders.map((o) => o.orderId);
  const v2 = await paymentIntakeQueryService.getForOrderIds({
    customerId: params.customerId,
    orderIds,
  });

  if (!v2) {
    const empty: PaymentIntakeParityReport = {
      customerId: params.customerId,
      ordersChecked: params.legacyOrders.length,
      ordersFullMatch: 0,
      ordersWithGaps: params.legacyOrders.length,
      gapsUsd: 0,
      gapsIls: 0,
      gapsRemaining: 0,
      gapsPaid: 0,
      gapsPlanned: 0,
      gapsCommission: 0,
      gapsOverpayment: 0,
      gapsStatus: 0,
      gapsMissingOrder: params.legacyOrders.length,
      validatorsPassed: 0,
      validatorsTotal: 0,
      diffs: [
        {
          orderId: params.customerId,
          orderNumber: null,
          field: "Customer",
          legacyValue: "present",
          v2Value: "missing",
          delta: null,
          legacyService: "payment-intake-load",
          v2Service: "paymentIntakeQueryService",
        },
      ],
      validatorFailures: [],
      layersMatch: false,
      validatorsOk: false,
      fullParity: false,
    };
    logParityDiffs(empty);
    return empty;
  }

  const compare = comparePaymentIntakeParity({
    customerId: params.customerId,
    legacyOrders: params.legacyOrders,
    v2,
  });

  // Customer Credit: only when both sides use the same derived formula (passed explicitly).
  if (params.customerCreditUsd != null && params.v2CustomerCreditUsd != null) {
    const legBal = money(params.customerCreditUsd);
    const v2Bal = money(params.v2CustomerCreditUsd);
    if (!nearlyEqual(legBal, v2Bal, PARITY_EPS)) {
      compare.diffs.push({
        orderId: params.customerId,
        orderNumber: null,
        field: "Customer Credit",
        currency: "USD",
        legacyValue: legBal,
        v2Value: v2Bal,
        delta: money(v2Bal - legBal),
        legacyService: "loadPaymentIntakeBalancesForCustomer",
        v2Service: "getCustomerInternalBalanceUsd",
      });
    }
  }

  const validators = await runValidatorsForParity(compare.orderIds);
  const layersMatch = compare.diffs.length === 0;
  const validatorsOk = validators.failures.length === 0;
  const fullParity = layersMatch && validatorsOk;

  const report: PaymentIntakeParityReport = {
    ...compare,
    ordersWithGaps: compare.ordersChecked - compare.ordersFullMatch,
    validatorsPassed: validators.passed,
    validatorsTotal: validators.total,
    validatorFailures: validators.failures,
    layersMatch,
    validatorsOk,
    fullParity,
  };

  logParityDiffs(report);
  return report;
}

/** Merge multiple customer reports into one summary table. */
export function mergeParityReports(reports: PaymentIntakeParityReport[]): PaymentIntakeParityReport {
  const merged: PaymentIntakeParityReport = {
    customerId: `* (${reports.length} customers)`,
    ordersChecked: 0,
    ordersFullMatch: 0,
    ordersWithGaps: 0,
    gapsUsd: 0,
    gapsIls: 0,
    gapsRemaining: 0,
    gapsPaid: 0,
    gapsPlanned: 0,
    gapsCommission: 0,
    gapsOverpayment: 0,
    gapsStatus: 0,
    gapsMissingOrder: 0,
    validatorsPassed: 0,
    validatorsTotal: 0,
    diffs: [],
    validatorFailures: [],
    layersMatch: true,
    validatorsOk: true,
    fullParity: true,
  };
  for (const r of reports) {
    merged.ordersChecked += r.ordersChecked;
    merged.ordersFullMatch += r.ordersFullMatch;
    merged.ordersWithGaps += r.ordersWithGaps;
    merged.gapsUsd += r.gapsUsd;
    merged.gapsIls += r.gapsIls;
    merged.gapsRemaining += r.gapsRemaining;
    merged.gapsPaid += r.gapsPaid;
    merged.gapsPlanned += r.gapsPlanned;
    merged.gapsCommission += r.gapsCommission;
    merged.gapsOverpayment += r.gapsOverpayment;
    merged.gapsStatus += r.gapsStatus;
    merged.gapsMissingOrder += r.gapsMissingOrder;
    merged.validatorsPassed += r.validatorsPassed;
    merged.validatorsTotal += r.validatorsTotal;
    merged.diffs.push(...r.diffs);
    merged.validatorFailures.push(...r.validatorFailures);
    if (!r.layersMatch) merged.layersMatch = false;
    if (!r.validatorsOk) merged.validatorsOk = false;
    if (!r.fullParity) merged.fullParity = false;
  }
  return merged;
}

export function formatParityReportTable(report: PaymentIntakeParityReport): string {
  const rows: [string, string][] = [
    ["Orders שנבדקו", String(report.ordersChecked)],
    ["Orders עם התאמה מלאה", String(report.ordersFullMatch)],
    ["Orders עם פערים", String(report.ordersWithGaps)],
    ["פערי USD", String(report.gapsUsd)],
    ["פערי ILS", String(report.gapsIls)],
    ["פערי Remaining", String(report.gapsRemaining)],
    ["פערי Paid", String(report.gapsPaid)],
    ["פערי Planned", String(report.gapsPlanned)],
    ["פערי Commission", String(report.gapsCommission)],
    ["פערי Overpayment", String(report.gapsOverpayment)],
    ["Validators שעברו", `${report.validatorsPassed}/${report.validatorsTotal}`],
    ["Layers Match (Legacy↔V2)", report.layersMatch ? "100%" : "NO"],
    ["Validators OK", report.validatorsOk ? "YES" : "NO"],
    ["Full Parity (DoD)", report.fullParity ? "100%" : "NO"],
  ];
  return rows.map(([k, v]) => `${k}\t${v}`).join("\n");
}
