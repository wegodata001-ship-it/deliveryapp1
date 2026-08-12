import { prisma } from "@/lib/prisma";
import { getAhWeekByDate, listWeekDayYmds, formatAhWeekLabel, getCurrentAhWeek } from "@/lib/weeks/ah-week";
import type { WorkCountryCode } from "@/lib/work-country";
import {
  shipmentCashDayWhere,
  shipmentRecordWhere,
} from "@/lib/shipment-country-scope";
import {
  addShipmentPayment,
  getShipmentRecordById,
} from "@/app/admin/shipments/service";
import {
  CASH_CONTROL_METHODS,
  CASH_CONTROL_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type AddPaymentInput,
  type CashControlMethodValue,
  type PaymentMethodValue,
} from "@/app/admin/shipments/types";
import { normalizePaymentMethodId } from "@/lib/payment-method-slugs";
import {
  buildMethodLine,
  computeCashDaySummary,
  computeRowRemaining,
  deriveFeePaymentStatus,
  isManualMethod,
  round2,
} from "@/app/admin/shipments/cash-control/ssot";
import {
  SHIPMENT_CASH_EXPENSE_LABELS,
  type CashControlDayRow,
  type CashControlWeekPayload,
  type CashDrilldownExpenseRow,
  type CashDrilldownPayload,
  type CashDrilldownPaymentRow,
  type ShipmentCashControlFilter,
  type ShipmentCashControlPayload,
  type ShipmentCashControlRow,
  type ShipmentCashDayDto,
  type ShipmentCashExpenseCategory,
  type ShipmentCashExpenseDto,
  type ShipmentCashHistoryEntry,
} from "@/app/admin/shipments/cash-control/types";

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function toYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function parseDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function weekCodeFromDates(shipping: string | null, arrival: string | null): string | null {
  const ymd = (shipping ?? arrival)?.slice(0, 10);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return getAhWeekByDate(new Date(Date.UTC(y, m - 1, d, 12))).code;
}

function mapDay(day: {
  id: string;
  dayDate: Date;
  status: string;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
}): ShipmentCashDayDto {
  return {
    id: day.id,
    dayDate: toYmd(day.dayDate)!,
    status: day.status as "OPEN" | "CLOSED",
    notes: day.notes,
    openedAt: day.openedAt.toISOString(),
    closedAt: day.closedAt?.toISOString() ?? null,
  };
}

async function writeAudit(input: {
  userId: string;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValue: input.oldValue as never,
      newValue: input.newValue as never,
      metadata: input.metadata as never,
    },
  });
}

// ─── Day Session Management ───────────────────────────────────────────────────

export async function findActiveOpenShipmentCashDay(
  workCountry: WorkCountryCode,
): Promise<ShipmentCashDayDto | null> {
  const open = await prisma.shipmentCashDay.findFirst({
    where: { status: "OPEN", ...shipmentCashDayWhere(workCountry) },
    orderBy: { dayDate: "desc" },
  });
  return open ? mapDay(open) : null;
}

