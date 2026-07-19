import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { fileKindOf } from "@/lib/documents/constants";
import { fixCashUsd, CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import {
  aggregateDailyIntakes,
  buildDailyReconciliation,
  channelCurrency,
  computeDailyStatus,
  dayNameHe,
  emptyDailyExpenses,
  emptyDailyIntake,
  formatDailyDateDisplay,
  getDailyPaymentContributions,
  paymentAmountForDailyColumn,
  paymentDayKeyJerusalem,
  paymentMatchesDailyColumn,
  sumIlsChannelIntake,
  type CashDailyDrawerValues,
  type CashDailyExpenseTotals,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import { formatAhWeekLabel, formatYmdJerusalem, getAhWeekRange, listWeekDayYmds } from "@/lib/weeks/ah-week";
import {
  allCashControlChannels,
  CHANNEL_DRAWER_FIELD,
} from "@/lib/cash-control-channel";
import {
  addExpenseToMethodTotals,
  aggregateExpensesByMethod,
  expensesCurrencyTotals,
  normalizePaymentMethod,
  paymentMethodLabel,
} from "@/lib/cash-expense-payment-method";
import { CASH_EXPENSE_REASONS } from "@/app/admin/cash-control/constants";
import type {
  CashDailyDayDetailPayload,
  CashDailyExpenseRowDto,
  CashDailyMethodDetailRow,
  CashDailyPaymentRowDto,
  CashDailySummaryRowDto,
  CashDailyWeekSummaryPayload,
} from "@/app/admin/cash-control/daily-types";

/** לוגיקת בקרת קופה יומית — ללא "use server" (נקרא מקבצי action דקים). */

export type PaymentDocumentHint = {
  hasDocument: boolean;
  documentPreviewable: boolean;
  previewDocumentId: string | null;
};

async function loadPaymentDocumentHints(paymentIds: string[]): Promise<Map<string, PaymentDocumentHint>> {
  const map = new Map<string, PaymentDocumentHint>();
  if (paymentIds.length === 0) return map;

  await ensureDocumentsTable();
  const docs = await prisma.document.findMany({
    where: { entityType: "PAYMENT", entityId: { in: paymentIds }, deletedAt: null },
    select: { id: true, entityId: true, fileName: true, mimeType: true },
    orderBy: { createdAt: "asc" },
  });

  for (const d of docs) {
    let hint = map.get(d.entityId);
    if (!hint) {
      const kind = fileKindOf(d.fileName, d.mimeType);
      const previewable = kind === "pdf" || kind === "image";
      hint = {
        hasDocument: true,
        documentPreviewable: previewable,
        previewDocumentId: previewable ? d.id : null,
      };
      map.set(d.entityId, hint);
      continue;
    }
    if (!hint.previewDocumentId) {
      const kind = fileKindOf(d.fileName, d.mimeType);
      if (kind === "pdf" || kind === "image") {
        hint.documentPreviewable = true;
        hint.previewDocumentId = d.id;
      }
    }
  }
  return map;
}

function emptyDocumentHint(): PaymentDocumentHint {
  return { hasDocument: false, documentPreviewable: false, previewDocumentId: null };
}


const EXPENSE_REASON_LABEL: Record<string, string> = Object.fromEntries(
  CASH_EXPENSE_REASONS.map((r) => [r.value, r.label]),
);

export const CASH_CONTROL_COUNTRY_LABEL = "טורקיה";

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function formatCountTimeHm(d: Date): string {
  return d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  });
}

function countMetaFromDrawerRow(
  row: { updatedAt: Date; updatedBy: { fullName: string | null } | null } | null | undefined,
): { countSaved: boolean; countedAtHm: string | null; countedByName: string | null } {
  if (!row) return { countSaved: false, countedAtHm: null, countedByName: null };
  return {
    countSaved: true,
    countedAtHm: formatCountTimeHm(row.updatedAt),
    countedByName: row.updatedBy?.fullName ?? null,
  };
}

