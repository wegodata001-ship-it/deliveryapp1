"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { breakdownIlsIncludingVat, computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { formatLocalYmd, parseLocalDate } from "@/lib/work-week";
import { prisma } from "@/lib/prisma";

export type CustomerSearchRow = {
  id: string;
  label: string;
  code: string | null;
  customerType: string | null;
  city: string | null;
};

export type CaptureState = { ok: true } | { ok: false; error: string };

const PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export async function capturePaymentAction(form: {
  amount: string;
  currency: "ILS" | "USD";
  paymentMethod: string;
  paymentDateYmd: string;
  receivedToday: boolean;
  notes?: string;
  orderId?: string | null;
}): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const final = settings.finalDollarRate;
  const vatRate = new Prisma.Decimal("18");

  const snapIn = { baseDollarRate: base, dollarFee: fee, finalDollarRate: final, vatRate };

  let amountDec: Prisma.Decimal;
  try {
    amountDec = new Prisma.Decimal(form.amount.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום לא תקין" };
  }
  if (amountDec.lte(0)) return { ok: false, error: "סכום חייב להיות חיובי" };

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const today = new Date();
  const paymentDate = form.receivedToday ? today : parseLocalDate(form.paymentDateYmd);
  const manualDateChanged = !isSameLocalCalendarDay(paymentDate, today);

  let amountUsd: Prisma.Decimal | null = null;
  let amountIls: Prisma.Decimal | null = null;
  let totals: ReturnType<typeof computeFromUsdAmount> | ReturnType<typeof breakdownIlsIncludingVat> & {
    snapshotBaseDollarRate: Prisma.Decimal;
    snapshotDollarFee: Prisma.Decimal;
    snapshotFinalDollarRate: Prisma.Decimal;
  };

  if (form.currency === "USD") {
    amountUsd = amountDec;
    totals = computeFromUsdAmount(amountDec, snapIn);
    amountIls = totals.totalIlsWithVat;
  } else {
    amountIls = amountDec;
    const vatFactor = new Prisma.Decimal(1).add(vatRate.div(new Prisma.Decimal(100)));
    const br = breakdownIlsIncludingVat(amountDec, vatFactor);
    totals = {
      snapshotBaseDollarRate: base,
      snapshotDollarFee: fee,
      snapshotFinalDollarRate: final,
      totalIlsWithVat: br.totalIlsWithVat,
      totalIlsWithoutVat: br.totalIlsWithoutVat,
      vatAmount: br.vatAmount,
    };
    amountUsd = null;
  }

  const pay = await prisma.payment.create({
    data: {
      orderId: form.orderId || null,
      paymentDate,
      currency: form.currency,
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
      paymentMethod: form.paymentMethod as PaymentMethod,
      isPaid: true,
      notes: form.notes?.trim() || null,
      createdById: me.id,
    },
  });

  let orderNumber: string | null = null;
  const oid = form.orderId?.trim();
  if (oid) {
    const o = await prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: { orderNumber: true },
    });
    orderNumber = o?.orderNumber ?? null;
  }
  const amtRaw = form.amount.trim().replace(",", ".");
  const amountDisplay = form.currency === "USD" ? `${amtRaw} USD` : `${amtRaw} ₪`;
  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "PAYMENT_RECEIVED",
      entityType: "Payment",
      entityId: pay.id,
      metadata: {
        currency: form.currency,
        amountDisplay,
        orderNumber: orderNumber ?? undefined,
        paymentCode: pay.paymentCode ?? undefined,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true };
}

async function allocateOrderNumber(weekCode: string): Promise<{ orderNumber: string; oldOrderNumber: string }> {
  const wc = weekCode.trim() || "AH-118";
  let n = await prisma.order.count({ where: { weekCode: wc, deletedAt: null } });
  for (let attempt = 0; attempt < 80; attempt++) {
    n += 1;
    const suffix = String(n).padStart(4, "0");
    const orderNumber = `${wc}-${suffix}`;
    const exists = await prisma.order.findUnique({ where: { orderNumber } });
    if (!exists) return { orderNumber, oldOrderNumber: suffix };
  }
  const fallback = `${wc}-${Date.now().toString(36).toUpperCase()}`;
  return { orderNumber: fallback, oldOrderNumber: fallback };
}

