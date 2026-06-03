import { Prisma, PaymentCheckStatus } from "@prisma/client";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { prisma } from "@/lib/prisma";
import { assertCreatedByUserExists } from "@/lib/session-user-guard";
import { PAYMENT_CODE_PREFIX, parsePaymentNumberFromCode } from "@/lib/payment-capture-code";
import { endOfLocalDay, formatLocalYmd, getCurrentWeekRange, parseLocalDate } from "@/lib/work-week";

export const PAYMENT_CHECK_STATUS_LABEL: Record<PaymentCheckStatus, string> = {
  PENDING: "ממתין",
  DEPOSITED: "הופקד",
  BOUNCED: "חזר",
};

export type PaymentCheckRowDTO = {
  id: string;
  checkNumber: string;
  customerName: string;
  customerCode: string;
  amountUsd: string;
  dueYmd: string;
  /** מפתח לעיצוב שורה: איחור / היום / קרוב (עד 7 ימים) */
  dueHighlight: "overdue" | "today" | "soon" | null;
  daysToDueLabel: string;
  status: PaymentCheckStatus;
  statusLabel: string;
  paymentId: string;
  paymentCodeDisplay: string;
  weekCode: string;
};

export type PaymentCheckListResult = {
  rows: PaymentCheckRowDTO[];
  page: number;
  totalPages: number;
  totalRows: number;
  stats: {
    totalCount: number;
    totalAmountUsd: string;
    pendingCount: number;
    bouncedCount: number;
    /** פרעון בטווח 7 הימים הקרובים (כולל היום), לא כולל הופקד */
    dueNext7NotDepositedCount: number;
    /** פרעון היום, לא הופקד */
    dueTodayNotDepositedCount: number;
    /** לפני היום ועדיין ממתין */
    overduePendingCount: number;
    needsAttention: boolean;
  };
};

export type PaymentCheckListFilters = {
  page?: number;
  limit?: number;
  search?: string;
  /** סינון מהיר מהממשק: close7 | today | week | overdue | deposited | bounced */
  quick?: string;
  status?: string;
  dueFrom?: string;
  dueTo?: string;
  customer?: string;
  checkNumber?: string;
  week?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
};

function displayPaymentCaptureCode(p: { paymentCode: string | null; paymentNumber: number | null }): string {
  const code = p.paymentCode?.trim();
  if (code) return code;
  const n = p.paymentNumber ?? parsePaymentNumberFromCode(p.paymentCode);
  if (n != null) return `${PAYMENT_CODE_PREFIX}${String(n).padStart(6, "0")}`;
  return "—";
}

function localTodayStart(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
}

function addLocalDays(base: Date, days: number): Date {
  const x = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  x.setDate(x.getDate() + days);
  return x;
}

function diffCalendarDaysDue(due: Date, todayStart: Date): number {
  const d0 = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0, 0, 0, 0);
  return Math.round((d0.getTime() - todayStart.getTime()) / 86_400_000);
}

function daysToDueLabel(due: Date, status: PaymentCheckStatus): string {
  if (status === "DEPOSITED") return "—";
  if (status === "BOUNCED") return "—";
  const todayStart = localTodayStart();
  const diff = diffCalendarDaysDue(due, todayStart);
  if (diff < 0) return `באיחור ${Math.abs(diff)} ימים`;
  if (diff === 0) return "היום";
  return `עוד ${diff} ימים`;
}

function dueRowHighlight(due: Date, status: PaymentCheckStatus): "overdue" | "today" | "soon" | null {
  if (status !== "PENDING") return null;
  const todayStart = localTodayStart();
  const diff = diffCalendarDaysDue(due, todayStart);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff > 0 && diff <= 7) return "soon";
  return null;
}