export function dec(v: number | string | null | undefined): Prisma.Decimal | null {
  if (v == null || v === "") return null;
  try {
    const d = new Prisma.Decimal(typeof v === "number" ? v : String(v).replace(",", "."));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function numDec(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function intakeToDto(intake: CashDailyIntakeTotals): Record<CashDailyMethodId, string> {
  return Object.fromEntries(
    allCashControlChannels().map((id) => [id, money(intake[id] ?? 0)]),
  ) as Record<CashDailyMethodId, string>;
}

function sumIntake(a: CashDailyIntakeTotals, b: CashDailyIntakeTotals): CashDailyIntakeTotals {
  const out = emptyDailyIntake();
  for (const k of Object.keys(out) as CashDailyMethodId[]) {
    out[k] = Math.round((a[k] + b[k]) * 100) / 100;
  }
  return out;
}

function sumDrawer(a: CashDailyDrawerValues, b: CashDailyDrawerValues): CashDailyDrawerValues {
  const out: CashDailyDrawerValues = {};
  for (const k of allCashControlChannels()) {
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) continue;
    out[k] = Math.round(((av ?? 0) + (bv ?? 0)) * 100) / 100;
  }
  return out;
}

function aggregateWeekExpenses(
  rows: Array<{
    expenseDate: Date;
    currency: string;
    amount: Prisma.Decimal | null;
    paymentMethod?: string | null;
  }>,
): Map<string, CashDailyExpenseTotals> {
  const map = new Map<string, CashDailyExpenseTotals>();
  for (const r of rows) {
    const day = formatYmdJerusalem(r.expenseDate);
    let t = map.get(day);
    if (!t) {
      t = emptyDailyExpenses();
      map.set(day, t);
    }
    const amt = numDec(r.amount);
    t = addExpenseToMethodTotals(t, r.paymentMethod, r.currency === "USD" ? "USD" : "ILS", amt);
    map.set(day, t);
  }
  return map;
}

function drawerFromDb(row: {
  cashIls: Prisma.Decimal | null;
  cashUsd: Prisma.Decimal | null;
  checksIls: Prisma.Decimal | null;
  checksUsd?: Prisma.Decimal | null;
  creditIls: Prisma.Decimal | null;
  creditUsd?: Prisma.Decimal | null;
  transferIls: Prisma.Decimal | null;
  transferUsd?: Prisma.Decimal | null;
  otherIls?: Prisma.Decimal | null;
  otherUsd?: Prisma.Decimal | null;
} | null): CashDailyDrawerValues {
  if (!row) return {};
  const out: CashDailyDrawerValues = {};
  for (const channel of allCashControlChannels()) {
    const field = CHANNEL_DRAWER_FIELD[channel];
    const raw = row[field as keyof typeof row];
    out[channel] = raw != null ? numDec(raw as Prisma.Decimal) : null;
  }
  return out;
}

function drawerToDto(drawer: CashDailyDrawerValues): Partial<Record<CashDailyMethodId, string | null>> {
  return Object.fromEntries(
    allCashControlChannels().map((id) => [id, drawer[id] != null ? money(drawer[id]!) : null]),
  ) as Partial<Record<CashDailyMethodId, string | null>>;
}

export async function loadCashControlWeekSummary(week: string): Promise<CashDailyWeekSummaryPayload | null> {
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;

  const [payments, drawerRows, expenseRows] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        exchangeRate: true,
        methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
        paymentDate: true,
        createdAt: true,
      },
    }),
    prisma.cashDailyDrawerCount.findMany({
      where: { weekCode: wk, countryCode: "TR" },
      include: { updatedBy: { select: { fullName: true } } },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      select: { expenseDate: true, currency: true, amount: true, paymentMethod: true },
    }),
  ]);

  const intakeByDay = aggregateDailyIntakes(payments);
  const drawerRowByDay = new Map(drawerRows.map((d) => [d.countDate, d]));
  const drawerByDay = new Map(drawerRows.map((d) => [d.countDate, drawerFromDb(d)]));
  const expenseByDay = aggregateWeekExpenses(expenseRows);

  let weekIntake = emptyDailyIntake();
  let weekDrawer: CashDailyDrawerValues = {};
  let weekExpIls = 0;
  let weekExpUsd = 0;
  const dayRows: CashDailySummaryRowDto[] = [];

  for (const dateYmd of listWeekDayYmds(wk)) {
    const intake = intakeByDay.get(dateYmd) ?? emptyDailyIntake();
    weekIntake = sumIntake(weekIntake, intake);
    const drawer = drawerByDay.get(dateYmd) ?? {};
    const countMeta = countMetaFromDrawerRow(drawerRowByDay.get(dateYmd));
    weekDrawer = sumDrawer(weekDrawer, drawer);
    const expenses = expenseByDay.get(dateYmd) ?? emptyDailyExpenses();
    const expCur = expensesCurrencyTotals(expenses);
    weekExpIls = Math.round((weekExpIls + expCur.ils) * 100) / 100;
    weekExpUsd = Math.round((weekExpUsd + expCur.usd) * 100) / 100;
    const { kind, worstDiff, worstCurrency } = computeDailyStatus(intake, drawer, expenses);
    const totalReceived = sumIlsChannelIntake(intake);

    dayRows.push({
      dateYmd,
      dayName: dayNameHe(dateYmd),
      dateDisplay: formatDailyDateDisplay(dateYmd),
      weekCode: wk,
      countryLabel: CASH_CONTROL_COUNTRY_LABEL,
      intake: intakeToDto(intake),
      drawer: drawerToDto(drawer),
      totalReceived: money(totalReceived),
      expensesIls: money(expCur.ils),
      expensesUsd: money(expCur.usd),
      diff: worstDiff != null ? money(worstDiff) : null,
      diffCurrency: worstCurrency,
      status: kind,
      ...countMeta,
    });
  }

  const weekTotalReceived = sumIlsChannelIntake(weekIntake);

  dayRows.push({
    dateYmd: "",
    dayName: "",
    dateDisplay: 'סה"כ שבוע',
    weekCode: wk,
    countryLabel: CASH_CONTROL_COUNTRY_LABEL,
    intake: intakeToDto(weekIntake),
    drawer: drawerToDto(weekDrawer),
    totalReceived: money(weekTotalReceived),
    expensesIls: money(weekExpIls),
    expensesUsd: money(weekExpUsd),
    diff: null,
    status: "ok",
    isTotal: true,
  });

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    from: range.from,
    to: range.to,
    rows: dayRows,
  };
}