export async function searchCustomersForOrderAction(query: string): Promise<CustomerSearchRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return [];

  const q = query.trim();
  const where: Prisma.CustomerWhereInput = {
    isActive: true,
    deletedAt: null,
  };
  if (q.length >= 1) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { nameHe: { contains: q, mode: "insensitive" } },
      { nameAr: { contains: q, mode: "insensitive" } },
      { customerCode: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }

  const rows = await prisma.customer.findMany({
    where,
    take: 30,
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, customerCode: true, customerType: true, city: true },
  });

  return rows.map((r) => ({
    id: r.id,
    label: r.displayName,
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
  }));
}

export async function previewOrderNumberAction(weekCode: string): Promise<string> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) return "";
  const { orderNumber } = await allocateOrderNumber(weekCode);
  return orderNumber;
}

export async function captureOrderAction(form: {
  weekCode: string;
  orderDateYmd: string;
  customerId: string;
  customerTypeSnapshot: string;
  dealUsd: string;
  commissionMode: "USD" | "PERCENT";
  commissionValue: string;
  paymentMethod: string;
  notes?: string;
}): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  if (!form.customerId?.trim()) {
    return { ok: false, error: "יש לבחור לקוח" };
  }

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const customer = await prisma.customer.findFirst({
    where: { id: form.customerId.trim(), deletedAt: null, isActive: true },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const final = settings.finalDollarRate;
  const vatRate = new Prisma.Decimal("18");

  let deal: Prisma.Decimal;
  try {
    deal = new Prisma.Decimal(form.dealUsd.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום עסקה (USD) לא תקין" };
  }
  if (deal.lte(0)) return { ok: false, error: "סכום עסקה חייב להיות חיובי" };

  let commissionUsd = new Prisma.Decimal(0);
  const rawCom = (form.commissionValue || "").trim().replace(",", ".");
  if (rawCom) {
    try {
      const v = new Prisma.Decimal(rawCom);
      if (form.commissionMode === "PERCENT") {
        if (v.lt(0) || v.gt(100)) return { ok: false, error: "אחוז עמלה בין 0 ל־100" };
        commissionUsd = deal.mul(v.div(new Prisma.Decimal(100))).toDecimalPlaces(4, 4);
      } else {
        if (v.lt(0)) return { ok: false, error: "עמלה לא יכולה להיות שלילית" };
        commissionUsd = v;
      }
    } catch {
      return { ok: false, error: "ערך עמלה לא תקין" };
    }
  }

  const totalUsd = deal.add(commissionUsd).toDecimalPlaces(4, 4);
  const totals = computeFromUsdAmount(totalUsd, {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: final,
    vatRate,
  });

  const dealIlsGross = deal.mul(final).toDecimalPlaces(2, 4);
  const commissionIlsGross = commissionUsd.mul(final).toDecimalPlaces(2, 4);

  const orderDate = parseLocalDate(form.orderDateYmd);
  const typeSnap = (form.customerTypeSnapshot || customer.customerType || "רגיל").trim() || "רגיל";

  const { orderNumber, oldOrderNumber } = await allocateOrderNumber(form.weekCode);

  const order = await prisma.order.create({
    data: {
      orderNumber,
      oldOrderNumber,
      customerId: customer.id,
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.displayName,
      customerTypeSnapshot: typeSnap,
      weekCode: form.weekCode.trim() || null,
      orderDate,
      status: "OPEN",
      paymentMethod: form.paymentMethod as PaymentMethod,
      amountUsd: deal,
      commissionUsd,
      totalUsd,
      exchangeRate: final,
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
      createdById: me.id,
    },
  });

  await prisma.auditLog.create({
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
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true };
}

export type OrderWorkPanelPayload = {
  id: string;
  weekCode: string;
  orderDateYmd: string;
  orderNumber: string;
  customerId: string;
  customerLabel: string;
  customerCode: string | null;
  customerType: string;
  dealUsd: string;
  commissionUsd: string;
  paymentMethod: PaymentMethod;
  notes: string;
};

export async function getOrderForWorkPanelAction(orderId: string): Promise<OrderWorkPanelPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_orders", "edit_orders"])) return null;

  const id = orderId.trim();
  if (!id) return null;

  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: {
        select: { id: true, displayName: true, customerCode: true, customerType: true },
      },
    },
  });
  if (!order) return null;

  const deal = order.amountUsd ?? new Prisma.Decimal(0);
  const com = order.commissionUsd ?? new Prisma.Decimal(0);
  const od = order.orderDate ? new Date(order.orderDate) : new Date();

  const label = order.customer?.displayName ?? order.customerNameSnapshot ?? "";
  const cid = order.customerId ?? order.customer?.id ?? "";
  if (!cid) return null;

  return {
    id: order.id,
    weekCode: (order.weekCode ?? "").trim() || "AH-118",
    orderDateYmd: formatLocalYmd(od),
    orderNumber: order.orderNumber ?? "—",
    customerId: cid,
    customerLabel: label,
    customerCode: order.customer?.customerCode ?? order.customerCodeSnapshot ?? null,
    customerType: (order.customerTypeSnapshot || order.customer?.customerType || "רגיל").trim() || "רגיל",
    dealUsd: deal.toString(),
    commissionUsd: com.toString(),
    paymentMethod: order.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
    notes: order.notes ?? "",
  };
}

