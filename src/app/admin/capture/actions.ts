"use server";

import { randomUUID } from "crypto";
import { OrderEditRequestStatus, Prisma } from "@prisma/client";
import { listOrderStatusTags } from "@/lib/order-status-registry";
import { OS } from "@/lib/order-status-slugs";
import { revalidatePath, revalidateTag } from "next/cache";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import { recordActivityAudit } from "@/lib/activity-audit";
import {
  computeOrderEditDiff,
  snapshotFromUpdateForm,
  snapshotFromWorkPanel,
  type OrderEditSnapshot,
} from "@/lib/order-edit-snapshot";
import { orderEditDiffRequiresApproval } from "@/lib/order-edit-approval";
import { writeOrderUpdateAuditLog } from "@/lib/order-update-audit";
import { getCustomerInternalBalanceUsd } from "@/lib/customer-open-debt";
import { executeOrderCancellation } from "@/lib/order-cancellation";
import {
  getCurrentUser,
  isAdminUser,
  requireAuth,
  resolveSessionToAppUser,
  userHasAnyPermission,
  type AppUser,
} from "@/lib/admin-auth";
import { assertCreatedByUserExists, SessionUserInvalidError } from "@/lib/session-user-guard";
import {
  type CaptureCustomerSnapshotInput,
  type CaptureFinancialResolved,
  type CaptureFinancialSnapshotInput,
  parseEnabledCountriesFromForm,
  resolveCaptureFinancialFromForm,
} from "@/lib/capture-form-snapshot";
import {
  getActiveOrderStatusIdsCached,
  getActiveOrderStatusIdsSync,
  getActivePaymentMethodIdsSync,
  getCaptureFinancialSettingsCached,
  loadCaptureSettingsCountries,
  warmCaptureHotPathCaches,
} from "@/lib/capture-hot-path";
import type { SessionPayload } from "@/lib/session";
import {
  capturePerfLog,
  capturePerfTimeEnd,
  capturePerfTimeStart,
  capturePerfTimed,
  logOrderStatusUpdatePerf,
  scheduleCaptureAuditInsert,
  type OrderStatusUpdatePerf,
} from "@/lib/capture-perf";
import { CaptureSavePerf } from "@/lib/capture-save-perf";
import { invalidateOrdersListDataCache } from "@/lib/orders-list-data";
import { breakdownIlsIncludingVat, computeFromUsdAmount } from "@/lib/financial-calc";
import {
  ensureDefaultFinancialSettings,
  getCurrentFinancialSettings,
  loadFinanceSettingsSerialized,
} from "@/lib/financial-settings";
import { logFinanceSaveTarget, logFinanceSourceTable } from "@/lib/finance-log";
import {
  DEFAULT_WEEK_CODE,
  formatLocalHm,
  formatLocalYmd,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
  parseLocalDate,
  parseLocalDateTime,
} from "@/lib/work-week";
import { deriveAhWeekCodeFromOrderDateYmd } from "@/lib/weeks/order-week-dates";
import { isValidYmd } from "@/lib/weeks/ah-week";
import { orderNumberMatchesWeekFormat } from "@/lib/order-number";
import {
  generateNextOrderNumber,
  regenerateOrderNumberAfterCollision,
  previewOrderNumberAfter,
  previewNextOrderNumberForWeek,
} from "@/lib/orders-next-number";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture, resolvePaymentWorkCountry } from "@/lib/payment-capture-code";
import {
  findCapturePaymentIdByCode,
  isCapturePaymentNavCountry,
  listCapturePaymentCodesOrdered,
  listCapturePaymentIdsOrdered,
  listCustomerCapturePaymentsForNav,
  resolveCapturePaymentCodeNeighbors,
  workCountryFromCapturePaymentCode,
} from "@/lib/payment-code-navigation";
import { loadPaymentEntryPayload, type PaymentEntryPayload } from "@/lib/payment-entry-payload";
import type { PaymentNavigationCacheEntryPayload } from "@/lib/payment-navigation-cache";
import { fetchPaymentIntakeCustomerOrdersAction } from "@/app/admin/payments/intake/actions";
import type { CapturePaymentNavCountry } from "@/lib/payment-code-navigation";
import { normalizeCapturePaymentCodeQuery } from "@/lib/payment-code-search";
import { normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { PM } from "@/lib/payment-method-slugs";
import {
  isCompositePaymentMethod,
  type BreakdownCurrency,
  type OrderBreakdownLineInput,
} from "@/lib/payment-breakdown-shared";
import { parseSplitPaymentMethodRaw } from "@/lib/order-capture-payment-methods";
import { getSelectedCountriesForOrdersInternal } from "@/app/admin/settings/actions";
import { ORDER_COUNTRY_CODES, coerceOrderCountryForForm, normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import {
  DEFAULT_WORK_COUNTRY,
  orderSourceCountryFromWorkCountry,
  workCountryFromOrderSourceCountry,
} from "@/lib/work-country";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { computeCustomerNamePatches, primaryCustomerDisplayName } from "@/lib/customer-names";
import {
  isCustomerCodeTaken,
  normalizeCustomerCodeInput,
  suggestNextCustomerCode,
} from "@/lib/customer-code";
import { normalizeCustomerPlaceInput } from "@/lib/customer-place";
import { canUserEditCompletedOrder } from "@/lib/order-edit-lock";
import { ensureOrderCompletionColumnOnce } from "@/lib/order-completion";
import { searchCustomersPrisma } from "@/lib/customer-search-prisma";
import {
  clearExpiredOrderEditUnlockForOrder,
  markApprovedEditRequestUsedAndClearUnlock,
} from "@/app/admin/order-edit-requests/actions";
import { ensureOrderEditRequestTablesOnce } from "@/lib/order-edit-request-bootstrap";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import {
  ensureIntakeLocationTable,
  findOrCreateIntakeLocationByName,
  listIntakeLocationsForSelect,
  resolveOrderIntakeLocationColumnValue,
} from "@/lib/intake-location";
import {
  resolveCustomerForCapture,
  type CaptureCustomerRow,
} from "@/lib/ensure-customer-for-capture";

type OrderCaptureDatesInput = {
  /** תאימות אחורה — לא משמש לחישוב שבוע */
  weekCode?: string;
  /** תאריך עסקי ראשי → orderDate + weekCode */
  orderExecutionDateYmd?: string;
  /** תאריך/שעת הזנה למערכת → intakeDateTime (לא משפיע על שבוע) */
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  /** תאימות אחורה */
  orderDateYmd?: string;
  orderTimeHm?: string;
};

function resolveOrderCaptureDates(
  form: OrderCaptureDatesInput,
):
  | { ok: true; orderExecutionDate: Date; intakeDateTime: Date; orderDate: Date; weekCode: string }
  | { ok: false; error: string } {
  const orderDateYmd = (form.orderExecutionDateYmd ?? form.orderDateYmd ?? "").trim();
  const intakeYmd = (form.intakeDateYmd ?? "").trim();
  const intakeHm = (form.intakeTimeHm ?? form.orderTimeHm ?? "00:00").trim();

  if (!orderDateYmd) return { ok: false, error: "יש להזין תאריך הזמנה" };
  if (!isValidYmd(orderDateYmd)) return { ok: false, error: "תאריך הזמנה לא תקין" };
  if (!intakeYmd) return { ok: false, error: "יש להזין תאריך הזנה" };
  if (!isValidYmd(intakeYmd)) return { ok: false, error: "תאריך הזנה לא תקין" };

  const orderDate = parseLocalDate(orderDateYmd);
  const weekCode = deriveAhWeekCodeFromOrderDateYmd(orderDateYmd) ?? DEFAULT_WEEK_CODE;
  const orderExecutionDate = orderDate;
  const intakeDateTime = parseLocalDateTime(intakeYmd, intakeHm);

  return { ok: true, orderExecutionDate, intakeDateTime, orderDate, weekCode };
}

export type CustomerSearchRow = {
  id: string;
  label: string;
  code: string | null;
  customerType: string | null;
  city: string | null;
  phone: string | null;
  /** שדות מורחבים — מאוכלסים על־ידי /api/customers/search-fast כדי לחסוך fetch שני אחרי בחירה */
  nameAr?: string | null;
  nameEn?: string | null;
  nameHe?: string | null;
  phone2?: string | null;
  oldCustomerCode?: string | null;
  address?: string | null;
  countryCode?: string | null;
  /** יתרה מ-snapshot ב-Customer — ללא aggregate בהזמנה */
  balanceUsd?: number;
};

export type OrderCaptureSavedSummary = {
  orderId: string;
  orderNumber: string;
  customerLabel: string;
  totalUsd: string;
  payments: { paymentMethod: string; amountUsd: string }[];
};

export type PaymentCaptureSavedSummary = {
  paymentId: string;
  paymentCode: string | null;
  paymentType: "ORDER_PAYMENT" | "GENERAL_PAYMENT";
  customerLabel: string;
  customerCode: string | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  paymentPlace: string | null;
  paymentMethod: string;
  amountDisplay: string;
  totalIlsWithVat: string;
  totalIlsWithoutVat: string;
  vatAmount: string;
  orderNumber: string | null;
};

export type CaptureState =
  | {
      ok: true;
      saved?: OrderCaptureSavedSummary;
      orderNumber?: string;
      nextOrderNumberPreview?: string | null;
      /** הודעת מידע ידידותית (למשל: מספר הזמנה הופק מחדש עקב התנגשות) */
      notice?: string | null;
    }
  | { ok: false; error: string };

export type PaymentCaptureState =
  | { ok: true; saved: PaymentCaptureSavedSummary }
  | { ok: false; error: string };

const PAYMENT_METHODS = {
  has(id: string) {
    return getActivePaymentMethodIdsSync().has(id);
  },
};

async function loadCustomerForCapture(
  customerId: string,
  snapshot: CaptureCustomerSnapshotInput | null | undefined,
  drafts?: { draftNameAr?: string | null; draftNameEn?: string | null },
  actorUserId?: string | null,
): Promise<{ customer: CaptureCustomerRow; created: boolean } | null> {
  return capturePerfTimed("capture.customer", () =>
    resolveCustomerForCapture({
      customerId,
      snapshot,
      draftNameAr: drafts?.draftNameAr,
      draftNameEn: drafts?.draftNameEn,
      actorUserId,
    }),
  );
}

async function resolveCaptureRatesForSave(
  form: CaptureOrderFormExtras & { finalRateOverride?: string | null },
): Promise<{ ok: true; rates: CaptureFinancialResolved } | { ok: false; error: string }> {
  const fromClient = resolveCaptureFinancialFromForm(form.financialSnapshot, form.finalRateOverride);
  if (fromClient.ok) {
    capturePerfLog({ exchangeRateSource: "client" });
    logFinanceSaveTarget("order-capture-save", "Order", {
      base: fromClient.rates.base.toString(),
      fee: fromClient.rates.fee.toString(),
      final: fromClient.rates.final.toString(),
      note: "per-order snapshot only — FinancialSettings unchanged",
    });
    return fromClient;
  }

  capturePerfLog({ exchangeRateSource: "db", reason: fromClient.error });
  const s = await capturePerfTimed("capture.exchangeRate", () => getCaptureFinancialSettingsCached());
  logFinanceSourceTable("order-capture-save-fallback");
  logFinanceSaveTarget("order-capture-save", "Order", {
    base: s.baseDollarRate.toString(),
    fee: s.dollarFee.toString(),
    final: s.finalDollarRate.toString(),
    note: "rates from FinancialSettings fallback",
  });
  return {
    ok: true,
    rates: { base: s.baseDollarRate, fee: s.dollarFee, final: s.finalDollarRate },
  };
}

export type CaptureOrderFormExtras = {
  financialSnapshot?: CaptureFinancialSnapshotInput | null;
  customerSnapshot?: CaptureCustomerSnapshotInput | null;
  enabledCountries?: OrderCountryCode[] | null;
};

export type OrderCapturePaymentLineInput = {
  paymentMethod: string;
  /** סכום בשורה — ב-USD או ב-₪ לפי currency */
  amountUsd: string;
  /** "ILS" = amount בשקלים (מומר ל-USD לפי שער ההזמנה); אחרת USD */
  currency?: string;
};

function parseOrderPaymentLines(
  lines: OrderCapturePaymentLineInput[] | undefined,
  finalNisPerUsd: Prisma.Decimal,
): { ok: true; parsed: { method: string; amount: Prisma.Decimal }[]; sum: Prisma.Decimal } | { ok: false; error: string } {
  if (!lines?.length) return { ok: true, parsed: [], sum: new Prisma.Decimal(0) };
  const parsed: { method: string; amount: Prisma.Decimal }[] = [];
  let sum = new Prisma.Decimal(0);
  for (const line of lines) {
    const raw = (line.amountUsd || "").trim().replace(",", ".");
    if (!raw) continue;
    let amtInput: Prisma.Decimal;
    try {
      amtInput = new Prisma.Decimal(raw);
    } catch {
      return { ok: false, error: "סכום בשורת תשלום לא תקין" };
    }
    if (amtInput.lte(0)) continue;
    const method = parseSplitPaymentMethodRaw(line.paymentMethod);
    if (!method || !PAYMENT_METHODS.has(method)) {
      return {
        ok: false,
        error: "אמצעי בשורת תשלום לא תקין",
      };
    }
    const cur = (line.currency || "USD").trim().toUpperCase();
    let amtUsd: Prisma.Decimal;
    if (cur === "ILS" || cur === "NIS" || cur === "₪") {
      if (finalNisPerUsd.lte(0)) {
        return { ok: false, error: "שער דולר לא תקין לחישוב תשלומים בשקלים" };
      }
      amtUsd = amtInput.div(finalNisPerUsd).toDecimalPlaces(4, 4);
    } else {
      amtUsd = amtInput;
    }
    sum = sum.add(amtUsd);
    parsed.push({ method, amount: amtUsd });
  }
  return { ok: true, parsed, sum };
}

type CaptureDbClient = typeof prisma | Prisma.TransactionClient;

type CaptureActorResult = AppUser | { error: string };

/** מאמת session + User ב-DB לפני create/update — מונע FK על createdById */
async function resolveCaptureActor(
  apiSession: SessionPayload | null,
  preAuthenticated?: AppUser | null,
): Promise<CaptureActorResult> {
  if (preAuthenticated) return preAuthenticated;

  const user = apiSession ? await resolveSessionToAppUser(apiSession) : await getCurrentUser();
  if (!user) {
    return { error: apiSession ? "User Session Invalid" : "לא מחובר" };
  }
  try {
    await assertCreatedByUserExists(user.id);
  } catch (e) {
    if (e instanceof SessionUserInvalidError) return { error: "User Session Invalid" };
    throw e;
  }
  return user;
}

async function appendParsedPaymentsForOrder(
  params: {
    meId: string;
    orderId: string;
    customerId: string;
    weekCode: string | null;
    paymentDate: Date;
    parsed: { method: string; amount: Prisma.Decimal }[];
    base: Prisma.Decimal;
    fee: Prisma.Decimal;
    final: Prisma.Decimal;
    vatRate: Prisma.Decimal;
  },
  db: CaptureDbClient = prisma,
): Promise<void> {
  if (params.parsed.length === 0) return;
  await assertCreatedByUserExists(params.meId, db);
  const snapIn = {
    baseDollarRate: params.base,
    dollarFee: params.fee,
    finalDollarRate: params.final,
    vatRate: params.vatRate,
  };
  const data = params.parsed.map((row) => {
    const totals = computeFromUsdAmount(row.amount, snapIn);
    return {
      orderId: params.orderId,
      customerId: params.customerId,
      weekCode: params.weekCode,
      paymentDate: params.paymentDate,
      currency: "USD" as const,
      amountUsd: row.amount,
      amountIls: totals.totalIlsWithVat,
      exchangeRate: params.final,
      vatRate: params.vatRate,
      amountWithoutVat: totals.totalIlsWithoutVat,
      snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
      snapshotDollarFee: totals.snapshotDollarFee,
      snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
      totalIlsWithVat: totals.totalIlsWithVat,
      totalIlsWithoutVat: totals.totalIlsWithoutVat,
      vatAmount: totals.vatAmount,
      manualDateChanged: false,
      paymentMethod: row.method,
      isPaid: true,
      createdById: params.meId,
    };
  });
  await db.payment.createMany({ data });
}

type ParsedBreakdownRow = { paymentMethod: string; amount: Prisma.Decimal; currency: BreakdownCurrency };

/**
 * מפענח ומאמת חלוקת "תשלום מורכב". מאחסן את הסכום במטבע שהוזן (currency),
 * ומאמת שסכום החלוקה (ב-USD) שווה ל-totalUsd של ההזמנה.
 */
function parseOrderBreakdown(
  lines: OrderBreakdownLineInput[] | undefined,
  totalUsd: Prisma.Decimal,
  finalNisPerUsd: Prisma.Decimal,
): { ok: true; rows: ParsedBreakdownRow[] } | { ok: false; error: string } {
  if (!lines?.length) return { ok: false, error: "תשלום מורכב: יש להגדיר חלוקת תשלום" };
  const rows: ParsedBreakdownRow[] = [];
  let sumUsd = new Prisma.Decimal(0);
  for (const line of lines) {
    const raw = (line.amount || "").trim().replace(",", ".");
    if (!raw) continue;
    let amt: Prisma.Decimal;
    try {
      amt = new Prisma.Decimal(raw);
    } catch {
      return { ok: false, error: "תשלום מורכב: סכום לא תקין בשורת חלוקה" };
    }
    if (amt.lte(0)) continue;
    const method = parseSplitPaymentMethodRaw(line.paymentMethod);
    if (!method || !PAYMENT_METHODS.has(method)) {
      return { ok: false, error: "תשלום מורכב: אמצעי תשלום לא תקין בשורת חלוקה" };
    }
    const cur: BreakdownCurrency = line.currency === "ILS" ? "ILS" : "USD";
    let amtUsd: Prisma.Decimal;
    if (cur === "ILS") {
      if (finalNisPerUsd.lte(0)) return { ok: false, error: "תשלום מורכב: שער דולר לא תקין" };
      amtUsd = amt.div(finalNisPerUsd);
    } else {
      amtUsd = amt;
    }
    sumUsd = sumUsd.add(amtUsd);
    rows.push({ paymentMethod: method, amount: amt.toDecimalPlaces(4, 4), currency: cur });
  }
  if (rows.length === 0) return { ok: false, error: "תשלום מורכב: יש להגדיר חלוקת תשלום" };
  const diff = sumUsd.sub(totalUsd).abs();
  if (diff.gt(new Prisma.Decimal("0.01"))) {
    return { ok: false, error: "תשלום מורכב: סכום החלוקה חייב להיות שווה לסה״כ ההזמנה" };
  }
  return { ok: true, rows };
}

/** מפענח חלוקת תשלום — מורכב מהטופס, אחרת שורה אחידה לפי אמצעי ההזמנה */
function resolveOrderBreakdownRows(
  form: { paymentMethod: string; paymentBreakdown?: OrderBreakdownLineInput[] },
  totalUsd: Prisma.Decimal,
  finalNisPerUsd: Prisma.Decimal,
): { ok: true; rows: ParsedBreakdownRow[] } | { ok: false; error: string } {
  const isComposite = isCompositePaymentMethod(form.paymentMethod);
  if (isComposite) {
    return parseOrderBreakdown(form.paymentBreakdown, totalUsd, finalNisPerUsd);
  }
  const method = (form.paymentMethod ?? "").trim();
  if (!method) return { ok: true, rows: [] };
  if (!PAYMENT_METHODS.has(method)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }
  const singleLine: OrderBreakdownLineInput[] = [
    {
      paymentMethod: method,
      amount: totalUsd.toDecimalPlaces(2, 4).toString(),
      currency: "USD",
    },
  ];
  return parseOrderBreakdown(singleLine, totalUsd, finalNisPerUsd);
}

/** כותב מחדש את חלוקת התשלום של הזמנה (מחיקה + יצירה). rows ריק = ניקוי חלוקה. */
async function writeOrderBreakdown(
  db: CaptureDbClient,
  orderId: string,
  rows: ParsedBreakdownRow[],
  opts?: { userId?: string | null; intakeWeekCode?: string | null },
): Promise<void> {
  await db.orderPaymentBreakdown.deleteMany({ where: { orderId } });
  if (rows.length === 0) return;
  await db.orderPaymentBreakdown.createMany({
    data: rows.map((r) => ({
      orderId,
      paymentMethod: r.paymentMethod,
      amount: r.amount,
      currency: r.currency,
    })),
  });
  const { syncPaymentPlanAfterBreakdownWrite } = await import("@/lib/payment-plan-service");
  await syncPaymentPlanAfterBreakdownWrite(db, {
    orderId,
    userId: opts?.userId,
    intakeWeekCode: opts?.intakeWeekCode,
  });
}

/** האם השגיאה היא הפרת ייחודיות (P2002) על שדה orderNumber */
function isUniqueOrderNumberError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((f) => f.toLowerCase().includes("ordernumber"));
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type OrderPaymentContextPayload = {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerLabel: string;
  totalUsd: string;
  paidUsd: string;
  remainingUsd: string;
};

export type CustomerPaymentDetailPayload = {
  id: string;
  displayName: string;
  nameHe: string | null;
  nameAr: string | null;
  nameEn: string | null;
  customerCode: string | null;
};

export type PaymentLocationOptionRow = { id: string; name: string; code: string | null; label: string };

async function ensureOrderGeoTables(): Promise<void> {
  await ensureOnce("order-geo-tables", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "OrderLocations" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdBy" TEXT
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderLocations_name_idx" ON "OrderLocations" ("name")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderLocations_createdBy_idx" ON "OrderLocations" ("createdBy")`;

    await prisma.$executeRaw`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "locationId" TEXT`;
  });
}

async function ensureOrderCommissionPercentColumn(): Promise<void> {
  await ensureOnce("order-commission-percent", async () => {
    // Historical document: store commission percent on the order itself.
    await prisma.$executeRaw`
      ALTER TABLE "Order"
      ADD COLUMN IF NOT EXISTS "commissionPercent" DECIMAL(7,4) NOT NULL DEFAULT 0
    `;
  });
}

/** טעינת הקשר הזמנה לקליטת תשלום (מספר הזמנה) — ללא שינוי בקליטת הזמנה */
export async function fetchOrderForPaymentContextAction(
  orderNumberRaw: string,
): Promise<{ ok: true; data: OrderPaymentContextPayload } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const q = orderNumberRaw.trim();
  if (!q) return { ok: false, error: "הזינו מספר הזמנה" };

  const order = await prisma.order.findFirst({
    where: { deletedAt: null, orderNumber: { equals: q, mode: "insensitive" } },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      customerNameSnapshot: true,
      customer: { select: { displayName: true } },
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
    },
  });
  if (!order) return { ok: false, error: "הזמנה לא נמצאה" };

  const deal = order.amountUsd ?? new Prisma.Decimal(0);
  const com = order.commissionUsd ?? new Prisma.Decimal(0);
  const totalUsdVal = order.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

  const payAgg = await prisma.payment.aggregate({
    where: { orderId: order.id, amountUsd: { not: null } },
    _sum: { amountUsd: true },
  });
  const paidUsd = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
  const remainingUsd = totalUsdVal.sub(paidUsd).toDecimalPlaces(2, 4);

  const label = order.customer?.displayName ?? order.customerNameSnapshot ?? "—";

  return {
    ok: true,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber ?? q,
      customerId: order.customerId,
      customerLabel: label,
      totalUsd: totalUsdVal.toFixed(2),
      paidUsd: paidUsd.toFixed(2),
      remainingUsd: remainingUsd.toFixed(2),
    },
  };
}

export async function previewPaymentCodeForCaptureAction(input?: {
  orderId?: string | null;
  customerId?: string | null;
  /** מדינה מהמסך (טורקיה/סין/אמירויות) — מונה נפרד לכל מדינה */
  workCountry?: WorkCountryCode | string | null;
}): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const wc = await resolvePaymentWorkCountry({
    orderId: input?.orderId,
    customerId: input?.customerId,
    workCountry: input?.workCountry,
  });
  return { ok: true, code: (await allocateNextPaymentCapture(wc)).code };
}

/** רשימת כל קודי הקליטה במדינה — נטענת פעם אחת לניווט */
export async function listCapturePaymentCodesForNavAction(
  workCountry: string,
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const wc = normalizeWorkCountryCode(workCountry);
  if (!wc || !isCapturePaymentNavCountry(wc)) {
    return { ok: false, error: "מדינת קליטה לא תקינה" };
  }
  const codes = await listCapturePaymentCodesOrdered(wc);
  return { ok: true, codes };
}

/** רשימת קליטות תשלום של לקוח — מקור הניווט */
export async function listCustomerCapturePaymentsForNavAction(
  customerId: string,
  workCountry?: string,
): Promise<
  | { ok: true; payments: { id: string; paymentCode: string }[] }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const cid = customerId.trim();
  if (!cid) return { ok: false, error: "חסר מזהה לקוח" };
  const wc = workCountry ? normalizeWorkCountryCode(workCountry) : null;
  const payments = await listCustomerCapturePaymentsForNav(cid, wc);
  return { ok: true, payments };
}

/** רשימת מזהי קליטה לניווט — נטענת פעם אחת בפתיחה */
export async function listCapturePaymentIdsForNavAction(
  workCountry: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const wc = normalizeWorkCountryCode(workCountry);
  if (!wc || !isCapturePaymentNavCountry(wc)) {
    return { ok: false, error: "מדינת קליטה לא תקינה" };
  }
  const { listCapturePaymentIdsOrdered } = await import("@/lib/payment-code-navigation");
  const ids = await listCapturePaymentIdsOrdered(wc);
  return { ok: true, ids };
}

function intakeWeekCodeFromPaymentDateYmd(ymd: string): string {
  const norm = normalizeAhWeekCode(deriveAhWeekCodeFromOrderDateYmd(ymd.trim()));
  return norm ?? DEFAULT_WEEK_CODE;
}

/** טעינה מרוכזת לניווט — קודי קליטה במדינה + שבוע AH + workspace לכל מסמך (פעם אחת בפתיחה) */
export async function preloadCapturePaymentNavigationCacheAction(
  workCountry: string,
  weekCode: string,
): Promise<
  | { ok: true; week: string; codes: string[]; entries: PaymentNavigationCacheEntryPayload[] }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const wc = normalizeWorkCountryCode(workCountry);
  if (!wc || !isCapturePaymentNavCountry(wc)) {
    return { ok: false, error: "מדינת קליטה לא תקינה" };
  }
  const weekNorm = normalizeAhWeekCode(weekCode) ?? DEFAULT_WEEK_CODE;

  /** רשימת ניווט — כל קודי הקליטה במדינה (לא מסונן לפי שבוע) */
  const navCodes = await listCapturePaymentCodesOrdered(wc as CapturePaymentNavCountry);
  const entries: PaymentNavigationCacheEntryPayload[] = [];
  const hydrateByCustomerWeek = new Map<
    string,
    Awaited<ReturnType<typeof fetchPaymentIntakeCustomerOrdersAction>>
  >();
  const { getCustomerOpenDebt, openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");
  const debtScope = openDebtScopeForWorkCountry(wc);
  const openDebtByCustomer = new Map<string, number>();

  for (const code of navCodes) {
    const paymentId = await findCapturePaymentIdByCode(code, wc);
    if (!paymentId) continue;
    const entry = await loadPaymentEntryPayload(paymentId);
    if (!entry) continue;

    const customerId = entry.customer.id?.trim();
    if (!customerId) continue;

    const intakeWeekCode = intakeWeekCodeFromPaymentDateYmd(entry.paymentDateYmd);
    const hydrateKey = `${customerId}|${intakeWeekCode}|${wc}`;
    let hydrate = hydrateByCustomerWeek.get(hydrateKey);
    if (!hydrate) {
      hydrate = await fetchPaymentIntakeCustomerOrdersAction(customerId, intakeWeekCode, wc);
      hydrateByCustomerWeek.set(hydrateKey, hydrate);
    }
    if (!hydrate.ok) continue;

    let openDebtSignedUsd = openDebtByCustomer.get(customerId);
    if (openDebtSignedUsd === undefined) {
      const debt = await getCustomerOpenDebt(customerId, debtScope);
      openDebtSignedUsd = Number(debt.signedBalanceUsd.toFixed(2));
      openDebtByCustomer.set(customerId, openDebtSignedUsd);
    }

    entries.push({
      paymentCode: code,
      paymentId: entry.id,
      entry,
      customerData: hydrate.customer,
      orders: hydrate.orders,
      customerPayments: hydrate.customerPayments,
      intakeWeekCode,
      openDebtSignedUsd,
    });
  }

  return { ok: true, week: weekNorm, codes: navCodes, entries };
}

export async function getCapturePaymentCodeNeighborsAction(input: {
  code: string;
  workCountry: string;
}): Promise<
  | {
      ok: true;
      prevCode: string | null;
      nextCode: string | null;
      isFirstInCountry: boolean;
      isLastInCountry: boolean;
      inCountryList: boolean;
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const code = input.code.trim();
  if (!code) return { ok: false, error: "חסר קוד תשלום" };
  const wc = workCountryFromCapturePaymentCode(code);
  if (!wc) return { ok: false, error: "קוד התשלום לא מזוהה למדינה (TR-P / CN-P / CH-P / AE-P)" };
  const neighbors = await resolveCapturePaymentCodeNeighbors(code);
  return { ok: true, ...neighbors };
}

/** טעינת קליטה שמורה לפי קוד תשלום + מדינה (TR-P-… / CN-P-… / AE-P-…) */
export async function loadPaymentCaptureByCodeAction(input: {
  code: string;
  workCountry: string;
}): Promise<{ ok: true; entry: PaymentEntryPayload } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const code = input.code.trim();
  if (!code) return { ok: false, error: "חסר קוד תשלום" };
  const wc = workCountryFromCapturePaymentCode(code);
  if (!wc) return { ok: false, error: "קוד התשלום לא מזוהה למדינה (TR-P / CN-P / CH-P / AE-P)" };
  const id = await findCapturePaymentIdByCode(code, wc);
  if (!id) return { ok: false, error: "קליטת תשלום לא נמצאה" };
  const entry = await loadPaymentEntryPayload(id);
  if (!entry) return { ok: false, error: "לא ניתן לטעון קליטת תשלום" };
  return { ok: true, entry };
}

/** חיפוש קליטה לפי קוד — 7 / 0007 / TR-P-000007 (בלתי תלוי ב-Navigation Store) */
export async function resolveCapturePaymentByCodeQueryAction(
  query: string,
  workCountry?: string,
): Promise<
  | { ok: true; paymentId: string; paymentCode: string }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const raw = query.trim();
  if (!raw) return { ok: false, error: "הזן קוד תשלום" };

  const fallbackWc = normalizeWorkCountryCode(workCountry ?? "") ?? DEFAULT_WORK_COUNTRY;
  const code = normalizeCapturePaymentCodeQuery(raw, fallbackWc);
  if (!code) return { ok: false, error: "קוד תשלום לא תקין" };

  const wc = workCountryFromCapturePaymentCode(code);
  if (!wc) return { ok: false, error: "קוד התשלום לא מזוהה למדינה (TR-P / CN-P / AE-P)" };

  const paymentId = await findCapturePaymentIdByCode(code, wc);
  if (!paymentId) return { ok: false, error: `לא נמצא תשלום ${code}` };

  return { ok: true, paymentId, paymentCode: code };
}

export async function listPaymentLocationsForPaymentAction(): Promise<PaymentLocationOptionRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return [];

  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; code: string | null }>>`
    SELECT "id", "name", "code"
    FROM "PaymentLocation"
    WHERE "isActive" = true
    ORDER BY "name" ASC
  `;
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    label: p.code?.trim() ? `${p.name} (${p.code})` : p.name,
  }));
}

export async function createPaymentLocationForPaymentAction(form: {
  name: string;
  code?: string | null;
}): Promise<{ ok: true; data: PaymentLocationOptionRow } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const name = form.name.trim();
  const code = form.code?.trim() || null;
  if (!name) return { ok: false, error: "יש להזין שם מקום" };

  if (code) {
    const dup = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "PaymentLocation"
      WHERE LOWER("code") = LOWER(${code})
      LIMIT 1
    `;
    if (dup.length > 0) return { ok: false, error: "קוד מקום כבר קיים" };
  }

  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "PaymentLocation" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
    VALUES (${id}, ${name}, ${code}, true, NOW(), NOW())
  `;

  return {
    ok: true,
    data: {
      id,
      name,
      code,
      label: code ? `${name} (${code})` : name,
    },
  };
}

export async function getCustomerDetailsForPaymentAction(
  customerId: string,
): Promise<CustomerPaymentDetailPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return null;

  const id = customerId.trim();
  if (!id) return null;

  const row = await prisma.customer.findFirst({
    where: { id, deletedAt: null, isActive: true },
    select: { id: true, displayName: true, nameHe: true, nameAr: true, nameEn: true, customerCode: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    nameHe: row.nameHe,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    customerCode: row.customerCode,
  };
}

export async function capturePaymentAction(form: {
  paymentDateYmd: string;
  paymentTimeHm?: string;
  receivedToday: boolean;
  paymentMethod: string;
  notes?: string;
  orderId?: string | null;
  customerId?: string | null;
  paymentPlace?: string | null;
  amountUsd: string;
  amountIls: string;
  amountTransferIls: string;
}): Promise<PaymentCaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const fin = await loadFinanceSettingsSerialized("payment-capture");
  const base = new Prisma.Decimal(fin.baseDollarRate);
  const fee = new Prisma.Decimal(fin.dollarFee);
  const final = new Prisma.Decimal(fin.finalDollarRate);
  logFinanceSaveTarget("payment-capture", "Payment", { final: fin.finalDollarRate });
  const vatRate = prismaVatRatePercent();

  const snapIn = { baseDollarRate: base, dollarFee: fee, finalDollarRate: final, vatRate };

  let usdDec: Prisma.Decimal;
  let ilsDec: Prisma.Decimal;
  let transferDec: Prisma.Decimal;
  try {
    usdDec = new Prisma.Decimal((form.amountUsd || "").trim().replace(",", ".") || "0");
    ilsDec = new Prisma.Decimal((form.amountIls || "").trim().replace(",", ".") || "0");
    transferDec = new Prisma.Decimal((form.amountTransferIls || "").trim().replace(",", ".") || "0");
  } catch {
    return { ok: false, error: "סכום לא תקין" };
  }
  if (usdDec.lt(0) || ilsDec.lt(0) || transferDec.lt(0)) {
    return { ok: false, error: "סכומים לא יכולים להיות שליליים" };
  }

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const oid = form.orderId?.trim() ?? "";
  const ilsCashTransfer = ilsDec.add(transferDec);
  const totalIlsGrossInput = ilsCashTransfer.add(usdDec.mul(final));
  if (totalIlsGrossInput.lte(0)) {
    return { ok: false, error: "יש להזין סכום חיובי (דולר ו/או שקל / העברה)" };
  }

  const payUsdEst = totalIlsGrossInput.div(final).toDecimalPlaces(4, 4);

  let orderCustomerId: string | null = null;
  let orderWeekCode: string | null = null;
  if (oid) {
    const orderRow = await prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: {
        customerId: true,
        weekCode: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
      },
    });
    if (!orderRow) return { ok: false, error: "הזמנה לא נמצאה" };
    orderCustomerId = orderRow.customerId;
    orderWeekCode = orderRow.weekCode?.trim() || null;

    const deal = orderRow.amountUsd ?? new Prisma.Decimal(0);
    const com = orderRow.commissionUsd ?? new Prisma.Decimal(0);
    const totalOrd = orderRow.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

    if (totalOrd.gt(0)) {
      const paidAgg = await prisma.payment.aggregate({
        where: { orderId: oid, amountUsd: { not: null } },
        _sum: { amountUsd: true },
      });
      const paidUsd = paidAgg._sum.amountUsd ?? new Prisma.Decimal(0);
      const remainingUsd = totalOrd.sub(paidUsd);
      if (payUsdEst.sub(remainingUsd).gt(new Prisma.Decimal("0.01"))) {
        return { ok: false, error: `סכום גבוה מהנותר (נותר ${remainingUsd.toFixed(2)} USD)` };
      }
    }
  }

  const cid = (form.customerId?.trim() || orderCustomerId || "").trim();
  if (!cid) {
    return { ok: false, error: "יש לבחור לקוח" };
  }

  const custOk = await prisma.customer.findFirst({
    where: { id: cid, deletedAt: null, isActive: true },
    select: { id: true, displayName: true, customerCode: true },
  });
  if (!custOk) return { ok: false, error: "לקוח לא נמצא" };

  const today = new Date();
  const todayYmd = formatLocalYmd(today);
  const hm = (form.paymentTimeHm ?? "").trim();

  let paymentDate: Date;
  if (form.receivedToday) {
    paymentDate = hm ? parseLocalDateTime(todayYmd, hm) : today;
  } else {
    const d = form.paymentDateYmd.trim();
    if (!d) return { ok: false, error: "יש לבחור תאריך תשלום" };
    paymentDate = hm ? parseLocalDateTime(d, hm) : parseLocalDate(d);
  }
  const manualDateChanged = !isSameLocalCalendarDay(paymentDate, today);

  let amountUsd: Prisma.Decimal | null = null;
  let amountIls: Prisma.Decimal | null = null;
  let currency: "ILS" | "USD";
  let totals: ReturnType<typeof computeFromUsdAmount> | ReturnType<typeof breakdownIlsIncludingVat> & {
    snapshotBaseDollarRate: Prisma.Decimal;
    snapshotDollarFee: Prisma.Decimal;
    snapshotFinalDollarRate: Prisma.Decimal;
  };

  const vatFactor = new Prisma.Decimal(1).add(vatRate.div(new Prisma.Decimal(100)));

  if (ilsCashTransfer.isZero() && usdDec.gt(0)) {
    currency = "USD";
    amountUsd = usdDec;
    totals = computeFromUsdAmount(usdDec, snapIn);
    amountIls = totals.totalIlsWithVat;
  } else {
    currency = "ILS";
    const totalIlsGross = totalIlsGrossInput.toDecimalPlaces(2, 4);
    const br = breakdownIlsIncludingVat(totalIlsGross, vatFactor);
    totals = {
      snapshotBaseDollarRate: base,
      snapshotDollarFee: fee,
      snapshotFinalDollarRate: final,
      totalIlsWithVat: br.totalIlsWithVat,
      totalIlsWithoutVat: br.totalIlsWithoutVat,
      vatAmount: br.vatAmount,
    };
    amountIls = totals.totalIlsWithVat;
    amountUsd = payUsdEst;
  }

  const payWorkCountry = await resolvePaymentWorkCountry({ orderId: oid || null, customerId: cid });
  const allocated = await allocateNextPaymentCapture(payWorkCountry);
  const paymentCode = allocated.code;
  const weekCode = orderWeekCode ?? getWeekCodeForLocalDate(paymentDate);
  const paymentType: "ORDER_PAYMENT" | "GENERAL_PAYMENT" = oid ? "ORDER_PAYMENT" : "GENERAL_PAYMENT";

  await assertCreatedByUserExists(me.id);

  const pay = await prisma.payment.create({
    data: {
      countryCode: payWorkCountry,
      paymentCode,
      paymentNumber: allocated.paymentNumber,
      orderId: oid || null,
      customerId: cid,
      weekCode,
      paymentDate,
      paymentPlace: form.paymentPlace?.trim() || null,
      currency,
      amountUsd,
      amountIls,
      exchangeRate: final,
      vatRate,
      amountWithoutVat: totals.totalIlsWithoutVat,
      snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
      snapshotDollarFee: totals.snapshotDollarFee,
      snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
      totalIlsWithVat: totals.totalIlsWithVat,
      totalIlsWithoutVat: totals.totalIlsWithoutVat,
      vatAmount: totals.vatAmount,
      manualDateChanged,
      paymentMethod: form.paymentMethod,
      isPaid: true,
      notes: form.notes?.trim() || null,
      createdById: me.id,
    },
  });

  let orderNumber: string | null = null;
  if (oid) {
    const o = await prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: { orderNumber: true },
    });
    orderNumber = o?.orderNumber ?? null;
  }
  const uRaw = (form.amountUsd || "").trim().replace(",", ".") || "0";
  const iRaw = (form.amountIls || "").trim().replace(",", ".") || "0";
  const tRaw = (form.amountTransferIls || "").trim().replace(",", ".") || "0";
  const amountDisplay = `USD ${uRaw} · ₪ ${iRaw} · העברה ₪ ${tRaw}`;
  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "PAYMENT_RECEIVED",
      entityType: "Payment",
      entityId: pay.id,
      metadata: {
        paymentType,
        currency,
        amountDisplay,
        orderNumber: orderNumber ?? undefined,
        paymentCode: pay.paymentCode ?? undefined,
      } as Prisma.InputJsonValue,
    },
  });

  revalidateAllKpiCaches();
  invalidateOrdersListDataCache();
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  return {
    ok: true,
    saved: {
      paymentId: pay.id,
      paymentCode: pay.paymentCode,
      paymentType,
      customerLabel: custOk.displayName,
      customerCode: custOk.customerCode,
      paymentDateYmd: formatLocalYmd(paymentDate),
      paymentTimeHm: formatLocalHm(paymentDate),
      paymentPlace: form.paymentPlace?.trim() || null,
      paymentMethod: form.paymentMethod,
      amountDisplay,
      totalIlsWithVat: totals.totalIlsWithVat.toFixed(2),
      totalIlsWithoutVat: totals.totalIlsWithoutVat.toFixed(2),
      vatAmount: totals.vatAmount.toFixed(2),
      orderNumber,
    },
  };
}

export async function searchCustomersForOrderAction(
  query: string,
  workCountryRaw?: string | null,
): Promise<CustomerSearchRow[]> {
  return withPerfTimer("search.customers.capture", async () => {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return [];
    return searchCustomersPrisma(query, { limit: 20, workCountry: workCountryRaw });
  });
}

/** זיהוי לקוח לפי מזהה מערכת, קוד לקוח או קוד ישן — התאמה מדויקת בלבד */
export async function resolveCustomerForCaptureAction(
  raw: string,
  workCountryRaw?: string | null,
): Promise<CustomerSearchRow | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return null;

  const rows = await searchCustomersPrisma(raw, {
    limit: 1,
    exactOnly: true,
    workCountry: workCountryRaw,
  });
  return rows[0] ?? null;
}

/** רשימה קצרה לבחירה מהירה בטופס קליטה */
export async function listCustomersForOrderQuickPickAction(
  workCountryRaw?: string | null,
): Promise<CustomerSearchRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return [];

  const { resolveWorkCountryOrDefault } = await import("@/lib/work-country");
  const wc = resolveWorkCountryOrDefault(workCountryRaw);

  const rows = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null, countryCode: wc },
    take: 50,
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      customerType: true,
      city: true,
      phone: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    label: primaryCustomerDisplayName({
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      nameHe: r.nameHe,
      displayName: r.displayName,
    }),
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
    phone: r.phone,
  }));
}

/** קליטת הזמנה מינימלית — זיהוי לקוח לפי קוד לקוח בלבד */
export type CustomerLookupByCodePayload = {
  id: string;
  displayName: string;
  phone: string | null;
  address: string | null;
};

export async function lookupCustomerByCodeAction(
  code: string,
): Promise<{ ok: true; customer: CustomerLookupByCodePayload | null } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const q = code.trim();
  if (!q) return { ok: true, customer: null };

  const row = await prisma.customer.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      customerCode: { equals: q, mode: "insensitive" },
    },
    select: { id: true, displayName: true, phone: true, address: true },
  });

  if (!row) return { ok: true, customer: null };

  return {
    ok: true,
    customer: {
      id: row.id,
      displayName: row.displayName,
      phone: row.phone,
      address: row.address,
    },
  };
}

/** יצירת הזמנה מינימלית — ללא תשלומים/מטבע/עמלה (סכום יחיד בשקלים) */
export async function createMinimalOrderAction(form: {
  customerId: string;
  orderDateYmd: string;
  orderTimeHm: string;
  totalAmount: string;
}): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const custId = form.customerId.trim();
  if (!custId) return { ok: false, error: "יש לבחור לקוח לפי קוד" };

  let amt: Prisma.Decimal;
  try {
    amt = new Prisma.Decimal(form.totalAmount.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום לא תקין" };
  }
  if (amt.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

  const customer = await prisma.customer.findFirst({
    where: { id: custId, deletedAt: null, isActive: true },
    select: {
      id: true,
      customerCode: true,
      displayName: true,
      customerType: true,
      countryCode: true,
    },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const orderDate = parseLocalDateTime(form.orderDateYmd, form.orderTimeHm || "00:00");
  const weekCode = getWeekCodeForLocalDate(orderDate);
  const workCountry = normalizeWorkCountryCode(String(customer.countryCode)) ?? DEFAULT_WORK_COUNTRY;
  const sourceCountry = orderSourceCountryFromWorkCountry(workCountry);
  const { orderNumber, oldOrderNumber } = await generateNextOrderNumber(weekCode, workCountry);

  const zero = new Prisma.Decimal(0);

  await assertCreatedByUserExists(me.id);

  const order = await prisma.order.create({
    data: {
      orderNumber,
      oldOrderNumber,
      sourceCountry,
      countryCode: workCountry,
      customer: { connect: { id: customer.id } },
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.displayName,
      customerTypeSnapshot: (customer.customerType || "רגיל").trim() || "רגיל",
      weekCode,
      orderDate,
      status: OS.OPEN,
      paymentMethod: null,
      amountUsd: zero,
      commissionUsd: zero,
      totalUsd: zero,
      amountIls: amt,
      commissionIls: zero,
      totalIls: amt,
      exchangeRate: null,
      vatRate: prismaVatRatePercent(),
      amountWithoutVat: amt,
      snapshotBaseDollarRate: null,
      snapshotDollarFee: null,
      snapshotFinalDollarRate: null,
      usdRateUsed: null,
      totalIlsWithVat: amt,
      totalIlsWithoutVat: amt,
      vatAmount: zero,
      notes: null,
      createdBy: { connect: { id: me.id } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      metadata: { minimal: true, source: "minimal_capture" },
    },
  });

  revalidateAllKpiCaches();
  invalidateOrdersListDataCache();
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");

  return { ok: true };
}

export type CustomerCardOrderRow = {
  orderNumber: string | null;
  orderDateYmd: string;
  totalUsd: string;
  status: string;
};

export type CustomerCardSnapshot = {
  id: string;
  displayName: string;
  nameAr: string | null;
  nameHe: string | null;
  nameEn: string | null;
  customerCode: string | null;
  phone: string | null;
  phone2: string | null;
  country: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  customerType: string | null;
  orderCount: number;
  ordersUsdSum: string;
  recentOrders: CustomerCardOrderRow[];
};

import type { CustomerLedgerPayload } from "@/lib/customer-account-ledger";

export type {
  CustomerLedgerPayload,
  CustomerLedgerRow,
  CustomerLedgerRowKind,
} from "@/lib/customer-account-ledger";

/** כרטסת לקוח בחלון — פרטים + הזמנות אחרונות */
export async function getCustomerCardSnapshotAction(customerId: string): Promise<CustomerCardSnapshot | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return null;
  }
  const id = customerId.trim();
  if (!id) return null;
  const { getCachedCustomerCardSnapshot } = await import("@/lib/customer-card-snapshot-cache");
  return getCachedCustomerCardSnapshot(id);
}

export async function updateCustomerCardDetailsAction(form: {
  customerId: string;
  displayName: string;
  nameAr?: string | null;
  nameEn?: string | null;
  nameHe?: string | null;
  phone?: string | null;
  phone2?: string | null;
  country?: string | null;
  customerCode?: string | null;
  address?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const id = form.customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  const displayName = form.displayName.trim();
  if (!displayName) return { ok: false, error: "שם לקוח חובה" };
  const customerCode = form.customerCode?.trim() || null;

  if (customerCode) {
    const dup = await prisma.customer.findFirst({
      where: { id: { not: id }, customerCode: { equals: customerCode, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "מספר לקוח כבר קיים" };
  }

  await prisma.customer.update({
    where: { id },
    data: {
      displayName,
      ...(form.nameAr !== undefined ? { nameAr: form.nameAr?.trim() || null } : {}),
      ...(form.nameEn !== undefined ? { nameEn: form.nameEn?.trim() || null } : {}),
      ...(form.nameHe !== undefined ? { nameHe: form.nameHe?.trim() || null } : {}),
      phone: form.phone?.trim() || null,
      ...(form.phone2 !== undefined ? { phone2: form.phone2?.trim() || null } : {}),
      ...(form.country !== undefined
        ? { country: normalizeCustomerPlaceInput(form.country) }
        : {}),
      customerCode,
      address: form.address?.trim() || null,
    },
  });

  const { revalidateAfterCustomerCreate } = await import("@/lib/revalidate-customer-create");
  revalidateAfterCustomerCreate(id);
  revalidateAllKpiCaches();
  invalidateOrdersListDataCache();
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");

  recordActivityAudit({
    userId: me.id,
    actionType: "CUSTOMER_UPDATED",
    entityType: "Customer",
    entityId: id,
    metadata: { customerName: displayName, customerCode: customerCode ?? undefined },
  });

  return { ok: true };
}

export async function getCustomerLedgerAction(params: {
  customerId: string;
  fromYmd?: string | null;
  toYmd?: string | null;
  sourceCountry?: string | null;
}): Promise<CustomerLedgerPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return null;
  }

  const id = params.customerId.trim();
  if (!id) return null;

  const { buildCustomerAccountLedger } = await import("@/lib/customer-account-ledger");
  return buildCustomerAccountLedger(params);
}

export async function previewOrderNumberAction(weekCode: string): Promise<string> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) return "";
  const { nextOrderNumber } = await previewNextOrderNumberForWeek(weekCode);
  return nextOrderNumber;
}

/** מקומות קליטת הזמנה (IntakeLocation) לטופס הזמנה */
export async function listPaymentPointsForOrderAction(query?: string, limit?: number): Promise<{ id: string; label: string }[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return [];
  await ensureOrderGeoTables();
  const take = limit ?? (query?.trim() ? 80 : 500);
  const rows = await listIntakeLocationsForSelect((query ?? "").trim(), take);
  return rows.map((r) => ({ id: r.id, label: r.name }));
}

/** יצירת / איחוד מקום קליטת הזמנה (ללא כפילויות לפי lowercase+trim) */
export async function createPaymentPointForOrderAction(input: {
  pointName: string;
  city?: string | null;
}): Promise<{ ok: true; point: { id: string; label: string } } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return { ok: false, error: "אין הרשאה" };
  await ensureOrderGeoTables();

  try {
    const row = await findOrCreateIntakeLocationByName(input.pointName);
    revalidatePath("/admin");
    return { ok: true, point: { id: row.id, label: row.name } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה";
    return { ok: false, error: msg };
  }
}

/** פרטי תצוגה לטופס קליטת הזמנה (שמות, אינדקס, יתרה משוערת) */
export async function getCustomerOrderFormExtrasAction(
  customerId: string,
  workCountryRaw?: string | null,
): Promise<{
  /** שם באנגלית — כולל תאימות לשדה ישן nameHe */
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  indexLabel: string | null;
  city: string | null;
  address: string | null;
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
} | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return null;

  const id = customerId.trim();
  if (!id) return null;

  const cust = await prisma.customer.findFirst({
    where: { id, deletedAt: null, isActive: true },
    select: {
      nameHe: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      phone2: true,
      oldCustomerCode: true,
      customerCode: true,
      city: true,
      address: true,
    },
  });
  if (!cust) return null;

  const { getCustomerOpenDebt, openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");
  const debt = await getCustomerOpenDebt(id, openDebtScopeForWorkCountry(workCountryRaw));
  const businessSigned = Number(debt.signedBalanceUsd.toFixed(2));
  const indexLabel = cust.oldCustomerCode?.trim() || cust.customerCode?.trim() || null;

  return {
    nameEn: cust.nameEn ?? cust.nameHe ?? null,
    nameAr: cust.nameAr,
    phone: cust.phone ?? cust.phone2,
    indexLabel,
    city: cust.city?.trim() || null,
    address: cust.address?.trim() || null,
    balanceUsdDisplay: businessSigned.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    balanceUsdNegative: businessSigned < -0.005,
  };
}

/** חוב פתוח — מקור חישוב יחיד (ללא cache) */
export async function fetchCustomerOpenDebtAction(
  customerId: string,
  workCountryRaw?: string | null,
): Promise<
  | {
      ok: true;
      openDebtUsd: string;
      signedBalanceUsd: string;
      internalSignedUsd: string;
      totalOrdersUsd: string;
      totalPaymentsUsd: string;
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments", "view_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const id = customerId.trim();
  if (!id) return { ok: false, error: "חסר לקוח" };

  const { getCustomerOpenDebt, openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");
  const debt = await getCustomerOpenDebt(id, openDebtScopeForWorkCountry(workCountryRaw));
  return {
    ok: true,
    openDebtUsd: debt.openDebtUsd.toFixed(2),
    signedBalanceUsd: debt.signedBalanceUsd.toFixed(2),
    internalSignedUsd: debt.internalSignedUsd.toFixed(2),
    totalOrdersUsd: debt.totalOrdersUsd.toFixed(2),
    totalPaymentsUsd: debt.totalPaymentsUsd.toFixed(2),
  };
}

export async function captureOrderAction(form: {
  weekCode: string;
  orderExecutionDateYmd?: string;
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  orderDateYmd?: string;
  orderTimeHm?: string;
  /** אופציונלי: מספר הזמנה מלא בפורמט {weekCode}-#### — חייב להיות ייחודי */
  orderNumber?: string | null;
  /** שער דולר סופי לחישוב ₪ (עקיפת הגדרות גלובליות) */
  finalRateOverride?: string | null;
  customerId: string;
  /** אופציונלי — ברירת מחדל מרשומת הלקוח */
  customerTypeSnapshot?: string | null;
  amountUsd: string;
  feeUsd: string;
  /** אחוז עמלה שנבחר בקליטה — נשמר על ההזמנה */
  commissionPercent?: string | null;
  paymentMethod: string;
  status: string;
  notes?: string;
  /** נקודת תשלום (אופציונלי) */
  paymentPointId?: string | null;
  /** שורות תשלום נוספות (USD) — נשמרות אחרי ההזמנה; סכוםן לא יעלה על totalUsd */
  paymentLines?: OrderCapturePaymentLineInput[];
  /** חלוקת "תשלום מורכב" — כאשר paymentMethod=COMPOSITE. [] = ניקוי חלוקה */
  paymentBreakdown?: OrderBreakdownLineInput[];
  /** אחוז מע״מ (ברירת מחדל 18 — תאימות אחורה) */
  vatPercent?: string | null;
  /** מקור / מדינת ספק */
  sourceCountry?: OrderCountryCode | string | null;
  locationId?: string | null;
  /** כשאין id נבחר — שם חופשי; בשרת יווצר IntakeLocation בשמירה */
  intakeLocationDraftName?: string | null;
  /** טיוטת שמות מהטופס — עדכון nameAr/nameEn בלקוח רק כשהשדה ריק במסד */
  draftNameAr?: string | null;
  draftNameEn?: string | null;
} & CaptureOrderFormExtras): Promise<CaptureState> {
  return captureOrderActionInner(form, null);
}

export async function captureOrderActionForApi(
  form: Parameters<typeof captureOrderAction>[0],
  session: SessionPayload,
  preAuthenticated?: AppUser | null,
): Promise<CaptureState> {
  return captureOrderActionInner(form, session, preAuthenticated);
}

async function captureOrderActionInner(
  form: Parameters<typeof captureOrderAction>[0],
  apiSession: SessionPayload | null,
  preAuthenticated?: AppUser | null,
): Promise<CaptureState> {
  const perf = new CaptureSavePerf();
  const cacheT0 = Date.now();
  warmCaptureHotPathCaches();
  perf.cacheRefreshMs = Date.now() - cacheT0;

  const actor = preAuthenticated
    ? preAuthenticated
    : await perf.time("authMs", () => resolveCaptureActor(apiSession));
  if ("error" in actor) return { ok: false, error: actor.error };
  const me = actor;

  const validationT0 = Date.now();
  capturePerfTimeStart("capture.validation");
  if (!userHasAnyPermission(me, ["create_orders"])) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "אין הרשאה" };
  }

  if (!form.customerId?.trim()) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "יש לבחור לקוח" };
  }

  if (!isCompositePaymentMethod(form.paymentMethod) && !PAYMENT_METHODS.has(form.paymentMethod)) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const status = (form.status?.trim() || OS.OPEN).trim();
  const allowed = getActiveOrderStatusIdsSync();
  if (!status || !allowed.has(status)) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "סטטוס הזמנה לא תקין" };
  }

  const orderDateYmdEarly = (form.orderExecutionDateYmd ?? form.orderDateYmd ?? "").trim();
  if (!orderDateYmdEarly || !isValidYmd(orderDateYmdEarly)) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "יש להזין תאריך הזמנה תקין" };
  }
  capturePerfTimeEnd("capture.validation");
  perf.validateInputMs = Date.now() - validationT0;
  void getActiveOrderStatusIdsCached();
  await ensureOrderCommissionPercentColumn();

  const wcEarly = deriveAhWeekCodeFromOrderDateYmd(orderDateYmdEarly) ?? DEFAULT_WEEK_CODE;
  const requestedOrderNumber = form.orderNumber?.trim() || "";
  const ratesResult = await perf.time("exchangeRateMs", () => resolveCaptureRatesForSave(form));
  if (!ratesResult.ok) return { ok: false, error: ratesResult.error };
  const ratesResolved = ratesResult.rates;

  const countriesFromClient = parseEnabledCountriesFromForm(form.enabledCountries);

  const [
    customerResolved,
    allowedCountriesPre,
    allocated,
    requestedExists,
    resolvedLoc,
  ] = await perf.time("phase1Ms", () =>
    capturePerfTimed("capture.phase1", () =>
      Promise.all([
        loadCustomerForCapture(form.customerId, form.customerSnapshot, {
          draftNameAr: form.draftNameAr,
          draftNameEn: form.draftNameEn,
        }, me.id),
        countriesFromClient
          ? Promise.resolve(countriesFromClient)
          : loadCaptureSettingsCountries(),
        requestedOrderNumber && requestedOrderNumber !== "—"
          ? Promise.resolve(null)
          : capturePerfTimed("capture.generateOrderNumber", () =>
              generateNextOrderNumber(
                wcEarly,
                workCountryFromOrderSourceCountry(form.sourceCountry),
              ),
            ),
        requestedOrderNumber && requestedOrderNumber !== "—"
          ? prisma.order.findUnique({
              where: { orderNumber: requestedOrderNumber },
              select: { id: true, isActive: true },
            }).then((o) => (o?.isActive ? o : null))
          : Promise.resolve(null),
        resolveOrderIntakeLocationColumnValue({
          fieldId: (form.paymentPointId?.trim() || form.locationId?.trim() || "") || undefined,
          draftName: form.intakeLocationDraftName,
        }),
      ]),
    ),
  );
  if (!customerResolved) return { ok: false, error: "לקוח לא נמצא" };
  const customer = customerResolved.customer;
  if (customerResolved.created) {
    capturePerfLog({
      customerCreatedOnOrderSave: true,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.displayName,
    });
    scheduleCaptureAuditInsert(() =>
      prisma.auditLog.create({
        data: {
          userId: me.id,
          actionType: "CUSTOMER_CREATED",
          entityType: "Customer",
          entityId: customer.id,
          metadata: { source: "order_capture_ensure" } as Prisma.InputJsonValue,
        },
      }),
    );
  }
  if (!resolvedLoc.ok) return { ok: false, error: resolvedLoc.error };

  // Apply Ar/En name drafts only if needed — fire-and-forget; result already known locally.
  const namePatchesCreate = computeCustomerNamePatches(
    { nameAr: customer.nameAr, nameEn: customer.nameEn },
    form.draftNameAr ?? "",
    form.draftNameEn ?? "",
  );
  if (Object.keys(namePatchesCreate).length > 0) {
    await perf.time("updateCustomerMs", () =>
      prisma.customer.update({ where: { id: customer.id }, data: namePatchesCreate }).catch(() => {}),
    );
  }

  const base = ratesResolved.base;
  const fee = ratesResolved.fee;
  const finalRate = ratesResolved.final;
  const commissionPercentRaw = (form.commissionPercent ?? "").trim().replace(",", ".");
  const commissionPercentNum = Number(commissionPercentRaw || "0");
  const commissionPercentDec = new Prisma.Decimal(
    Number.isFinite(commissionPercentNum) && commissionPercentNum > 0 ? commissionPercentNum.toString() : "0",
  ).toDecimalPlaces(4, 4);
  let vatPctNum = 18;
  const rawVatPct = form.vatPercent?.trim().replace(",", ".");
  if (rawVatPct) {
    const n = Number(rawVatPct);
    if (Number.isFinite(n) && n >= 0 && n <= 100) vatPctNum = n;
  }
  const vatRate = new Prisma.Decimal(String(vatPctNum));

  let deal: Prisma.Decimal;
  try {
    deal = new Prisma.Decimal(form.amountUsd.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום (USD) לא תקין" };
  }
  if (deal.lte(0)) return { ok: false, error: "סכום USD חייב להיות חיובי" };

  let commissionUsd = new Prisma.Decimal(0);
  const rawFee = (form.feeUsd || "").trim().replace(",", ".");
  if (rawFee) {
    try {
      const v = new Prisma.Decimal(rawFee);
      if (v.lt(0)) return { ok: false, error: "עמלה USD לא יכולה להיות שלילית" };
      commissionUsd = v.toDecimalPlaces(4, 4);
    } catch {
      return { ok: false, error: "עמלה USD לא תקינה" };
    }
  }

  const totalUsd = deal.add(commissionUsd).toDecimalPlaces(4, 4);
  const bdResolved = resolveOrderBreakdownRows(form, totalUsd, finalRate);
  if (!bdResolved.ok) return bdResolved;
  const breakdownRows = bdResolved.rows;
  const payParse = parseOrderPaymentLines(form.paymentLines, finalRate);
  if (!payParse.ok) return payParse;
  if (isDebtWithdrawalOrderStatus(status)) {
    if (payParse.parsed.length > 0) {
      return { ok: false, error: "הזמנת משיכה מחוב אינה כוללת שורות תשלום — הסכום מקטין חוב בלבד" };
    }
  } else if (payParse.parsed.length > 0) {
    const diff = payParse.sum.sub(totalUsd).abs();
    if (diff.gt(new Prisma.Decimal("0.01"))) {
      return {
        ok: false,
        error: "סכום שורות התשלום חייב להיות שווה לסה״כ ההזמנה בדולר (סטייה מקסימלית 0.01)",
      };
    }
  }

  const totals = computeFromUsdAmount(totalUsd, {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: finalRate,
    vatRate,
  });

  const dealIlsGross = deal.mul(finalRate).toDecimalPlaces(2, 4);
  const commissionIlsGross = commissionUsd.mul(finalRate).toDecimalPlaces(2, 4);

  const datesResolved = resolveOrderCaptureDates(form);
  if (!datesResolved.ok) return datesResolved;
  const { orderExecutionDate, intakeDateTime, orderDate, weekCode } = datesResolved;
  const typeSnap = (form.customerTypeSnapshot?.trim() || customer.customerType || "רגיל").trim() || "רגיל";

  let orderNumber: string;
  let oldOrderNumber: string;
  let sequenceForPreview = 0;

  if (requestedOrderNumber && requestedOrderNumber !== "—") {
    const normalized = requestedOrderNumber.trim();
    if (!orderNumberMatchesWeekFormat(normalized, wcEarly)) {
      return { ok: false, error: "פורמט מספר הזמנה לא תקין (נדרש: קודשבוע-0001)" };
    }
    if (requestedExists) return { ok: false, error: "מספר הזמנה זה כבר קיים במערכת" };
    orderNumber = normalized;
    oldOrderNumber = normalized.slice(wcEarly.length + 1);
    const m = oldOrderNumber.match(/^\d{4}$/);
    if (m) sequenceForPreview = parseInt(oldOrderNumber, 10);
  } else {
    if (!allocated) {
      const fresh = await capturePerfTimed("capture.generateOrderNumber", () =>
        generateNextOrderNumber(weekCode, workCountryFromOrderSourceCountry(form.sourceCountry)),
      );
      orderNumber = fresh.orderNumber;
      oldOrderNumber = fresh.oldOrderNumber;
      sequenceForPreview = fresh.sequence;
    } else {
      orderNumber = allocated.orderNumber;
      oldOrderNumber = allocated.oldOrderNumber;
      sequenceForPreview = allocated.sequence;
    }
  }

  const rawCountry = form.sourceCountry?.trim();
  if (!rawCountry) {
    return { ok: false, error: "יש לבחור מדינת מקור" };
  }
  if (!ORDER_COUNTRY_CODES.includes(rawCountry as OrderCountryCode)) {
    return { ok: false, error: "מדינת מקור לא תקינה" };
  }
  if (!allowedCountriesPre.includes(rawCountry as OrderCountryCode)) {
    return { ok: false, error: "מדינה זו אינה מופעלת בהגדרות המערכת" };
  }
  const sourceCountryCreate = rawCountry as OrderCountryCode;

  // האם המספר הופק אוטומטית (ולכן מותר להפיק מחדש בעת התנגשות)
  const autoOrderNumber = !(requestedOrderNumber && requestedOrderNumber !== "—");
  const ORDER_NUMBER_MAX_ATTEMPTS = 5;
  let orderNumberCollisionRecovered = false;

  capturePerfTimeStart("capture.insertOrder");
  const runCreateTransaction = () =>
    prisma.$transaction(async (tx) => {
      const tOrder = Date.now();
      const created = await tx.order.create({
        data: {
          orderNumber,
          oldOrderNumber,
          customerId: customer.id,
          customerCodeSnapshot: customer.customerCode,
          customerNameSnapshot: customer.displayName,
          customerTypeSnapshot: typeSnap,
          weekCode,
          sourceCountry: sourceCountryCreate,
          countryCode: workCountryFromOrderSourceCountry(sourceCountryCreate),
          orderDate,
          orderExecutionDate,
          intakeDateTime,
          status,
          paymentMethod: form.paymentMethod,
          paymentPointId: resolvedLoc.paymentPointIdForPrisma,
          amountUsd: deal,
          commissionUsd,
          totalUsd,
          exchangeRate: finalRate,
          commissionPercent: commissionPercentDec,
          vatRate,
          amountWithoutVat: totals.totalIlsWithoutVat,
          snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
          snapshotDollarFee: totals.snapshotDollarFee,
          snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
          totalIlsWithVat: totals.totalIlsWithVat,
          totalIlsWithoutVat: totals.totalIlsWithoutVat,
          vatAmount: totals.vatAmount,
          totalIls: totals.totalIlsWithVat,
          amountIls: dealIlsGross,
          commissionIls: commissionIlsGross,
          notes: form.notes?.trim() || null,
          locationId: resolvedLoc.locationId ?? null,
          createdById: me.id,
        },
        select: { id: true, orderNumber: true },
      });
      console.log("[order.save]", {
        orderNumber,
        exchangeRate: finalRate.toFixed(4),
        commissionPercent: commissionPercentDec.toFixed(2),
      });
      perf.add("createOrderMs", Date.now() - tOrder);

      if (payParse.parsed.length > 0) {
        const tItems = Date.now();
        await capturePerfTimed("capture.insertItems", () =>
          appendParsedPaymentsForOrder(
            {
              meId: me.id,
              orderId: created.id,
              customerId: customer.id,
              weekCode,
              paymentDate: orderDate,
              parsed: payParse.parsed,
              base,
              fee,
              final: finalRate,
              vatRate,
            },
            tx,
          ),
        );
        perf.add("createItemsMs", Date.now() - tItems);
      }

      if (breakdownRows.length > 0 && !isDebtWithdrawalOrderStatus(status)) {
        await writeOrderBreakdown(tx, created.id, breakdownRows, {
          userId: me.id,
          intakeWeekCode: weekCode,
        });
      }

      return created;
    });

  // Retry על התנגשות מספר הזמנה (P2002): מפיקים מספר חדש (מסונכרן מול ה-MAX)
  // ומנסים שוב עד 5 פעמים — בלי להקריס את המסך.
  let createdOrderResult: Awaited<ReturnType<typeof runCreateTransaction>> | null = null;
  for (let attempt = 1; attempt <= ORDER_NUMBER_MAX_ATTEMPTS; attempt++) {
    try {
      createdOrderResult = await capturePerfTimed("capture.insertOrderRow", runCreateTransaction);
      break;
    } catch (e) {
      if (!isUniqueOrderNumberError(e)) throw e;
      if (!autoOrderNumber) {
        capturePerfTimeEnd("capture.insertOrder");
        return { ok: false, error: "מספר הזמנה זה כבר קיים במערכת" };
      }
      if (attempt >= ORDER_NUMBER_MAX_ATTEMPTS) {
        capturePerfTimeEnd("capture.insertOrder");
        return { ok: false, error: "מספר הזמנה כבר קיים במערכת — נסו לשמור שוב" };
      }
      const fresh = await regenerateOrderNumberAfterCollision(
        weekCode,
        workCountryFromOrderSourceCountry(form.sourceCountry),
      );
      orderNumber = fresh.orderNumber;
      oldOrderNumber = fresh.oldOrderNumber;
      sequenceForPreview = fresh.sequence;
      orderNumberCollisionRecovered = true;
    }
  }
  capturePerfTimeEnd("capture.insertOrder");
  if (!createdOrderResult) {
    return { ok: false, error: "שמירת ההזמנה נכשלה" };
  }
  const order = createdOrderResult;

  if (isDebtWithdrawalOrderStatus(status)) {
    const dw = await applyDebtWithdrawalForOrder({
      orderId: order.id,
      customerId: customer.id,
      orderTotalUsd: Number(totalUsd),
    });
    if (!dw.ok) return { ok: false, error: dw.error };
    void prisma.auditLog
      .create({
        data: {
          userId: me.id,
          actionType: "ORDER_DEBT_WITHDRAWAL_APPLIED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            orderTotalUsd: Number(totalUsd),
            withdrawnUsd: dw.debtWithdrawalUsd,
            source: "order_capture_create",
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  }

  const auditT0 = Date.now();
  scheduleCaptureAuditInsert(() =>
    prisma.auditLog.create({
      data: {
        userId: me.id,
        actionType: "ORDER_CREATED",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          orderNumber,
          customerName: customer.displayName,
        } as Prisma.InputJsonValue,
      },
    }),
  );
  perf.auditMs = Date.now() - auditT0;

  const nextPreview =
    !requestedOrderNumber || requestedOrderNumber === "—"
      ? previewOrderNumberAfter({ orderNumber, sequence: sequenceForPreview })
      : null;

  capturePerfTimeStart("capture.response");
  const out: CaptureState = await perf.time("responseSerializationMs", async () => ({
    ok: true as const,
    saved: {
      orderId: order.id,
      orderNumber: order.orderNumber ?? "",
      customerLabel: customer.displayName,
      totalUsd: totalUsd.toFixed(2),
      payments: payParse.parsed.map((p) => ({
        paymentMethod: p.method,
        amountUsd: p.amount.toFixed(2),
      })),
    },
    orderNumber: order.orderNumber ?? orderNumber,
    nextOrderNumberPreview: nextPreview,
    notice: orderNumberCollisionRecovered
      ? "מספר הזמנה כבר קיים במערכת, נוצר מספר חדש אוטומטית."
      : null,
  }));
  capturePerfTimeEnd("capture.response");
  perf.logSummary({ mode: "create", orderId: order.id, orderNumber });
  return out;
}

export type OrderWorkPanelPayload = {
  id: string;
  weekCode: string;
  orderExecutionDateYmd: string;
  intakeDateYmd: string;
  intakeTimeHm: string;
  /** תאימות — תאריך עסקי (orderDate) */
  orderDateYmd: string;
  orderTimeHm: string;
  orderNumber: string;
  customerId: string;
  customerLabel: string;
  customerCode: string | null;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: string;
  /** חלוקת "תשלום מורכב" — ריק אם ההזמנה אינה מורכבת */
  paymentBreakdown: { paymentMethod: string; amount: string; currency: BreakdownCurrency }[];
  paymentPointId: string | null;
  locationId: string | null;
  locationName: string | null;
  status: string;
  usdRateUsed: string;
  commissionPercent: string;
  notes: string;
  sourceCountry: string | null;
  /** סכום USD שכבר שולם בתשלומים מקושרים */
  existingPaymentsUsdSum: string;
  /** סה״כ USD של ההזמנה (לווידוא תשלומים) */
  orderTotalUsd: string;
  /** נעילת עריכה — עובדים שולחים בקשת עדכון במקום שמירה ישירה */
  editGate: {
    employeeEditBlocked: boolean;
    hasPendingEditRequest: boolean;
    pendingEditRequestOwnedByMe: boolean;
    /** האם שמירה דורשת אישור מנהל (עובדים בלבד) */
    requiresApprovalOnSave: boolean;
    /** סטטוס בקשת העדכון האחרונה להצגת badge */
    latestUpdateRequestStatus: OrderEditRequestStatus | null;
    latestUpdateRequestOwnedByMe: boolean;
    unlockExpiresAtIso: string | null;
    viewerIsAdmin: boolean;
  };
};

export async function getOrderForWorkPanelAction(orderId: string): Promise<OrderWorkPanelPayload | null> {
  return withPerfTimer("orders.getOrderForWorkPanel", async () => {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["view_orders", "edit_orders"])) return null;

    const id = orderId.trim();
    if (!id) return null;
    await ensureOrderGeoTables();
    await ensureIntakeLocationTable();
    await ensureOrderCommissionPercentColumn();

    const order = await prisma.order.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        weekCode: true,
        orderDate: true,
        orderExecutionDate: true,
        intakeDateTime: true,
        createdAt: true,
        orderNumber: true,
        customerId: true,
        customerNameSnapshot: true,
        customerCodeSnapshot: true,
        amountUsd: true,
        commissionUsd: true,
        paymentMethod: true,
        paymentBreakdown: {
          select: { paymentMethod: true, amount: true, currency: true },
          orderBy: { createdAt: "asc" },
        },
        paymentPointId: true,
        paymentPoint: {
          select: { pointName: true, city: true },
        },
        status: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        commissionPercent: true,
        notes: true,
        totalUsd: true,
        sourceCountry: true,
        customer: {
          select: { id: true, displayName: true, customerCode: true },
        },
      },
    });
    if (!order) return null;

    const geoRows = await prisma.$queryRaw<Array<{ locationId: string | null; locationName: string | null }>>`
      SELECT
        o."locationId" AS "locationId",
        COALESCE(il."name", ol."name") AS "locationName"
      FROM "Order" o
      LEFT JOIN "IntakeLocation" il ON il."id" = o."locationId"
      LEFT JOIN "OrderLocations" ol ON ol."id" = o."locationId"
      WHERE o."id" = ${order.id}
      LIMIT 1
    `;
    const geo = geoRows[0];

    const deal = order.amountUsd ?? new Prisma.Decimal(0);
    const com = order.commissionUsd ?? new Prisma.Decimal(0);
    const od = order.orderDate ?? order.orderExecutionDate ?? new Date();
    const intakeDt = order.intakeDateTime ?? order.createdAt ?? od;
    const intakeParsed = intakeDt ? new Date(intakeDt) : od;
    const rateUsed = order.usdRateUsed ?? order.snapshotFinalDollarRate ?? order.exchangeRate ?? new Prisma.Decimal(0);
    const commissionPct = order.commissionPercent ?? new Prisma.Decimal(0);
    console.log("[order.open]", {
      orderNumber: order.orderNumber ?? null,
      exchangeRate: rateUsed.toFixed(4),
      commissionPercent: commissionPct.toFixed(2),
    });

    const label = order.customer?.displayName ?? order.customerNameSnapshot ?? "";
    const cid = order.customerId ?? order.customer?.id ?? "";
    if (!cid) return null;

    const payAgg = await prisma.payment.aggregate({
      where: { orderId: order.id, amountUsd: { not: null } },
      _sum: { amountUsd: true },
    });
    const existingPayUsd = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
    const orderTotalUsdVal = order.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

    await clearExpiredOrderEditUnlockForOrder(order.id);

    const gateRow = await prisma.order.findFirst({
      where: { id: order.id },
      select: {
        status: true,
        editUnlockedForUserId: true,
        editUnlockedUntil: true,
      },
    });
    const pendingReq = await prisma.orderEditRequest.findFirst({
      where: { orderId: order.id, status: OrderEditRequestStatus.PENDING },
      select: { requestedByUserId: true },
    });
    const latestReq = await prisma.orderEditRequest.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      select: { status: true, requestedByUserId: true },
    });

    const viewerIsAdmin = isAdminUser(me);
    const unlockUntil = gateRow?.editUnlockedUntil ?? null;
    const unlockForMe =
      gateRow?.editUnlockedForUserId === me.id &&
      unlockUntil != null &&
      unlockUntil.getTime() > Date.now();
    const unlockExpiresAtIso = unlockForMe ? unlockUntil.toISOString() : null;

    return {
      id: order.id,
      weekCode:
        deriveAhWeekCodeFromOrderDateYmd(formatLocalYmd(od)) ??
        ((order.weekCode ?? "").trim() || DEFAULT_WEEK_CODE),
      orderExecutionDateYmd: formatLocalYmd(od),
      intakeDateYmd: formatLocalYmd(intakeParsed),
      intakeTimeHm: formatLocalHm(intakeParsed),
      orderDateYmd: formatLocalYmd(od),
      orderTimeHm: formatLocalHm(intakeParsed),
      orderNumber: order.orderNumber ?? "—",
      customerId: cid,
      customerLabel: label,
      customerCode: order.customer?.customerCode ?? order.customerCodeSnapshot ?? null,
      amountUsd: deal.toString(),
      feeUsd: com.toString(),
      paymentMethod: order.paymentMethod ?? PM.BANK_TRANSFER,
      paymentBreakdown: order.paymentBreakdown.map((b) => ({
        paymentMethod: b.paymentMethod,
        amount: b.amount.toString(),
        currency: (b.currency === "ILS" ? "ILS" : "USD") as BreakdownCurrency,
      })),
      paymentPointId: order.paymentPointId ?? null,
      locationId: geo?.locationId ?? null,
      locationName:
        geo?.locationName ??
        (order.paymentPoint?.city ? `${order.paymentPoint.pointName} · ${order.paymentPoint.city}` : order.paymentPoint?.pointName ?? null),
      status: order.status,
      usdRateUsed: rateUsed.toFixed(4),
      commissionPercent: commissionPct.toFixed(2),
      notes: order.notes ?? "",
      existingPaymentsUsdSum: existingPayUsd.toFixed(4),
      orderTotalUsd: orderTotalUsdVal.toFixed(4),
      sourceCountry: coerceOrderCountryForForm(order.sourceCountry) || null,
      editGate: {
        employeeEditBlocked: false,
        hasPendingEditRequest: !!pendingReq,
        pendingEditRequestOwnedByMe: pendingReq?.requestedByUserId === me.id,
        requiresApprovalOnSave: false,
        latestUpdateRequestStatus: latestReq?.status ?? null,
        latestUpdateRequestOwnedByMe: latestReq?.requestedByUserId === me.id,
        unlockExpiresAtIso,
        viewerIsAdmin,
      },
    };
  }).catch((error) => {
    perfError("orders.getOrderForWorkPanel.failed", error, { orderId });
    return null;
  });
}

async function isAllowedListStatus(status: string): Promise<boolean> {
  return getActiveOrderStatusIdsSync().has(status);
}

/**
 * חישוב הסכום הזמין לקיזוז מקרדיט הלקוח (USD), לפי הנוסחה
 * הקיימת של customer balance: payments − orders.
 * מחזיר 0 אם ללקוח אין יתרת זכות.
 */
async function computeAvailableCustomerCreditUsd(
  customerId: string,
  excludeOrderDebtWithdrawalUsd: number,
): Promise<number> {
  const [regularOrderAgg, withdrawalAgg, payAgg] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId, deletedAt: null, status: { not: OS.DEBT_WITHDRAWAL } },
      _sum: { totalUsd: true },
    }),
    prisma.order.aggregate({
      where: { customerId, deletedAt: null, status: OS.DEBT_WITHDRAWAL },
      _sum: { debtWithdrawalUsd: true },
    }),
    prisma.payment.aggregate({
      where: { customerId, isPaid: true },
      _sum: { amountUsd: true },
    }),
  ]);
  const regularOrders = Number(regularOrderAgg._sum.totalUsd ?? 0);
  const withdrawals = Number(withdrawalAgg._sum.debtWithdrawalUsd ?? 0);
  const payments = Number(payAgg._sum.amountUsd ?? 0);
  const credit =
    payments - regularOrders + withdrawals + Math.max(0, excludeOrderDebtWithdrawalUsd);
  return Math.max(0, credit);
}

async function applyDebtWithdrawalForOrder(params: {
  orderId: string;
  customerId: string;
  orderTotalUsd: number;
  alreadyAppliedUsd?: number;
}): Promise<{ ok: true; debtWithdrawalUsd: number } | { ok: false; error: string }> {
  const { orderId, orderTotalUsd } = params;
  if (!(orderTotalUsd > 0)) {
    return { ok: false, error: "אי אפשר למשוך מהחוב — סכום ההזמנה לא תקין" };
  }
  // Business rule (WEGO): משיכה מחוב אינה תלויה ביתרת זכות.
  // משיכה מחוב מתנהגת כמו תשלום (מורידה יתרה), ולכן ניישם את מלוא סכום ההזמנה.
  const toWithdraw = orderTotalUsd;
  const toWithdrawDec = new Prisma.Decimal(toWithdraw.toFixed(4));
  await prisma.order.update({
    where: { id: orderId },
    data: { status: OS.DEBT_WITHDRAWAL, debtWithdrawalUsd: toWithdrawDec, isCompleted: false },
  });
  return { ok: true, debtWithdrawalUsd: toWithdraw };
}

export async function updateOrderListStatusAction(
  orderId: string,
  status: string,
): Promise<{ ok: true; debtWithdrawalUsd?: number } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  if (!isAdminUser(me)) {
    return { ok: false, error: "עדכון הזמנה דורש אישור מנהל. פתחו את ההזמנה ושלחו בקשת עדכון." };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  if (!(await isAllowedListStatus(status))) {
    return { ok: false, error: "סטטוס לא חוקי" };
  }

  const exists = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      status: true,
      customerId: true,
      totalUsd: true,
      debtWithdrawalUsd: true,
      editUnlockedForUserId: true,
      editUnlockedUntil: true,
    },
  });
  if (!exists) return { ok: false, error: "הזמנה לא נמצאה" };

  await clearExpiredOrderEditUnlockForOrder(id);
  const gate = await prisma.order.findFirst({
    where: { id },
    select: { status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!gate || !canUserEditCompletedOrder(me, gate)) {
    return { ok: false, error: "הזמנה במצב ״בוצע״ או ״מבוטל״ נעולה — שינוי סטטוס דורש אישור מנהל." };
  }

  /**
   * משיכה מהחוב — לוגיקה ייעודית:
   * 1) מחשבים את היתרה הפנויה של הלקוח (payments − orders).
   * 2) הסכום שנמשך = min(totalUsd של ההזמנה, היתרה הפנויה).
   * 3) שומרים על העמודה החדשה debtWithdrawalUsd; לא יוצרים Payment record
   *    כדי לא לזהם את "סה״כ תשלומים" / דוחות הכנסה. יתרת הלקוח
   *    תמשיך להיות נכונה דרך orders − payments הקיים.
   */
  if (status === OS.DEBT_WITHDRAWAL) {
    if (!exists.customerId) {
      return { ok: false, error: "אי אפשר למשוך מהחוב — להזמנה אין לקוח משויך" };
    }
    const orderTotal = Number(exists.totalUsd ?? 0);
    const alreadyApplied = Number(exists.debtWithdrawalUsd ?? 0);
    const dw = await applyDebtWithdrawalForOrder({
      orderId: id,
      customerId: exists.customerId,
      orderTotalUsd: orderTotal,
      alreadyAppliedUsd: alreadyApplied,
    });
    if (!dw.ok) return dw;

    void prisma.auditLog
      .create({
        data: {
          userId: me.id,
          actionType: "ORDER_DEBT_WITHDRAWAL_APPLIED",
          entityType: "Order",
          entityId: id,
          metadata: {
            orderTotalUsd: orderTotal,
            withdrawnUsd: dw.debtWithdrawalUsd,
            source: "orders_list_status",
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
    revalidateAllKpiCaches();
    invalidateOrdersListDataCache();
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");
    revalidatePath(`/admin/orders/${id}`);
    return { ok: true, debtWithdrawalUsd: dw.debtWithdrawalUsd };
  }

  /**
   * מעבר משינוי "משיכה מהחוב" לכל סטטוס אחר — מאפסים את
   * debtWithdrawalUsd כדי שיתרת הלקוח לא תיוותר עם קיזוז שגוי.
   */
  if (status === OS.CANCELLED) {
    if (exists.status === OS.CANCELLED) {
      return { ok: false, error: "ההזמנה כבר מבוטלת" };
    }
    if (!exists.customerId) {
      return { ok: false, error: "אי אפשר לבטל — להזמנה אין לקוח משויך" };
    }
    await executeOrderCancellation({
      orderId: id,
      actorUserId: me.id,
      actorFullName: me.fullName,
      directByAdmin: true,
    });
    invalidateOrdersListDataCache();
    revalidatePath("/admin");
    revalidatePath(`/admin/orders/${id}`);
    return { ok: true };
  }

  const shouldClearDebtWithdrawal =
    exists.status === OS.DEBT_WITHDRAWAL &&
    status !== OS.DEBT_WITHDRAWAL &&
    exists.debtWithdrawalUsd != null;

  await prisma.order.update({
    where: { id },
    data: {
      status,
      ...(shouldClearDebtWithdrawal ? { debtWithdrawalUsd: null } : {}),
    },
  });

  revalidateAllKpiCaches();
  invalidateOrdersListDataCache();
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  revalidatePath(`/admin/orders/${id}`);

  return { ok: true };
}

export type UpdateOrderListStatusApiResult =
  | { ok: true; debtWithdrawalUsd?: number }
  | { ok: false; error: string };

/**
 * Fast API-path update for orders list status.
 * - מאומת מראש ב-requireApiAuth (ללא resolveCaptureActor כפול)
 * - ללא revalidate / KPI / יתרות / refetch רשימה
 */
export async function updateOrderListStatusActionForApi(
  orderId: string,
  statusRaw: string,
  me: AppUser,
  perf?: Pick<OrderStatusUpdatePerf, "AUTH_MS">,
): Promise<UpdateOrderListStatusApiResult> {
  const startedAt = performance.now();
  let findOrderMs = 0;
  let updateOrderMs = 0;
  const recalcBalancesMs = 0;
  const refreshDataMs = 0;

  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  const status = statusRaw.trim();
  if (!status || !getActiveOrderStatusIdsSync().has(status)) {
    return { ok: false, error: "סטטוס לא חוקי" };
  }

  const findT0 = performance.now();
  const exists = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      status: true,
      customerId: true,
      totalUsd: true,
      debtWithdrawalUsd: true,
      editUnlockedForUserId: true,
      editUnlockedUntil: true,
    },
  });
  findOrderMs = Math.round(performance.now() - findT0);
  if (!exists) return { ok: false, error: "הזמנה לא נמצאה" };

  const unlockExpired =
    exists.editUnlockedUntil != null && exists.editUnlockedUntil.getTime() < Date.now();
  const effectiveGate = unlockExpired
    ? { status: exists.status, editUnlockedForUserId: null, editUnlockedUntil: null }
    : {
        status: exists.status,
        editUnlockedForUserId: exists.editUnlockedForUserId,
        editUnlockedUntil: exists.editUnlockedUntil,
      };
  if (!canUserEditCompletedOrder(me, effectiveGate)) {
    return { ok: false, error: "הזמנה במצב ״בוצע״ או ״מבוטל״ נעולה — שינוי סטטוס דורש אישור מנהל." };
  }
  if (unlockExpired) {
    void clearExpiredOrderEditUnlockForOrder(id).catch(() => {});
  }

  const updateT0 = performance.now();
  await ensureOrderCompletionColumnOnce();
  if (status === OS.DEBT_WITHDRAWAL) {
    if (!exists.customerId) {
      return { ok: false, error: "אי אפשר למשוך מהחוב — להזמנה אין לקוח משויך" };
    }
    const orderTotal = Number(exists.totalUsd ?? 0);
    const alreadyApplied = Number(exists.debtWithdrawalUsd ?? 0);
    const dw = await applyDebtWithdrawalForOrder({
      orderId: id,
      customerId: exists.customerId,
      orderTotalUsd: orderTotal,
      alreadyAppliedUsd: alreadyApplied,
    });
    updateOrderMs = Math.round(performance.now() - updateT0);
    if (!dw.ok) return dw;
    void prisma.auditLog
      .create({
        data: {
          userId: me.id,
          actionType: "ORDER_DEBT_WITHDRAWAL_APPLIED",
          entityType: "Order",
          entityId: id,
          metadata: {
            orderTotalUsd: orderTotal,
            withdrawnUsd: dw.debtWithdrawalUsd,
            source: "orders_list_status_api",
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
    logOrderStatusUpdatePerf({
      AUTH_MS: perf?.AUTH_MS ?? 0,
      FIND_ORDER_MS: findOrderMs,
      UPDATE_ORDER_MS: updateOrderMs,
      RECALC_BALANCES_MS: recalcBalancesMs,
      REFRESH_DATA_MS: refreshDataMs,
      TOTAL_MS: Math.round(performance.now() - startedAt) + (perf?.AUTH_MS ?? 0),
    });
    return { ok: true, debtWithdrawalUsd: dw.debtWithdrawalUsd };
  }

  if (status === OS.CANCELLED) {
    if (exists.status === OS.CANCELLED) {
      return { ok: false, error: "ההזמנה כבר מבוטלת" };
    }
    if (!exists.customerId) {
      return { ok: false, error: "אי אפשר לבטל — להזמנה אין לקוח משויך" };
    }
    const cancelT0 = performance.now();
    await executeOrderCancellation({
      orderId: id,
      actorUserId: me.id,
      actorFullName: me.fullName,
      directByAdmin: true,
    });
    await prisma.order.update({ where: { id }, data: { isCompleted: false } });
    updateOrderMs = Math.round(performance.now() - cancelT0);
    logOrderStatusUpdatePerf({
      AUTH_MS: perf?.AUTH_MS ?? 0,
      FIND_ORDER_MS: findOrderMs,
      UPDATE_ORDER_MS: updateOrderMs,
      RECALC_BALANCES_MS: recalcBalancesMs,
      REFRESH_DATA_MS: refreshDataMs,
      TOTAL_MS: Math.round(performance.now() - startedAt) + (perf?.AUTH_MS ?? 0),
    });
    return { ok: true };
  }

  const shouldClearDebtWithdrawal =
    exists.status === OS.DEBT_WITHDRAWAL && status !== OS.DEBT_WITHDRAWAL && exists.debtWithdrawalUsd != null;

  await prisma.order.update({
    where: { id },
    data: {
      status,
      ...(status !== OS.COMPLETED ? { isCompleted: false } : {}),
      ...(shouldClearDebtWithdrawal ? { debtWithdrawalUsd: null } : {}),
    },
  });
  updateOrderMs = Math.round(performance.now() - updateT0);

  logOrderStatusUpdatePerf({
    AUTH_MS: perf?.AUTH_MS ?? 0,
    FIND_ORDER_MS: findOrderMs,
    UPDATE_ORDER_MS: updateOrderMs,
    RECALC_BALANCES_MS: recalcBalancesMs,
    REFRESH_DATA_MS: refreshDataMs,
    TOTAL_MS: Math.round(performance.now() - startedAt) + (perf?.AUTH_MS ?? 0),
  });

  return { ok: true };
}

/** עדכון inline מהטבלה — אמצעי תשלום בלבד (ללא שינויי DB structure / חישובים) */
export async function updateOrderListPaymentMethodAction(
  orderId: string,
  method: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  if (!isAdminUser(me)) {
    return { ok: false, error: "עדכון הזמנה דורש אישור מנהל. פתחו את ההזמנה ושלחו בקשת עדכון." };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  if (method !== null && !PAYMENT_METHODS.has(method)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const existing = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!canUserEditCompletedOrder(me, existing)) {
    return { ok: false, error: "הזמנה במצב ״בוצע״ או ״מבוטל״ נעולה — שינוי דורש אישור מנהל." };
  }

  await prisma.order.update({ where: { id }, data: { paymentMethod: method } });
  return { ok: true };
}

export type UpdateOrderPaymentMethodApiResult =
  | { ok: true }
  | { ok: false; error: string };

/** Fast API-path update for payment method — no revalidate/refresh. */
export async function updateOrderListPaymentMethodActionForApi(
  orderId: string,
  methodRaw: string | null,
  session: SessionPayload,
): Promise<UpdateOrderPaymentMethodApiResult> {
  const actor = await resolveCaptureActor(session);
  if ("error" in actor) return { ok: false, error: actor.error };
  const me = actor;
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  if (!isAdminUser(me)) {
    return { ok: false, error: "עדכון הזמנה דורש אישור מנהל. פתחו את ההזמנה ושלחו בקשת עדכון." };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  const method = (methodRaw?.trim() || "") as string;
  const next = method ? method : null;
  if (next !== null && !PAYMENT_METHODS.has(next)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const existing = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };

  // Same lock-gate behavior as the server action, but without extra refresh.
  const unlockExpired =
    existing.editUnlockedUntil != null && existing.editUnlockedUntil.getTime() < Date.now();
  const effectiveGate = unlockExpired
    ? { status: existing.status, editUnlockedForUserId: null, editUnlockedUntil: null }
    : existing;
  if (!canUserEditCompletedOrder(me, effectiveGate)) {
    return { ok: false, error: "הזמנה במצב ״בוצע״ או ״מבוטל״ נעולה — שינוי דורש אישור מנהל." };
  }
  if (unlockExpired) {
    void clearExpiredOrderEditUnlockForOrder(id).catch(() => {});
  }

  await prisma.order.update({ where: { id }, data: { paymentMethod: next } });
  invalidateOrdersListDataCache();
  return { ok: true };
}

/** עדכון inline מהטבלה — מקום תשלום (IntakeLocation id) בלבד */
export async function updateOrderListPaymentLocationAction(
  orderId: string,
  locationId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  if (!isAdminUser(me)) {
    return { ok: false, error: "עדכון הזמנה דורש אישור מנהל. פתחו את ההזמנה ושלחו בקשת עדכון." };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };

  const existing = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };

  const trimmedLoc = (locationId ?? "").trim() || null;
  if (trimmedLoc) {
    const exists = await prisma.intakeLocation.findFirst({
      where: { id: trimmedLoc },
      select: { id: true },
    });
    if (!exists) return { ok: false, error: "מקום תשלום לא קיים" };
  }

  await prisma.order.update({
    where: { id },
    data: { locationId: trimmedLoc, paymentPointId: null },
  });
  invalidateOrdersListDataCache();
  return { ok: true };
}

export async function updateOrderWorkPanelAction(form: {
  orderId: string;
  weekCode: string;
  finalRateOverride?: string | null;
  orderExecutionDateYmd?: string;
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  orderDateYmd?: string;
  orderTimeHm?: string;
  customerId: string;
  /** אופציונלי — ברירת מחדל מרשומת הלקוח */
  customerTypeSnapshot?: string | null;
  amountUsd: string;
  feeUsd: string;
  /** אחוז עמלה שנבחר בקליטה — נשמר על ההזמנה */
  commissionPercent?: string | null;
  paymentMethod: string;
  status: string;
  notes?: string;
  paymentPointId?: string | null;
  locationId?: string | null;
  intakeLocationDraftName?: string | null;
  paymentLines?: OrderCapturePaymentLineInput[];
  /** חלוקת "תשלום מורכב" — כאשר paymentMethod=COMPOSITE. [] = ניקוי חלוקה */
  paymentBreakdown?: OrderBreakdownLineInput[];
  sourceCountry?: OrderCountryCode | string | null;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
} & CaptureOrderFormExtras,
  applyOptions?: { orderEditRequestId?: string },
): Promise<CaptureState> {
  return updateOrderWorkPanelActionInner(form, null, null, applyOptions);
}

export async function updateOrderWorkPanelActionForApi(
  form: Parameters<typeof updateOrderWorkPanelAction>[0],
  session: SessionPayload,
  preAuthenticated?: AppUser | null,
): Promise<CaptureState> {
  return updateOrderWorkPanelActionInner(form, session, preAuthenticated);
}

async function updateOrderWorkPanelActionInner(
  form: Parameters<typeof updateOrderWorkPanelAction>[0],
  apiSession: SessionPayload | null,
  preAuthenticated?: AppUser | null,
  options?: { dryRun?: boolean; orderEditRequestId?: string },
): Promise<CaptureState> {
  const perf = new CaptureSavePerf();
  const cacheT0 = Date.now();
  warmCaptureHotPathCaches();
  perf.cacheRefreshMs = Date.now() - cacheT0;

  const actor = preAuthenticated
    ? preAuthenticated
    : await perf.time("authMs", () => resolveCaptureActor(apiSession));
  if ("error" in actor) return { ok: false, error: actor.error };
  const me = actor;

  const validationT0 = Date.now();
  capturePerfTimeStart("capture.validation");
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "אין הרשאה" };
  }

  if (!form.customerId?.trim()) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "יש לבחור לקוח" };
  }

  if (!isCompositePaymentMethod(form.paymentMethod) && !PAYMENT_METHODS.has(form.paymentMethod)) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const status = (form.status?.trim() || OS.OPEN).trim();
  const allowed = getActiveOrderStatusIdsSync();
  if (!status || !allowed.has(status)) {
    capturePerfTimeEnd("capture.validation");
    perf.validateInputMs = Date.now() - validationT0;
    return { ok: false, error: "סטטוס הזמנה לא תקין" };
  }
  capturePerfTimeEnd("capture.validation");
  perf.validateInputMs = Date.now() - validationT0;
  void getActiveOrderStatusIdsCached();
  await ensureOrderCommissionPercentColumn();

  const ratesResultUp = await perf.time("exchangeRateMs", () => resolveCaptureRatesForSave(form));
  if (!ratesResultUp.ok) return { ok: false, error: ratesResultUp.error };
  const ratesResolved = ratesResultUp.rates;

  const countriesFromClient = parseEnabledCountriesFromForm(form.enabledCountries);

  const [
    existing,
    paidAgg,
    customerResolved,
    allowedCountriesPre,
    resolvedUp,
  ] = await perf.time("phase1Ms", () =>
    capturePerfTimed("capture.phase1", () =>
      Promise.all([
        prisma.order.findFirst({
          where: { id: form.orderId.trim(), isActive: true },
          select: {
            id: true,
            orderNumber: true,
            weekCode: true,
            sourceCountry: true,
            status: true,
            editUnlockedForUserId: true,
            editUnlockedUntil: true,
          },
        }),
        prisma.payment.aggregate({
          where: { orderId: form.orderId.trim(), amountUsd: { not: null } },
          _sum: { amountUsd: true },
        }),
        loadCustomerForCapture(form.customerId, form.customerSnapshot, {
          draftNameAr: form.draftNameAr,
          draftNameEn: form.draftNameEn,
        }, me.id),
        countriesFromClient
          ? Promise.resolve(countriesFromClient)
          : loadCaptureSettingsCountries(),
        resolveOrderIntakeLocationColumnValue({
          fieldId: (form.paymentPointId?.trim() || form.locationId?.trim() || "") || undefined,
          draftName: form.intakeLocationDraftName,
        }),
      ]),
    ),
  );
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!customerResolved) return { ok: false, error: "לקוח לא נמצא" };
  const customer = customerResolved.customer;

  // Edit-gate check — compute locally; only issue the "clear expired unlock" write
  // when the unlock is actually expired (avoids an unconditional updateMany round-trip).
  const unlockExpired =
    existing.editUnlockedUntil != null && existing.editUnlockedUntil.getTime() < Date.now();
  const effectiveGate = unlockExpired
    ? { status: existing.status, editUnlockedForUserId: null, editUnlockedUntil: null }
    : { status: existing.status, editUnlockedForUserId: existing.editUnlockedForUserId, editUnlockedUntil: existing.editUnlockedUntil };
  if (!canUserEditCompletedOrder(me, effectiveGate)) {
    return {
      ok: false,
      error: "הזמנה במצב ״בוצע״ או ״מבוטל״ נעולה לעריכה. נדרש אישור מנהל — שלחו בקשת עריכה מהמסך.",
    };
  }
  if (unlockExpired) {
    // Fire-and-forget; result already incorporated in effectiveGate.
    void clearExpiredOrderEditUnlockForOrder(existing.id).catch(() => {});
  }

  const existingPaidUsd = paidAgg._sum.amountUsd ?? new Prisma.Decimal(0);

  // Apply Ar/En name drafts only if needed; merge with the customer fetch we already did.
  const namePatches = computeCustomerNamePatches(
    { nameAr: customer.nameAr, nameEn: customer.nameEn },
    form.draftNameAr ?? "",
    form.draftNameEn ?? "",
  );
  if (Object.keys(namePatches).length > 0) {
    await perf.time("updateCustomerMs", () =>
      prisma.customer.update({ where: { id: customer.id }, data: namePatches }).catch(() => {}),
    );
  }

  const base = ratesResolved.base;
  const fee = ratesResolved.fee;
  const final = ratesResolved.final;
  const commissionPercentRaw = (form.commissionPercent ?? "").trim().replace(",", ".");
  const commissionPercentNum = Number(commissionPercentRaw || "0");
  const commissionPercentDec = new Prisma.Decimal(
    Number.isFinite(commissionPercentNum) && commissionPercentNum > 0 ? commissionPercentNum.toString() : "0",
  ).toDecimalPlaces(4, 4);
  const vatRate = prismaVatRatePercent();

  let deal: Prisma.Decimal;
  try {
    deal = new Prisma.Decimal(form.amountUsd.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום (USD) לא תקין" };
  }
  if (deal.lte(0)) return { ok: false, error: "סכום USD חייב להיות חיובי" };

  let commissionUsd = new Prisma.Decimal(0);
  const rawFee = (form.feeUsd || "").trim().replace(",", ".");
  if (rawFee) {
    try {
      const v = new Prisma.Decimal(rawFee);
      if (v.lt(0)) return { ok: false, error: "עמלה USD לא יכולה להיות שלילית" };
      commissionUsd = v.toDecimalPlaces(4, 4);
    } catch {
      return { ok: false, error: "עמלה USD לא תקינה" };
    }
  }

  const totalUsd = deal.add(commissionUsd).toDecimalPlaces(4, 4);
  const bdResolved = resolveOrderBreakdownRows(form, totalUsd, final);
  if (!bdResolved.ok) return bdResolved;
  const breakdownRows = bdResolved.rows;
  const payParse = parseOrderPaymentLines(form.paymentLines, final);
  if (!payParse.ok) return payParse;
  if (isDebtWithdrawalOrderStatus(status)) {
    if (payParse.parsed.length > 0) {
      return { ok: false, error: "הזמנת משיכה מחוב אינה כוללת שורות תשלום — הסכום מקטין חוב בלבד" };
    }
  } else if (payParse.parsed.length > 0) {
    const combined = existingPaidUsd.add(payParse.sum);
    if (combined.gt(totalUsd)) {
      return { ok: false, error: "סכום התשלומים (קיים + חדש) חורג מסה״כ ההזמנה בדולר" };
    }
  }

  const totals = computeFromUsdAmount(totalUsd, {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: final,
    vatRate,
  });

  const dealIlsGross = deal.mul(final).toDecimalPlaces(2, 4);
  const commissionIlsGross = commissionUsd.mul(final).toDecimalPlaces(2, 4);
  const datesResolvedUp = resolveOrderCaptureDates(form);
  if (!datesResolvedUp.ok) return datesResolvedUp;
  const { orderExecutionDate, intakeDateTime, orderDate, weekCode } = datesResolvedUp;
  const typeSnap = (form.customerTypeSnapshot?.trim() || customer.customerType || "רגיל").trim() || "רגיל";

  if (!resolvedUp.ok) return { ok: false, error: resolvedUp.error };
  const paymentPointIdUpdate = resolvedUp.paymentPointIdForPrisma;

  const rawCountry = form.sourceCountry?.trim();
  if (!rawCountry) {
    return { ok: false, error: "יש לבחור מדינת מקור" };
  }
  if (!ORDER_COUNTRY_CODES.includes(rawCountry as OrderCountryCode)) {
    return { ok: false, error: "מדינת מקור לא תקינה" };
  }
  const requestedCode = rawCountry as OrderCountryCode;
  const existingCountryStr = existing.sourceCountry != null ? String(existing.sourceCountry) : null;
  const keepExistingCountry =
    existingCountryStr !== null && existingCountryStr === requestedCode;
  if (!allowedCountriesPre.includes(requestedCode) && !keepExistingCountry) {
    return { ok: false, error: "מדינה זו אינה מופעלת בהגדרות המערכת" };
  }
  const sourceCountryUpdate = requestedCode;

  const transitioningToCancel = status === OS.CANCELLED && existing.status !== OS.CANCELLED;
  let balanceBeforeCancel: Prisma.Decimal | undefined;
  if (transitioningToCancel) {
    balanceBeforeCancel = await getCustomerInternalBalanceUsd(customer.id);
  }

  if (options?.dryRun) {
    return { ok: true, orderNumber: existing.orderNumber ?? "" };
  }

  const beforePanel = await getOrderForWorkPanelAction(existing.id);
  const beforeSnapshot = beforePanel ? snapshotFromWorkPanel(beforePanel) : null;

  if (!isAdminUser(me) && !options?.orderEditRequestId && beforeSnapshot && beforePanel) {
    const afterSnapshot = snapshotFromUpdateForm({
      customerLabel: customer.displayName,
      customerCode: customer.customerCode,
      amountUsd: form.amountUsd,
      feeUsd: form.feeUsd,
      commissionPercent: form.commissionPercent,
      paymentMethod: form.paymentMethod,
      status,
      notes: form.notes,
      sourceCountry: sourceCountryUpdate,
      locationName: form.intakeLocationDraftName?.trim() || beforePanel.locationName,
      orderExecutionDateYmd: form.orderExecutionDateYmd ?? beforePanel.orderExecutionDateYmd,
      intakeDateYmd: form.intakeDateYmd ?? beforePanel.intakeDateYmd,
      intakeTimeHm: form.intakeTimeHm ?? beforePanel.intakeTimeHm,
      weekCode,
    });
    if (orderEditDiffRequiresApproval(computeOrderEditDiff(beforeSnapshot, afterSnapshot))) {
      return {
        ok: false,
        error: "עדכון שדות רגישים דורש אישור מנהל. שלחו בקשת עדכון עם סיבת השינוי.",
      };
    }
  }

  capturePerfTimeStart("capture.insertOrder");
  await capturePerfTimed("capture.insertOrderRow", () =>
    prisma.$transaction(async (tx) => {
      const tOrder = Date.now();
      await tx.order.update({
        where: { id: existing.id },
        data: {
          customerId: customer.id,
          customerCodeSnapshot: customer.customerCode,
          customerNameSnapshot: customer.displayName,
          customerTypeSnapshot: typeSnap,
          weekCode,
          sourceCountry: sourceCountryUpdate,
          orderDate,
          orderExecutionDate,
          intakeDateTime,
          status,
          paymentMethod: form.paymentMethod,
          paymentPointId: paymentPointIdUpdate,
          amountUsd: deal,
          commissionUsd,
          totalUsd,
          exchangeRate: final,
          commissionPercent: commissionPercentDec,
          vatRate,
          amountWithoutVat: totals.totalIlsWithoutVat,
          snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
          snapshotDollarFee: totals.snapshotDollarFee,
          snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
          totalIlsWithVat: totals.totalIlsWithVat,
          totalIlsWithoutVat: totals.totalIlsWithoutVat,
          vatAmount: totals.vatAmount,
          totalIls: totals.totalIlsWithVat,
          amountIls: dealIlsGross,
          commissionIls: commissionIlsGross,
          notes: form.notes?.trim() || null,
          locationId: resolvedUp.locationId ?? null,
        },
        select: { id: true },
      });
      perf.add("createOrderMs", Date.now() - tOrder);

      if (payParse.parsed.length > 0) {
        const tItems = Date.now();
        await capturePerfTimed("capture.insertItems", () =>
          appendParsedPaymentsForOrder(
            {
              meId: me.id,
              orderId: existing.id,
              customerId: customer.id,
              weekCode,
              paymentDate: orderDate,
              parsed: payParse.parsed,
              base,
              fee,
              final,
              vatRate,
            },
            tx,
          ),
        );
        perf.add("createItemsMs", Date.now() - tItems);
      }

      // תשלום מורכב: כתיבה מחדש של החלוקה (composite=rows, אחרת ניקוי)
      await writeOrderBreakdown(tx, existing.id, breakdownRows, {
        userId: me.id,
        intakeWeekCode: weekCode,
      });
    }),
  );
  capturePerfTimeEnd("capture.insertOrder");

  if (isDebtWithdrawalOrderStatus(status)) {
    const dw = await applyDebtWithdrawalForOrder({
      orderId: existing.id,
      customerId: customer.id,
      orderTotalUsd: Number(totalUsd),
      alreadyAppliedUsd: Number(
        (
          await prisma.order.findFirst({
            where: { id: existing.id },
            select: { debtWithdrawalUsd: true },
          })
        )?.debtWithdrawalUsd ?? 0,
      ),
    });
    if (!dw.ok) return { ok: false, error: dw.error };
    void prisma.auditLog
      .create({
        data: {
          userId: me.id,
          actionType: "ORDER_DEBT_WITHDRAWAL_APPLIED",
          entityType: "Order",
          entityId: existing.id,
          metadata: {
            orderTotalUsd: Number(totalUsd),
            withdrawnUsd: dw.debtWithdrawalUsd,
            source: "order_capture_update",
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  } else if (
    isDebtWithdrawalOrderStatus(existing.status) &&
    !isDebtWithdrawalOrderStatus(status) &&
    status !== OS.CANCELLED
  ) {
    await prisma.order.update({
      where: { id: existing.id },
      data: { debtWithdrawalUsd: null },
    });
  }

  if (transitioningToCancel && balanceBeforeCancel != null) {
    try {
      await executeOrderCancellation({
        orderId: existing.id,
        actorUserId: me.id,
        actorFullName: me.fullName,
        reason: form.notes?.trim() || null,
        orderEditRequestId: options?.orderEditRequestId,
        directByAdmin: isAdminUser(me),
        statusAlreadyCancelled: true,
        priorStatus: existing.status,
        balanceBeforeInternalUsd: balanceBeforeCancel,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "ביטול הזמנה נכשל" };
    }
  }

  const auditT0 = Date.now();
  const afterPanel = await getOrderForWorkPanelAction(existing.id);
  const afterSnapshot = afterPanel ? snapshotFromWorkPanel(afterPanel) : null;
  const updateDiff = computeOrderEditDiff(beforeSnapshot, afterSnapshot);

  let requestedByName: string | null = null;
  if (options?.orderEditRequestId) {
    const editReq = await prisma.orderEditRequest.findFirst({
      where: { id: options.orderEditRequestId },
      select: { requestedBy: { select: { fullName: true } } },
    });
    requestedByName = editReq?.requestedBy.fullName ?? null;
  }

  try {
    await writeOrderUpdateAuditLog({
      orderId: existing.id,
      orderNumber: existing.orderNumber ?? "",
      customerId: customer.id,
      actorUserId: me.id,
      actorFullName: me.fullName,
      orderEditRequestId: options?.orderEditRequestId,
      requestedByName,
      diff: updateDiff,
    });
  } catch (auditErr) {
    console.error("[order-update-audit] failed", auditErr);
  }
  perf.auditMs = Date.now() - auditT0;
  void markApprovedEditRequestUsedAndClearUnlock(existing.id, me.id).catch(() => {});

  capturePerfTimeStart("capture.response");
  const out: CaptureState = await perf.time("responseSerializationMs", async () => ({
    ok: true as const,
    orderNumber: existing.orderNumber ?? "",
  }));
  capturePerfTimeEnd("capture.response");
  perf.logSummary({ mode: "update", orderId: existing.id, orderNumber: existing.orderNumber });
  return out;
}

export type SubmitOrderUpdateRequestExtras = {
  customerLabel?: string;
  customerCode?: string | null;
  locationName?: string | null;
};

async function notifyOrderUpdateRequestAdmins(
  title: string,
  body: string | null,
  payload?: Prisma.InputJsonValue,
) {
  await ensureOrderEditRequestTablesOnce();
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  for (const admin of admins) {
    await prisma.userNotification.create({
      data: {
        userId: admin.id,
        title,
        body,
        kind: "ORDER_UPDATE_REQUEST",
        ...(payload !== undefined ? { payload } : {}),
      },
    });
  }
}

/** שליחת בקשת עדכון הזמנה — עובדים בלבד; ההזמנה לא משתנה עד אישור מנהל */
export async function submitOrderUpdateRequestAction(
  form: Parameters<typeof updateOrderWorkPanelAction>[0],
  requestReason: string,
  displayExtras?: SubmitOrderUpdateRequestExtras,
): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) return { ok: false, error: "אין הרשאה" };
  if (isAdminUser(me)) return { ok: false, error: "מנהלים יכולים לעדכן ישירות — לא נדרשת בקשה" };

  const reason = requestReason.trim();
  if (reason.length < 3) return { ok: false, error: "יש להזין סיבת עדכון (לפחות 3 תווים)" };

  const oid = form.orderId.trim();
  if (!oid) return { ok: false, error: "חסר מזהה הזמנה" };

  await ensureOrderEditRequestTablesOnce();

  const pending = await prisma.orderEditRequest.findFirst({
    where: { orderId: oid, status: OrderEditRequestStatus.PENDING },
    select: { id: true },
  });
  if (pending) return { ok: false, error: "כבר קיימת בקשת עדכון ממתינה להזמנה זו" };

  const validation = await updateOrderWorkPanelActionInner(form, null, me, { dryRun: true });
  if (!validation.ok) return { ok: false, error: validation.error };

  const beforePanel = await getOrderForWorkPanelAction(oid);
  if (!beforePanel) return { ok: false, error: "הזמנה לא נמצאה" };

  const beforeSnapshot = snapshotFromWorkPanel(beforePanel);
  const afterSnapshot = snapshotFromUpdateForm({
    customerLabel: displayExtras?.customerLabel ?? beforePanel.customerLabel,
    customerCode: displayExtras?.customerCode ?? beforePanel.customerCode,
    amountUsd: form.amountUsd,
    feeUsd: form.feeUsd,
    commissionPercent: form.commissionPercent,
    paymentMethod: form.paymentMethod,
    status: form.status ?? beforePanel.status,
    notes: form.notes,
    sourceCountry: form.sourceCountry ?? beforePanel.sourceCountry,
    locationName: displayExtras?.locationName ?? beforePanel.locationName,
    orderExecutionDateYmd: form.orderExecutionDateYmd ?? beforePanel.orderExecutionDateYmd,
    intakeDateYmd: form.intakeDateYmd ?? beforePanel.intakeDateYmd,
    intakeTimeHm: form.intakeTimeHm ?? beforePanel.intakeTimeHm,
    weekCode: form.weekCode ?? beforePanel.weekCode,
  });

  const diff = computeOrderEditDiff(beforeSnapshot, afterSnapshot);
  if (diff.length === 0) return { ok: false, error: "לא זוהו שינויים — אין מה לשלוח לאישור" };
  if (!orderEditDiffRequiresApproval(diff)) {
    return {
      ok: false,
      error: "לא נמצא שינוי בשדות שדורשים אישור מנהל (סכום, עמלה, לקוח, שבוע, מדינה, תשלום, הערות, מקום תשלום)",
    };
  }

  const req = await prisma.orderEditRequest.create({
    data: {
      orderId: oid,
      requestedByUserId: me.id,
      requestReason: reason,
      status: OrderEditRequestStatus.PENDING,
      beforeSnapshot: beforeSnapshot as unknown as Prisma.InputJsonValue,
      afterSnapshot: afterSnapshot as unknown as Prisma.InputJsonValue,
      proposedPayload: form as unknown as Prisma.InputJsonValue,
    } as Prisma.OrderEditRequestUncheckedCreateInput,
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_UPDATE_REQUEST_CREATED",
      entityType: "OrderEditRequest",
      entityId: req.id,
      metadata: {
        orderId: oid,
        orderNumber: beforePanel.orderNumber,
        requestReason: reason,
        changedFields: diff.map((d) => d.key),
        diff: diff as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonValue,
    },
  });

  const timeHe = new Date().toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  await notifyOrderUpdateRequestAdmins(
    "בקשת עדכון הזמנה",
    `הזמנה ${beforePanel.orderNumber} — ${me.fullName} — ${timeHe}`,
    { orderEditRequestId: req.id, orderId: oid } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/orders");
  revalidatePath("/admin/order-edit-requests");
  return { ok: true, requestId: req.id };
}