export async function loadCashControlDayDetail(input: {
  week: string;
  dateYmd: string;
}): Promise<CashDailyDayDetailPayload | null> {
  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();

  const [payments, drawerRow, expenseRows] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        exchangeRate: true,
        methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
        paymentDate: true,
        createdAt: true,
      },
    }),
    prisma.cashDailyDrawerCount.findUnique({
      where: { countryCode_weekCode_countDate: { countryCode: "TR", weekCode: wk, countDate: dateYmd } },
      include: { updatedBy: { select: { fullName: true } } },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      orderBy: { expenseDate: "asc" },
      include: { createdBy: { select: { fullName: true } } },
    }),
  ]);

  const intakeByDay = aggregateDailyIntakes(payments);
  const intake = intakeByDay.get(dateYmd) ?? emptyDailyIntake();
  const drawer = drawerFromDb(drawerRow);
  const countMeta = countMetaFromDrawerRow(drawerRow);

  const dayExpenses = expenseRows.filter((e) => formatYmdJerusalem(e.expenseDate) === dateYmd);
  const expenseTotals = aggregateExpensesByMethod(
    dayExpenses.map((e) => ({
      currency: e.currency,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
    })),
  );
  const expCur = expensesCurrencyTotals(expenseTotals);

  const expenseIds = dayExpenses.map((e) => e.id);
  const docCount = new Map<string, number>();
  if (expenseIds.length > 0) {
    await ensureDocumentsTable();
    const grouped = await prisma.document.groupBy({
      by: ["entityId"],
      where: { entityType: "CASH_EXPENSE", entityId: { in: expenseIds }, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) docCount.set(g.entityId, g._count._all);
  }

  const recon = buildDailyReconciliation(intake, drawer, expenseTotals);

  return {
    dateYmd,
    dateDisplay: formatDailyDateDisplay(dateYmd),
    dayName: dayNameHe(dateYmd),
    weekCode: wk,
    intake: intakeToDto(intake),
    drawer: drawerToDto(drawer),
    ...countMeta,
    expensesIls: money(expCur.ils),
    expensesUsd: money(expCur.usd),
    expenses: dayExpenses.map((e) => {
      const when = new Date(e.expenseDate);
      const pm = normalizePaymentMethod(e.paymentMethod);
      return {
        id: e.id,
        timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
        reason: e.reason,
        reasonLabel: EXPENSE_REASON_LABEL[e.reason] ?? "אחר",
        notes: e.notes,
        currency: e.currency === "USD" ? "USD" : "ILS",
        paymentMethod: pm,
        paymentMethodLabel: paymentMethodLabel(pm),
        amount: money(e.amount ?? new Prisma.Decimal(0)),
        createdByName: e.createdBy?.fullName ?? null,
        documentCount: docCount.get(e.id) ?? 0,
        status: e.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
      } satisfies CashDailyExpenseRowDto;
    }),
    reconciliation: recon.map((r) => ({
      method: r.method,
      label: r.label,
      currency: r.currency,
      grossReceived: money(r.grossReceived),
      expense: money(r.expense),
      received: money(r.received),
      counted: r.counted != null ? money(r.counted) : null,
      diff: r.diff != null ? money(r.diff) : null,
      status: r.status,
    })),
  };
}

export async function loadCashControlDayIntakes(input: {
  week: string;
  dateYmd: string;
  column: CashDailyMethodId;
}): Promise<CashDailyMethodDetailRow[]> {
  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();
  const column = input.column;

  const payments = await prisma.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(wk),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      exchangeRate: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      customer: { select: { displayName: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const filtered = payments.filter(
    (p) => paymentDayKeyJerusalem(p) === dateYmd && paymentMatchesDailyColumn(p, column),
  );

  const paymentIds = filtered.map((p) => p.id);
  const reviewedSet = new Set<string>();
  let docHints = new Map<string, PaymentDocumentHint>();
  if (paymentIds.length > 0) {
    const [reviews, hints] = await Promise.all([
      prisma.paymentCashAuditReview.findMany({
        where: { weekCode: wk, paymentId: { in: paymentIds } },
        select: { paymentId: true },
      }),
      loadPaymentDocumentHints(paymentIds),
    ]);
    for (const r of reviews) reviewedSet.add(r.paymentId);
    docHints = hints;
  }

  const rows: CashDailyMethodDetailRow[] = [];
  for (const p of filtered) {
    const amt = paymentAmountForDailyColumn(p, column);
    if (amt <= CASH_CONTROL_EPS) continue;
    const when = new Date(p.paymentDate ?? p.createdAt);
    const doc = docHints.get(p.id) ?? emptyDocumentHint();
    rows.push({
      paymentId: p.id,
      paymentCode: p.paymentCode ?? null,
      orderId: p.orderId ?? null,
      customerId: p.customerId ?? null,
      customerName: p.customer?.displayName ?? null,
      recordedByName: p.createdBy?.fullName ?? null,
      timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      amount: fixCashUsd(amt),
      hasDocument: doc.hasDocument,
      documentPreviewable: doc.documentPreviewable,
      previewDocumentId: doc.previewDocumentId,
      reviewed: reviewedSet.has(p.id),
    });
  }
  return rows;
}

export async function persistCashDailyDrawer(input: {
  week: string;
  dateYmd: string;
  drawer: Partial<Record<CashDailyMethodId, number | string | null>>;
  updatedById: string;
}): Promise<{ ok: boolean; error?: string }> {
  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();
  if (!wk || !dateYmd) return { ok: false, error: "נתונים חסרים" };

  const range = getAhWeekRange(wk);
  if (!range || dateYmd < range.from || dateYmd > range.to) {
    return { ok: false, error: "תאריך לא בשבוע הנבחר" };
  }

  const d = input.drawer;
  const fieldValues = Object.fromEntries(
    allCashControlChannels().map((channel) => [CHANNEL_DRAWER_FIELD[channel], dec(d[channel])]),
  );
  const createData = {
    countryCode: "TR" as const,
    weekCode: wk,
    countDate: dateYmd,
    ...fieldValues,
    updatedById: input.updatedById,
  };
  await prisma.cashDailyDrawerCount.upsert({
    where: {
      countryCode_weekCode_countDate: { countryCode: "TR", weekCode: wk, countDate: dateYmd },
    },
    create: createData,
    update: {
      ...fieldValues,
      updatedById: input.updatedById,
    },
  });

  return { ok: true };
}

export async function loadCashControlDayPayments(input: {
  week: string;
  dateYmd: string;
}): Promise<CashDailyPaymentRowDto[]> {
  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();

  const payments = await prisma.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(wk),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      exchangeRate: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      order: { select: { orderNumber: true } },
      customer: { select: { displayName: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const dayPayments = payments.filter((p) => paymentDayKeyJerusalem(p) === dateYmd);
  const paymentIds = dayPayments.map((p) => p.id);

  const reviewedSet = new Set<string>();
  let docHints = new Map<string, PaymentDocumentHint>();
  if (paymentIds.length > 0) {
    const [reviews, hints] = await Promise.all([
      prisma.paymentCashAuditReview.findMany({
        where: { weekCode: wk, paymentId: { in: paymentIds } },
        select: { paymentId: true },
      }),
      loadPaymentDocumentHints(paymentIds),
    ]);
    for (const r of reviews) reviewedSet.add(r.paymentId);
    docHints = hints;
  }

  const rows: CashDailyPaymentRowDto[] = [];
  for (const p of dayPayments) {
    const contribs = getDailyPaymentContributions(p);
    if (contribs.length === 0) continue;
    const when = new Date(p.paymentDate ?? p.createdAt);
    const primary = contribs[0];
    const methodRaw = (p.ilsPaymentMethod ?? p.usdPaymentMethod ?? p.paymentMethod ?? "").trim();
    const doc = docHints.get(p.id) ?? emptyDocumentHint();
    rows.push({
      paymentId: p.id,
      paymentCode: p.paymentCode ?? null,
      orderId: p.orderId ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      customerId: p.customerId ?? null,
      customerName: p.customer?.displayName ?? null,
      recordedByName: p.createdBy?.fullName ?? null,
      timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      methodLabel: methodRaw ? (PAYMENT_METHOD_LABELS[methodRaw] ?? methodRaw) : "—",
      amount: fixCashUsd(primary.amount),
      amountCurrency: channelCurrency(primary.column),
      hasDocument: doc.hasDocument,
      documentPreviewable: doc.documentPreviewable,
      previewDocumentId: doc.previewDocumentId,
      reviewed: reviewedSet.has(p.id),
    });
  }
  return rows;
}