function buildWhere(f: PaymentCheckListFilters, opts?: { omitQuick?: boolean }): Prisma.PaymentCheckWhereInput {
  const and: Prisma.PaymentCheckWhereInput[] = [];

  const quick = opts?.omitQuick ? "" : (f.quick ?? "").trim().toLowerCase();
  const todayStart = localTodayStart();
  const todayYmd = formatLocalYmd(todayStart);
  const endToday = endOfLocalDay(todayYmd);
  const endPlus7Ymd = formatLocalYmd(addLocalDays(todayStart, 7));
  const endPlus7 = endOfLocalDay(endPlus7Ymd);

  if (quick === "close7") {
    and.push({ dueDate: { lte: endPlus7 } });
    and.push({ status: { not: "DEPOSITED" } });
  } else if (quick === "today") {
    and.push({ dueDate: { gte: todayStart, lte: endToday } });
    and.push({ status: { not: "DEPOSITED" } });
  } else if (quick === "week") {
    const { start, end } = getCurrentWeekRange();
    and.push({ dueDate: { gte: start, lte: end } });
    and.push({ status: { not: "DEPOSITED" } });
  } else if (quick === "overdue") {
    and.push({ dueDate: { lt: todayStart } });
    and.push({ status: "PENDING" });
  } else if (quick === "deposited") {
    and.push({ status: "DEPOSITED" });
  } else if (quick === "bounced") {
    and.push({ status: "BOUNCED" });
  }

  const st = (f.status ?? "").trim().toUpperCase();
  if (st === "PENDING" || st === "DEPOSITED" || st === "BOUNCED") {
    and.push({ status: st as PaymentCheckStatus });
  }

  const dueFrom = (f.dueFrom ?? "").trim();
  if (dueFrom && /^\d{4}-\d{2}-\d{2}$/.test(dueFrom)) {
    and.push({ dueDate: { gte: parseLocalDate(dueFrom) } });
  }
  const dueTo = (f.dueTo ?? "").trim();
  if (dueTo && /^\d{4}-\d{2}-\d{2}$/.test(dueTo)) {
    const d0 = parseLocalDate(dueTo);
    const end = new Date(d0);
    end.setDate(end.getDate() + 1);
    and.push({ dueDate: { lt: end } });
  }

  const custQ = (f.customer ?? "").trim();
  if (custQ) {
    and.push({
      payment: {
        customer: {
          OR: [
            { displayName: { contains: custQ, mode: "insensitive" } },
            { customerCode: { contains: custQ, mode: "insensitive" } },
            { oldCustomerCode: { contains: custQ, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  const chk = (f.checkNumber ?? "").trim();
  if (chk) {
    and.push({ checkNumber: { contains: chk, mode: "insensitive" } });
  }

  const week = (f.week ?? "").trim();
  if (week) {
    and.push({ payment: { weekCode: { contains: week, mode: "insensitive" } } });
  }

  const q = (f.search ?? "").trim();
  if (q) {
    and.push({
      OR: [
        { checkNumber: { contains: q, mode: "insensitive" } },
        { payment: { paymentCode: { contains: q, mode: "insensitive" } } },
        { payment: { weekCode: { contains: q, mode: "insensitive" } } },
        { payment: { notes: { contains: q, mode: "insensitive" } } },
        { payment: { customer: { displayName: { contains: q, mode: "insensitive" } } } },
        { payment: { customer: { customerCode: { contains: q, mode: "insensitive" } } } },
        { payment: { customer: { oldCustomerCode: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

function mergeAndWhere(parts: Prisma.PaymentCheckWhereInput[]): Prisma.PaymentCheckWhereInput {
  const cleaned = parts.filter((p) => p && Object.keys(p).length > 0);
  if (cleaned.length === 0) return {};
  if (cleaned.length === 1) return cleaned[0]!;
  return { AND: cleaned };
}

function orderByFromQuery(query: PaymentCheckListFilters): Prisma.PaymentCheckOrderByWithRelationInput[] {
  const dir = query.sortDir === "desc" ? "desc" : "asc";
  const k = (query.sortKey ?? "").trim();
  if (k === "checkNumber") return [{ checkNumber: dir }];
  if (k === "amount") return [{ amount: dir }];
  if (k === "dueDate") return [{ dueDate: dir }];
  if (k === "status") return [{ status: dir }];
  if (k === "week") return [{ payment: { weekCode: dir } }];
  if (k === "paymentCode") return [{ payment: { paymentCode: dir } }];
  if (k === "customer") return [{ payment: { customer: { displayName: dir } } }];
  return [{ dueDate: "asc" }, { createdAt: "desc" }];
}

function mapRow(r: {
  id: string;
  checkNumber: string;
  dueDate: Date;
  amount: Prisma.Decimal;
  status: PaymentCheckStatus;
  payment: {
    id: string;
    paymentCode: string | null;
    paymentNumber: number | null;
    weekCode: string | null;
    customer: { displayName: string; customerCode: string | null; oldCustomerCode: string | null } | null;
  };
}): PaymentCheckRowDTO {
  const cust = r.payment.customer;
  const code = cust?.customerCode?.trim() || cust?.oldCustomerCode?.trim() || "";
  const amt = Number(r.amount);
  const due = new Date(r.dueDate);
  return {
    id: r.id,
    checkNumber: r.checkNumber,
    customerName: cust?.displayName ?? "—",
    customerCode: code || "—",
    amountUsd: Number.isFinite(amt) ? amt.toFixed(2) : String(r.amount),
    dueYmd: formatLocalYmd(due),
    dueHighlight: dueRowHighlight(due, r.status),
    daysToDueLabel: daysToDueLabel(due, r.status),
    status: r.status,
    statusLabel: PAYMENT_CHECK_STATUS_LABEL[r.status] ?? r.status,
    paymentId: r.payment.id,
    paymentCodeDisplay: displayPaymentCaptureCode(r.payment),
    weekCode: r.payment.weekCode?.trim() || "—",
  };
}

export async function listPaymentChecksForAdmin(filters: PaymentCheckListFilters): Promise<PaymentCheckListResult> {
  const limit = Math.min(100, Math.max(1, Math.floor(filters.limit ?? 20)));
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const where = buildWhere(filters);
  const whereKpi = buildWhere(filters, { omitQuick: true });
  const todayStart = localTodayStart();
  const todayYmd = formatLocalYmd(todayStart);
  const endToday = endOfLocalDay(todayYmd);
  const endPlus7Ymd = formatLocalYmd(addLocalDays(todayStart, 7));
  const endPlus7 = endOfLocalDay(endPlus7Ymd);

  const [
    totalRows,
    sumRow,
    pendingCount,
    bouncedCount,
    dueNext7NotDepositedCount,
    dueTodayNotDepositedCount,
    overduePendingCount,
    rawRows,
  ] = await Promise.all([
    prisma.paymentCheck.count({ where }),
    prisma.paymentCheck.aggregate({ where, _sum: { amount: true } }),
    prisma.paymentCheck.count({ where: mergeAndWhere([where, { status: "PENDING" }]) }),
    prisma.paymentCheck.count({ where: mergeAndWhere([where, { status: "BOUNCED" }]) }),
    prisma.paymentCheck.count({
      where: mergeAndWhere([
        whereKpi,
        { dueDate: { gte: todayStart, lte: endPlus7 } },
        { status: { not: "DEPOSITED" } },
      ]),
    }),
    prisma.paymentCheck.count({
      where: mergeAndWhere([
        whereKpi,
        { dueDate: { gte: todayStart, lte: endToday } },
        { status: { not: "DEPOSITED" } },
      ]),
    }),
    prisma.paymentCheck.count({
      where: mergeAndWhere([whereKpi, { dueDate: { lt: todayStart } }, { status: "PENDING" }]),
    }),
    prisma.paymentCheck.findMany({
      where,
      orderBy: orderByFromQuery(filters),
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        checkNumber: true,
        dueDate: true,
        amount: true,
        status: true,
        createdAt: true,
        payment: {
          select: {
            id: true,
            paymentCode: true,
            paymentNumber: true,
            weekCode: true,
            customer: { select: { displayName: true, customerCode: true, oldCustomerCode: true } },
          },
        },
      },
    }),
  ]);

  const totalAmt = sumRow._sum.amount ?? new Prisma.Decimal(0);
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const safePage = Math.min(page, totalPages);

  const needsAttention = overduePendingCount > 0 || dueTodayNotDepositedCount > 0;

  return {
    rows: rawRows.map(mapRow),
    page: safePage,
    totalPages,
    totalRows,
    stats: {
      totalCount: totalRows,
      totalAmountUsd: totalAmt.toFixed(2),
      pendingCount,
      bouncedCount,
      dueNext7NotDepositedCount,
      dueTodayNotDepositedCount,
      overduePendingCount,
      needsAttention,
    },
  };
}

export async function updatePaymentCheckStatus(params: {
  checkId: string;
  nextStatus: PaymentCheckStatus;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = params.checkId.trim();
  if (!id) return { ok: false, error: "חסר מזהה צ׳יק" };

  if (params.nextStatus !== "DEPOSITED" && params.nextStatus !== "BOUNCED") {
    return { ok: false, error: "סטטוס לא נתמך" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await assertCreatedByUserExists(params.userId, tx);

      const row = await tx.paymentCheck.findFirst({
        where: { id },
        select: {
          id: true,
          status: true,
          checkNumber: true,
          amount: true,
          reversalPaymentId: true,
          payment: {
            select: {
              id: true,
              customerId: true,
              orderId: true,
              weekCode: true,
              paymentDate: true,
              currency: true,
              exchangeRate: true,
              vatRate: true,
              commissionPercent: true,
              snapshotBaseDollarRate: true,
              snapshotDollarFee: true,
              snapshotFinalDollarRate: true,
            },
          },
        },
      });
      if (!row) throw new Error("צ׳יק לא נמצא");

      if (params.nextStatus === "DEPOSITED") {
        if (row.status === "BOUNCED") throw new Error("לא ניתן לסמן ״הופקד״ אחרי ״חזר״");
        await tx.paymentCheck.update({ where: { id: row.id }, data: { status: "DEPOSITED" } });
        return;
      }

      // BOUNCED — idempotent: אם כבר נוצרה תנועת הפיכה, אין לחזור עליה
      if (row.reversalPaymentId) return;

      const p = row.payment;
      if (!p.customerId) throw new Error("לתשלום המקורי אין לקוח — לא ניתן לרשום החזר");
      if (!p.orderId) throw new Error("לתשלום המקורי אין הזמנה משויכת — לא ניתן להחזיר יתרה אוטומטית");

      const negUsd = row.amount.negated();
      const finalRate = p.snapshotFinalDollarRate ?? p.exchangeRate;
      const baseRate = p.snapshotBaseDollarRate ?? p.exchangeRate;
      const feeRate = p.snapshotDollarFee ?? new Prisma.Decimal(0);
      if (!finalRate || finalRate.lte(0)) throw new Error("חסר שער דולר בתשלום המקורי — לא ניתן ליצור תנועת החזר");

      const br = computeFromUsdAmount(negUsd, {
        baseDollarRate: baseRate ?? finalRate,
        dollarFee: feeRate,
        finalDollarRate: finalRate,
        vatRate: p.vatRate,
      });

      const notes = [
        "החזרת צ׳יק (בוטל מהיתרה)",
        `צ׳יק מס׳ ${row.checkNumber}`,
        `סכום USD: ${row.amount.toString()}`,
      ].join(" · ");

      const reversal = await tx.payment.create({
        data: {
          customerId: p.customerId,
          orderId: p.orderId,
          weekCode: p.weekCode,
          paymentDate: new Date(),
          currency: p.currency ?? "USD",
          amountUsd: negUsd,
          amountIls: br.totalIlsWithVat,
          exchangeRate: finalRate,
          vatRate: p.vatRate,
          commissionPercent: p.commissionPercent,
          amountWithoutVat: br.totalIlsWithoutVat,
          snapshotBaseDollarRate: br.snapshotBaseDollarRate,
          snapshotDollarFee: br.snapshotDollarFee,
          snapshotFinalDollarRate: br.snapshotFinalDollarRate,
          totalIlsWithVat: br.totalIlsWithVat,
          totalIlsWithoutVat: br.totalIlsWithoutVat,
          vatAmount: br.vatAmount,
          manualDateChanged: false,
          paymentMethod: "OTHER",
          isPaid: true,
          notes,
          createdById: params.userId,
        },
      });

      await tx.paymentCheck.update({
        where: { id: row.id },
        data: { status: "BOUNCED", reversalPaymentId: reversal.id },
      });

      await tx.auditLog.create({
        data: {
          userId: params.userId,
          actionType: "PAYMENT_CHECK_BOUNCED",
          entityType: "PaymentCheck",
          entityId: row.id,
          oldValue: { status: row.status } as Prisma.InputJsonValue,
          newValue: { status: "BOUNCED", reversalPaymentId: reversal.id } as Prisma.InputJsonValue,
          metadata: {
            checkNumber: row.checkNumber,
            amountUsd: row.amount.toString(),
            paymentId: p.id,
            orderId: p.orderId,
          } as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "עדכון נכשל";
    return { ok: false, error: msg };
  }
}