export async function updateOrderWorkPanelAction(form: {
  orderId: string;
  weekCode: string;
  orderDateYmd: string;
  customerId: string;
  customerTypeSnapshot: string;
  dealUsd: string;
  commissionMode: "USD" | "PERCENT";
  commissionValue: string;
  paymentMethod: string;
  notes?: string;
}): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const existing = await prisma.order.findFirst({
    where: { id: form.orderId.trim(), deletedAt: null },
    select: { id: true, orderNumber: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };

  if (!form.customerId?.trim()) {
    return { ok: false, error: "יש לבחור לקוח" };
  }

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const customer = await prisma.customer.findFirst({
    where: { id: form.customerId.trim(), deletedAt: null, isActive: true },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const final = settings.finalDollarRate;
  const vatRate = new Prisma.Decimal("18");

  let deal: Prisma.Decimal;
  try {
    deal = new Prisma.Decimal(form.dealUsd.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום עסקה (USD) לא תקין" };
  }
  if (deal.lte(0)) return { ok: false, error: "סכום עסקה חייב להיות חיובי" };

  let commissionUsd = new Prisma.Decimal(0);
  const rawCom = (form.commissionValue || "").trim().replace(",", ".");
  if (rawCom) {
    try {
      const v = new Prisma.Decimal(rawCom);
      if (form.commissionMode === "PERCENT") {
        if (v.lt(0) || v.gt(100)) return { ok: false, error: "אחוז עמלה בין 0 ל־100" };
        commissionUsd = deal.mul(v.div(new Prisma.Decimal(100))).toDecimalPlaces(4, 4);
      } else {
        if (v.lt(0)) return { ok: false, error: "עמלה לא יכולה להיות שלילית" };
        commissionUsd = v;
      }
    } catch {
      return { ok: false, error: "ערך עמלה לא תקין" };
    }
  }

  const totalUsd = deal.add(commissionUsd).toDecimalPlaces(4, 4);
  const totals = computeFromUsdAmount(totalUsd, {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: final,
    vatRate,
  });

  const dealIlsGross = deal.mul(final).toDecimalPlaces(2, 4);
  const commissionIlsGross = commissionUsd.mul(final).toDecimalPlaces(2, 4);
  const orderDate = parseLocalDate(form.orderDateYmd);
  const typeSnap = (form.customerTypeSnapshot || customer.customerType || "רגיל").trim() || "רגיל";

  await prisma.order.update({
    where: { id: existing.id },
    data: {
      customerId: customer.id,
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.displayName,
      customerTypeSnapshot: typeSnap,
      weekCode: form.weekCode.trim() || null,
      orderDate,
      paymentMethod: form.paymentMethod as PaymentMethod,
      amountUsd: deal,
      commissionUsd,
      totalUsd,
      exchangeRate: final,
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
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_UPDATED",
      entityType: "Order",
      entityId: existing.id,
      metadata: {
        orderNumber: existing.orderNumber,
        customerName: customer.displayName,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true };
}