export async function getOrOpenShipmentCashDay(
  dayDate: string,
  openedById: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentCashDayDto> {
  const activeOpen = await findActiveOpenShipmentCashDay(workCountry);
  if (activeOpen) return activeOpen;

  const date = parseDayStart(dayDate);
  const existing = await prisma.shipmentCashDay.findUnique({
    where: { countryCode_dayDate: { countryCode: workCountry, dayDate: date } },
  });
  if (existing) {
    if (existing.status === "CLOSED") {
      const reopened = await prisma.shipmentCashDay.update({
        where: { id: existing.id },
        data: { status: "OPEN", openedById, openedAt: new Date(), closedAt: null, closedById: null },
      });
      await writeAudit({ userId: openedById, actionType: "SHIPMENT_CASH_DAY_REOPEN", entityType: "ShipmentCashDay", entityId: reopened.id, newValue: { dayDate, status: "OPEN" } });
      return mapDay(reopened);
    }
    return mapDay(existing);
  }

  const created = await prisma.shipmentCashDay.create({
    data: { countryCode: workCountry, dayDate: date, status: "OPEN", openedById },
  });
  await writeAudit({ userId: openedById, actionType: "SHIPMENT_CASH_DAY_OPEN", entityType: "ShipmentCashDay", entityId: created.id, newValue: { dayDate, status: "OPEN" } });
  return mapDay(created);
}

export async function closeShipmentCashDay(
  dayDate: string,
  closedById: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentCashDayDto> {
  const date = parseDayStart(dayDate);
  const day = await prisma.shipmentCashDay.findUnique({
    where: { countryCode_dayDate: { countryCode: workCountry, dayDate: date } },
  });
  if (!day) throw new Error("יום העבודה לא נמצא — יש לפתוח יום תחילה");
  if (day.status === "CLOSED") return mapDay(day);
  const updated = await prisma.shipmentCashDay.update({
    where: { id: day.id },
    data: { status: "CLOSED", closedById, closedAt: new Date() },
  });
  await writeAudit({ userId: closedById, actionType: "SHIPMENT_CASH_DAY_CLOSE", entityType: "ShipmentCashDay", entityId: updated.id, oldValue: { status: "OPEN" }, newValue: { status: "CLOSED", dayDate } });
  return mapDay(updated);
}

export async function reopenShipmentCashDay(
  dayDate: string,
  userId: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentCashDayDto> {
  const active = await findActiveOpenShipmentCashDay(workCountry);
  if (active && active.dayDate !== dayDate) {
    throw new Error(`כבר קיים יום עבודה פתוח בתאריך ${active.dayDate}. יש לסגור אותו לפני פתיחת יום אחר.`);
  }
  const date = parseDayStart(dayDate);
  const day = await prisma.shipmentCashDay.findUnique({
    where: { countryCode_dayDate: { countryCode: workCountry, dayDate: date } },
  });
  if (!day) throw new Error("יום העבודה לא נמצא");
  const updated = await prisma.shipmentCashDay.update({
    where: { id: day.id },
    data: { status: "OPEN", closedAt: null, closedById: null, openedById: userId, openedAt: new Date() },
  });
  await writeAudit({ userId, actionType: "SHIPMENT_CASH_DAY_REOPEN", entityType: "ShipmentCashDay", entityId: updated.id, newValue: { status: "OPEN", dayDate } });
  return mapDay(updated);
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function listShipmentCashExpenses(dayId: string): Promise<ShipmentCashExpenseDto[]> {
  const expenses = await prisma.shipmentCashExpense.findMany({
    where: { dayId },
    orderBy: { createdAt: "desc" },
  });
  const userIds = [...new Set(expenses.map((e) => e.createdById).filter(Boolean))] as string[];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.fullName]));

  return expenses.map((e) => ({
    id: e.id,
    dayId: e.dayId,
    category: e.category as ShipmentCashExpenseCategory,
    categoryLabel: SHIPMENT_CASH_EXPENSE_LABELS[e.category as ShipmentCashExpenseCategory] ?? e.category,
    paymentMethod: e.paymentMethod,
    paymentMethodLabel: CASH_CONTROL_METHOD_LABELS[e.paymentMethod] ?? PAYMENT_METHOD_LABELS[e.paymentMethod] ?? e.paymentMethod,
    amountIls: e.amountIls.toNumber(),
    notes: e.notes,
    createdById: e.createdById,
    createdByName: e.createdById ? names.get(e.createdById) ?? null : null,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function addShipmentCashExpense(input: {
  dayDate: string;
  category: ShipmentCashExpenseCategory;
  paymentMethod: string;
  amountIls: number;
  notes?: string | null;
  createdById: string;
  workCountry: WorkCountryCode;
}): Promise<ShipmentCashExpenseDto> {
  if (!Number.isFinite(input.amountIls) || input.amountIls <= 0) {
    throw new Error("סכום ההוצאה חייב להיות גדול מאפס");
  }
  if (!(input.category in SHIPMENT_CASH_EXPENSE_LABELS)) {
    throw new Error("קטגוריית הוצאה לא חוקית");
  }
  const day = await getOrOpenShipmentCashDay(input.dayDate, input.createdById, input.workCountry);
  if (day.status === "CLOSED") throw new Error("לא ניתן להוסיף הוצאה ליום סגור");

  const created = await prisma.shipmentCashExpense.create({
    data: {
      dayId: day.id,
      category: input.category,
      paymentMethod: input.paymentMethod || "CASH",
      amountIls: input.amountIls,
      notes: input.notes?.trim() || null,
      createdById: input.createdById,
    },
  });
  await writeAudit({
    userId: input.createdById,
    actionType: "SHIPMENT_CASH_EXPENSE_ADD",
    entityType: "ShipmentCashExpense",
    entityId: created.id,
    newValue: { dayDate: input.dayDate, category: input.category, paymentMethod: input.paymentMethod, amountIls: input.amountIls, notes: input.notes ?? null },
  });

  const list = await listShipmentCashExpenses(day.id);
  return list.find((e) => e.id === created.id)!;
}

export async function deleteShipmentCashExpense(expenseId: string, userId: string): Promise<void> {
  const expense = await prisma.shipmentCashExpense.findUnique({ where: { id: expenseId }, include: { day: true } });
  if (!expense) throw new Error("ההוצאה לא נמצאה");
  if (expense.day.status === "CLOSED") throw new Error("לא ניתן למחוק הוצאה מיום סגור");
  await prisma.shipmentCashExpense.delete({ where: { id: expenseId } });
  await writeAudit({ userId, actionType: "SHIPMENT_CASH_EXPENSE_DELETE", entityType: "ShipmentCashExpense", entityId: expenseId, oldValue: { category: expense.category, paymentMethod: expense.paymentMethod, amountIls: expense.amountIls.toNumber(), notes: expense.notes } });
}

// ─── Payment Intake ───────────────────────────────────────────────────────────

export async function intakeShipmentFeePayment(input: {
  shipmentRecordId: string;
  amountIls: number;
  method: PaymentMethodValue;
  paymentDate?: string | null;
  notes?: string | null;
  allowOverpay?: boolean;
  createdById: string;
  isAdmin: boolean;
  workCountry: WorkCountryCode;
}): Promise<ShipmentCashControlRow> {
  if (!Number.isFinite(input.amountIls) || input.amountIls <= 0) throw new Error("סכום הקליטה חייב להיות גדול מאפס");
  const activeOpen = await findActiveOpenShipmentCashDay(input.workCountry);
  if (!activeOpen) throw new Error("אין יום עבודה פתוח — יש לפתוח יום עבודה לפני קליטת כסף");

  const record = await prisma.shipmentRecord.findFirstOrThrow({
    where: { id: input.shipmentRecordId, ...shipmentRecordWhere(input.workCountry) },
    select: { id: true, deliveryFeeIls: true, paymentStatus: true, payments: { select: { amountIls: true } } },
  });
  const fee = record.deliveryFeeIls?.toNumber() ?? 0;
  const paid = record.payments.reduce((s, p) => s + p.amountIls.toNumber(), 0);
  const remaining = computeRowRemaining(fee, paid);
  const overpay = input.amountIls - remaining > 0.001;

  if (overpay && (!input.allowOverpay || !input.isAdmin)) {
    throw new Error(`הסכום חורג מהיתרה הפתוחה (₪${remaining.toFixed(2)}). נדרש אישור מנהל לקליטה מעבר ליתרה.`);
  }

  if (overpay && input.allowOverpay && input.isAdmin) {
    const newPaid = paid + input.amountIls;
    await prisma.$transaction(async (tx) => {
      await tx.shipmentPaymentLine.create({
        data: { shipmentRecordId: input.shipmentRecordId, method: input.method, amountIls: input.amountIls, detailsJson: input.paymentDate ? JSON.stringify({ paymentDate: input.paymentDate }) : null, notes: input.notes?.trim() || null, createdById: input.createdById },
      });
      await tx.shipmentRecord.update({ where: { id: input.shipmentRecordId }, data: { paymentStatus: deriveFeePaymentStatus(fee, newPaid) } });
    });
  } else {
    const paymentInput: AddPaymentInput = {
      shipmentRecordId: input.shipmentRecordId,
      lines: [{ method: input.method, amountIls: input.amountIls, notes: input.notes ?? undefined, details: input.paymentDate ? { paymentDate: input.paymentDate } : undefined }],
    };
    await addShipmentPayment(paymentInput, input.createdById, input.workCountry);
  }

  const newPaid = paid + input.amountIls;
  await writeAudit({
    userId: input.createdById, actionType: "SHIPMENT_FEE_INTAKE", entityType: "ShipmentRecord", entityId: input.shipmentRecordId,
    oldValue: { paidAmountIls: paid, remainingFeeIls: remaining, paymentStatus: record.paymentStatus },
    newValue: { amountIls: input.amountIls, method: input.method, paymentDate: input.paymentDate ?? null, notes: input.notes ?? null, paidAmountIls: newPaid, remainingFeeIls: computeRowRemaining(fee, newPaid), paymentStatus: deriveFeePaymentStatus(fee, newPaid), cashDayId: activeOpen.id, cashDayDate: activeOpen.dayDate },
  });

  const updated = await getShipmentRecordById(input.shipmentRecordId, input.workCountry);
  if (!updated) throw new Error("המשלוח לא נמצא לאחר הקליטה");
  return toRow(updated);
}

// ─── Aggregation Helpers ──────────────────────────────────────────────────────

function paymentLineYmd(p: { createdAt: Date; detailsJson: string | null }): string {
  if (p.detailsJson) {
    try {
      const parsed = JSON.parse(p.detailsJson) as { paymentDate?: string };
      const fromDetails = parsed?.paymentDate?.trim().slice(0, 10);
      if (fromDetails && /^\d{4}-\d{2}-\d{2}$/.test(fromDetails)) return fromDetails;
    } catch { /* ignore */ }
  }
  return p.createdAt.toISOString().slice(0, 10);
}

/** Aggregate payment lines for a single day → method → totalIls */
async function aggregateCollectedByMethod(
  dayDate: string,
  workCountry: WorkCountryCode,
): Promise<Map<string, number>> {
  const dayStart = parseDayStart(dayDate);
  const windowStart = new Date(dayStart.getTime() - 14 * 86400000);
  const windowEnd = new Date(dayStart.getTime() + 15 * 86400000);

  const payments = await prisma.shipmentPaymentLine.findMany({
    where: {
      createdAt: { gte: windowStart, lt: windowEnd },
      shipment: shipmentRecordWhere(workCountry),
    },
    select: { method: true, amountIls: true, createdAt: true, detailsJson: true },
  });

  const byMethod = new Map<string, number>();
  for (const p of payments) {
    if (paymentLineYmd(p) !== dayDate) continue;
    const method = normalizePaymentMethodId(p.method);
    const amount = p.amountIls.toNumber();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    byMethod.set(method, round2((byMethod.get(method) ?? 0) + amount));
  }
  return byMethod;
}

/** Aggregate payment lines for a range of dates → dayDate → method → totalIls */
async function aggregateCollectedByMethodForRange(
  fromDate: string,
  toDate: string,
  workCountry: WorkCountryCode,
): Promise<Map<string, Map<string, number>>> {
  const start = parseDayStart(fromDate);
  const end = new Date(parseDayStart(toDate).getTime() + 86400000);

  const payments = await prisma.shipmentPaymentLine.findMany({
    where: {
      createdAt: { gte: new Date(start.getTime() - 14 * 86400000), lt: new Date(end.getTime() + 14 * 86400000) },
      shipment: shipmentRecordWhere(workCountry),
    },
    select: { method: true, amountIls: true, createdAt: true, detailsJson: true },
  });

  const result = new Map<string, Map<string, number>>();
  for (const p of payments) {
    const ymd = paymentLineYmd(p);
    if (ymd < fromDate || ymd > toDate) continue;
    const method = normalizePaymentMethodId(p.method);
    const amount = p.amountIls.toNumber();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!result.has(ymd)) result.set(ymd, new Map());
    const dayMap = result.get(ymd)!;
    dayMap.set(method, round2((dayMap.get(method) ?? 0) + amount));
  }
  return result;
}

/** Aggregate expenses for a date range → dayDate → method → totalIls */
async function aggregateExpensesByMethodForRange(
  fromDate: string,
  toDate: string,
  workCountry: WorkCountryCode,
): Promise<Map<string, Map<string, number>>> {
  const start = parseDayStart(fromDate);
  const end = new Date(parseDayStart(toDate).getTime() + 86400000);

  const days = await prisma.shipmentCashDay.findMany({
    where: { dayDate: { gte: start, lt: end }, ...shipmentCashDayWhere(workCountry) },
    include: { expenses: { select: { paymentMethod: true, amountIls: true } } },
  });

  const result = new Map<string, Map<string, number>>();
  for (const day of days) {
    const ymd = toYmd(day.dayDate)!;
    const methodMap = new Map<string, number>();
    for (const e of day.expenses) {
      const method = e.paymentMethod || "CASH";
      methodMap.set(method, round2((methodMap.get(method) ?? 0) + e.amountIls.toNumber()));
    }
    if (methodMap.size > 0) result.set(ymd, methodMap);
  }
  return result;
}

/** Map cash-control methods with their collected/counted/expenses for a given method → expensesIls */
function mapMethodExpenses(
  expenses: Array<{ paymentMethod: string; amountIls: { toNumber(): number } }>,
): Map<string, number> {
  const byMethod = new Map<string, number>();
  for (const e of expenses) {
    const method = e.paymentMethod || "CASH";
    byMethod.set(method, round2((byMethod.get(method) ?? 0) + e.amountIls.toNumber()));
  }
  return byMethod;
}

// ─── Load Day View (existing main function, upgraded) ─────────────────────────

export async function loadShipmentCashControl(
  filter: ShipmentCashControlFilter,
): Promise<ShipmentCashControlPayload> {
  const workCountry = filter.workCountry;
  const activeOpenDay = await findActiveOpenShipmentCashDay(workCountry);
  const dayDate = filter.dayDate?.trim() || activeOpenDay?.dayDate || toYmd(new Date())!;

  const dayRow = await prisma.shipmentCashDay.findUnique({
    where: { countryCode_dayDate: { countryCode: workCountry, dayDate: parseDayStart(dayDate) } },
    include: { counts: true, expenses: { select: { paymentMethod: true, amountIls: true } } },
  });
  const day = dayRow ? mapDay(dayRow) : null;

  const collectedByMethod = await aggregateCollectedByMethod(dayDate, workCountry);
  const countedByMethod = new Map((dayRow?.counts ?? []).map((c) => [c.method, c.countedIls.toNumber()]));
  const expensesByMethod = dayRow ? mapMethodExpenses(dayRow.expenses) : new Map<string, number>();

  const methods = CASH_CONTROL_METHODS.map((m) =>
    buildMethodLine({
      method: m.value,
      label: m.label,
      collectedIls: collectedByMethod.get(m.value) ?? 0,
      countedIls: countedByMethod.has(m.value) ? countedByMethod.get(m.value)! : null,
      expensesIls: expensesByMethod.get(m.value) ?? 0,
      isManual: !m.auto,
    }),
  );

  const expenses = day ? await listShipmentCashExpenses(day.id) : [];
  const summary = computeCashDaySummary(methods);

  return { day, activeOpenDay, dayDate, methods, expenses, summary };
}

// ─── Load Week View ───────────────────────────────────────────────────────────

export async function loadShipmentCashWeek(
  weekCode: string,
  workCountry: WorkCountryCode,
): Promise<CashControlWeekPayload> {
  const dayYmds = listWeekDayYmds(weekCode);
  if (dayYmds.length === 0) throw new Error("קוד שבוע לא תקין");

  const fromDate = dayYmds[0];
  const toDate = dayYmds[dayYmds.length - 1];

  const [collectedRange, expensesRange] = await Promise.all([
    aggregateCollectedByMethodForRange(fromDate, toDate, workCountry),
    aggregateExpensesByMethodForRange(fromDate, toDate, workCountry),
  ]);

  const cashDays = await prisma.shipmentCashDay.findMany({
    where: {
      dayDate: { gte: parseDayStart(fromDate), lte: parseDayStart(toDate) },
      ...shipmentCashDayWhere(workCountry),
    },
    include: { counts: true },
  });
  const dayStatusMap = new Map(cashDays.map((d) => [toYmd(d.dayDate)!, d.status as "OPEN" | "CLOSED"]));
  const dayCountsMap = new Map(cashDays.map((d) => [toYmd(d.dayDate)!, new Map(d.counts.map((c) => [c.method, c.countedIls.toNumber()]))]));

  const totalByMethod: Record<string, number> = {};
  const totalExpensesByMethod: Record<string, number> = {};
  let totalCollected = 0;
  let totalExpenses = 0;

  const days: CashControlDayRow[] = dayYmds.map((ymd, idx) => {
    const dayCollected = collectedRange.get(ymd) ?? new Map<string, number>();
    const dayExpenses = expensesRange.get(ymd) ?? new Map<string, number>();
    const dayStatus = dayStatusMap.get(ymd) ?? null;
    const dayCounts = dayCountsMap.get(ymd) ?? new Map<string, number>();

    const byMethod: Record<string, number> = {};
    const expByMethod: Record<string, number> = {};
    const countedByMethod: Record<string, number | null> = {};
    const differenceByMethod: Record<string, number> = {};
    let dayTotal = 0;
    let dayExp = 0;

    for (const m of CASH_CONTROL_METHODS) {
      const collected = dayCollected.get(m.value) ?? 0;
      const exp = dayExpenses.get(m.value) ?? 0;
      byMethod[m.value] = collected;
      expByMethod[m.value] = exp;
      countedByMethod[m.value] = dayCounts.has(m.value) ? dayCounts.get(m.value)! : null;
      differenceByMethod[m.value] = countedByMethod[m.value] != null ? round2(countedByMethod[m.value]! - collected) : 0;
      dayTotal += collected;
      dayExp += exp;
      totalByMethod[m.value] = round2((totalByMethod[m.value] ?? 0) + collected);
      totalExpensesByMethod[m.value] = round2((totalExpensesByMethod[m.value] ?? 0) + exp);
    }

    totalCollected += dayTotal;
    totalExpenses += dayExp;

    return {
      dayDate: ymd,
      dayLabel: HE_DAYS[idx % 7] ?? `יום ${idx + 1}`,
      dayStatus,
      byMethod,
      expensesByMethod: expByMethod,
      totalCollected: round2(dayTotal),
      totalExpenses: round2(dayExp),
      totalBalance: round2(dayTotal - dayExp),
      countedByMethod,
      differenceByMethod,
    };
  });

  return {
    weekCode,
    weekLabel: formatAhWeekLabel(weekCode) ?? weekCode,
    days,
    totalByMethod,
    totalExpensesByMethod,
    totalCollected: round2(totalCollected),
    totalExpenses: round2(totalExpenses),
    totalBalance: round2(totalCollected - totalExpenses),
  };
}

// ─── Drill-down ───────────────────────────────────────────────────────────────

export async function drilldownPayments(
  dayDate: string,
  method: string,
  workCountry: WorkCountryCode,
): Promise<CashDrilldownPayload> {
  const dayStart = parseDayStart(dayDate);
  const windowStart = new Date(dayStart.getTime() - 14 * 86400000);
  const windowEnd = new Date(dayStart.getTime() + 15 * 86400000);

  const payments = await prisma.shipmentPaymentLine.findMany({
    where: {
      createdAt: { gte: windowStart, lt: windowEnd },
      method: normalizePaymentMethodId(method),
      shipment: shipmentRecordWhere(workCountry),
    },
    include: { shipment: { select: { customerName: true, customerCode: true, batch: { select: { batchNumber: true, containerNumber: true, sourceShipmentNumber: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  const rows: CashDrilldownPaymentRow[] = [];
  let totalIls = 0;

  for (const p of payments) {
    if (paymentLineYmd(p) !== dayDate) continue;
    const amount = p.amountIls.toNumber();
    const batch = p.shipment.batch;
    rows.push({
      id: p.id,
      shipmentLabel: batch?.containerNumber || batch?.sourceShipmentNumber || batch?.batchNumber || "—",
      customerName: p.shipment.customerName,
      amountIls: amount,
      time: p.createdAt.toISOString().slice(11, 16),
      method: p.method,
      methodLabel: CASH_CONTROL_METHOD_LABELS[p.method] ?? PAYMENT_METHOD_LABELS[p.method] ?? p.method,
    });
    totalIls += amount;
  }

  return {
    type: "receipts",
    dayDate,
    method,
    methodLabel: CASH_CONTROL_METHOD_LABELS[method] ?? PAYMENT_METHOD_LABELS[method] ?? method,
    rows,
    totalIls: round2(totalIls),
  };
}

export async function drilldownExpenses(
  dayDate: string,
  method: string,
  workCountry: WorkCountryCode,
): Promise<CashDrilldownPayload> {
  const dayRow = await prisma.shipmentCashDay.findUnique({
    where: { countryCode_dayDate: { countryCode: workCountry, dayDate: parseDayStart(dayDate) } },
    include: { expenses: { where: { paymentMethod: method }, orderBy: { createdAt: "asc" } } },
  });

  const rows: CashDrilldownExpenseRow[] = [];
  let totalIls = 0;

  if (dayRow) {
    for (const e of dayRow.expenses) {
      const amount = e.amountIls.toNumber();
      rows.push({
        id: e.id,
        category: e.category,
        categoryLabel: SHIPMENT_CASH_EXPENSE_LABELS[e.category as ShipmentCashExpenseCategory] ?? e.category,
        amountIls: amount,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
      });
      totalIls += amount;
    }
  }

  return {
    type: "expenses",
    dayDate,
    method,
    methodLabel: CASH_CONTROL_METHOD_LABELS[method] ?? PAYMENT_METHOD_LABELS[method] ?? method,
    rows,
    totalIls: round2(totalIls),
  };
}

// ─── Save Counts ──────────────────────────────────────────────────────────────

export async function saveShipmentCashCounts(input: {
  dayDate: string;
  counts: Array<{ method: string; countedIls: number }>;
  createdById: string;
  workCountry: WorkCountryCode;
}): Promise<ShipmentCashControlPayload> {
  const day = await getOrOpenShipmentCashDay(input.dayDate, input.createdById, input.workCountry);
  if (day.status === "CLOSED") throw new Error("לא ניתן לעדכן ספירה ביום סגור — יש לפתוח מחדש");

  for (const row of input.counts) {
    const method = normalizePaymentMethodId(row.method);
    const amount = round2(Number(row.countedIls));
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`סכום לא תקין עבור ${method}`);
    await prisma.shipmentCashCount.upsert({
      where: { dayId_method: { dayId: day.id, method } },
      create: { dayId: day.id, method, countedIls: amount, createdById: input.createdById },
      update: { countedIls: amount },
    });
  }

  await writeAudit({ userId: input.createdById, actionType: "SHIPMENT_CASH_COUNT_SAVE", entityType: "ShipmentCashDay", entityId: day.id, newValue: { dayDate: day.dayDate, counts: input.counts } });
  return loadShipmentCashControl({ dayDate: day.dayDate, workCountry: input.workCountry });
}

// ─── Save Manual Collected (CREDIT_NOTE) ──────────────────────────────────────

export async function saveManualCollected(input: {
  dayDate: string;
  method: string;
  amountIls: number;
  createdById: string;
  workCountry: WorkCountryCode;
}): Promise<ShipmentCashControlPayload> {
  if (!isManualMethod(input.method)) throw new Error("אמצעי תשלום זה אינו ידני");
  const day = await getOrOpenShipmentCashDay(input.dayDate, input.createdById, input.workCountry);
  if (day.status === "CLOSED") throw new Error("לא ניתן לעדכן ביום סגור");
  const amount = round2(Number(input.amountIls));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("סכום לא תקין");

  await prisma.shipmentCashCount.upsert({
    where: { dayId_method: { dayId: day.id, method: input.method } },
    create: { dayId: day.id, method: input.method, countedIls: amount, createdById: input.createdById },
    update: { countedIls: amount },
  });

  await writeAudit({ userId: input.createdById, actionType: "SHIPMENT_CASH_MANUAL_COLLECTED", entityType: "ShipmentCashDay", entityId: day.id, newValue: { dayDate: input.dayDate, method: input.method, amountIls: amount } });
  return loadShipmentCashControl({ dayDate: input.dayDate, workCountry: input.workCountry });
}

// ─── History ──────────────────────────────────────────────────────────────────

const HISTORY_ACTION_LABELS: Record<string, string> = {
  SHIPMENT_FEE_INTAKE: "קליטת כסף",
  SHIPMENT_CASH_EXPENSE_ADD: "הוספת הוצאה",
  SHIPMENT_CASH_EXPENSE_DELETE: "מחיקת הוצאה",
  SHIPMENT_CASH_DAY_OPEN: "פתיחת יום עבודה",
  SHIPMENT_CASH_DAY_CLOSE: "סגירת יום עבודה",
  SHIPMENT_CASH_DAY_REOPEN: "פתיחה מחדש של יום",
};

export async function loadShipmentCashHistory(shipmentRecordId: string): Promise<ShipmentCashHistoryEntry[]> {
  const [payments, audits] = await Promise.all([
    prisma.shipmentPaymentLine.findMany({ where: { shipmentRecordId }, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.findMany({
      where: { OR: [{ entityType: "ShipmentRecord", entityId: shipmentRecordId }, { actionType: { in: Object.keys(HISTORY_ACTION_LABELS) }, entityId: shipmentRecordId }] },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const userIds = new Set<string>();
  for (const p of payments) if (p.createdById) userIds.add(p.createdById);
  for (const a of audits) if (a.userId) userIds.add(a.userId);
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.fullName]));

  const entries: ShipmentCashHistoryEntry[] = [];
  for (const p of payments) {
    entries.push({ id: `pay-${p.id}`, at: p.createdAt.toISOString(), actionType: "SHIPMENT_FEE_INTAKE", actionLabel: "קליטת כסף", userName: p.createdById ? names.get(p.createdById) ?? null : null, amountIls: p.amountIls.toNumber(), notes: p.notes, detail: PAYMENT_METHOD_LABELS[p.method] ?? p.method });
  }
  for (const a of audits) {
    if (a.actionType === "SHIPMENT_FEE_INTAKE") continue;
    const newVal = (a.newValue ?? {}) as Record<string, unknown>;
    entries.push({ id: `audit-${a.id}`, at: a.createdAt.toISOString(), actionType: a.actionType, actionLabel: HISTORY_ACTION_LABELS[a.actionType] ?? a.actionType, userName: a.userId ? names.get(a.userId) ?? null : null, amountIls: typeof newVal.amountIls === "number" ? newVal.amountIls : null, notes: typeof newVal.notes === "string" ? newVal.notes : null, detail: typeof newVal.category === "string" ? (SHIPMENT_CASH_EXPENSE_LABELS[newVal.category as ShipmentCashExpenseCategory] ?? String(newVal.category)) : typeof newVal.dayDate === "string" ? `יום ${newVal.dayDate}` : null });
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  return entries;
}

// ─── Legacy helpers ───────────────────────────────────────────────────────────

function toRow(r: Awaited<ReturnType<typeof getShipmentRecordById>> & object): ShipmentCashControlRow {
  const record = r!;
  const shippingDate = record.shippingDate ?? null;
  const arrivalDate = record.arrivalDate ?? null;
  const fee = record.deliveryFeeIls ?? record.deliveryFeeAmount ?? 0;
  const paid = record.paidAmountIls;
  return {
    id: record.id, batchId: record.batchId, batchNumber: record.batchNumber,
    shipmentLabel: record.containerNumber || record.sourceShipmentNumber || record.batchNumber,
    weekCode: record.weekCode ?? weekCodeFromDates(shippingDate, arrivalDate),
    shippingDate, arrivalDate, customerName: record.customerName, courierId: record.courierId,
    courierName: record.courierName, zoneId: record.zoneId, zoneName: record.zoneName, country: null,
    boxes: record.boxes, deliveryFeeIls: fee, paidAmountIls: paid,
    remainingFeeIls: computeRowRemaining(fee, paid), paymentStatus: deriveFeePaymentStatus(fee, paid),
    status: record.status, notes: record.notes, payments: record.payments,
  };
}
