import { Suspense } from "react";
import { OrderSourceCountry, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { OrdersListShell, type OrderListRow } from "@/components/admin/OrdersListShell";
import { OrdersListToolbar, type OrdersCreatedByOption } from "@/components/admin/OrdersListToolbar";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import { formatLocalYmd, parseDateFilterFromSearchParams } from "@/lib/work-week";
import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";

/** רשימת הזמנות חייבת להיבנות מחדש אחרי שמירה — לא מטמון סטטי */
export const dynamic = "force-dynamic";

const KPI_DEBT_ORDER_CAP = 8000;

function fmtUsd2(n: unknown): string | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtIls2(n: unknown): string | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function readTextParam(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const TABLE_STATUS_SET = new Set<OrderStatus>([
  OrderStatus.OPEN,
  OrderStatus.WAITING_FOR_EXECUTION,
  OrderStatus.COMPLETED,
]);

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_orders"]);
  const me = await requireAuth();
  const sp = await searchParams;
  const range = parseDateFilterFromSearchParams(sp);
  const presetParam = typeof sp.preset === "string" ? sp.preset : null;

  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canEditOrders = userHasAnyPermission(me, ["edit_orders"]);
  const canViewCustomerCard = userHasAnyPermission(me, ["view_customer_card"]);
  const explicitWeek = readTextParam(sp, "week");
  const q = readTextParam(sp, "q");

  const statusSingleRaw = readTextParam(sp, "status");
  const statusSingle =
    statusSingleRaw && TABLE_STATUS_SET.has(statusSingleRaw as OrderStatus)
      ? (statusSingleRaw as OrderStatus)
      : null;

  const countrySingleRaw = readTextParam(sp, "country");
  const countrySingle =
    countrySingleRaw && ORDER_COUNTRY_CODES.includes(countrySingleRaw as OrderCountryCode)
      ? (countrySingleRaw as OrderCountryCode)
      : null;

  const createdById = readTextParam(sp, "createdBy");
  const rawPaymentType = readTextParam(sp, "paymentType");
  const paymentType =
    rawPaymentType === "NONE"
      ? rawPaymentType
      : Object.values(PaymentMethod).includes(rawPaymentType as PaymentMethod)
        ? (rawPaymentType as PaymentMethod)
        : "";
  const amountMinRaw = readTextParam(sp, "amountMin");
  const amountMaxRaw = readTextParam(sp, "amountMax");
  const amountMin = parseAmount(amountMinRaw);
  const amountMax = parseAmount(amountMaxRaw);

  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: range.fromStart, lte: range.toEnd },
    ...(explicitWeek && explicitWeek === range.weekCode ? { weekCode: range.weekCode } : {}),
    ...(statusSingle ? { status: statusSingle } : {}),
    ...(countrySingle ? { sourceCountry: countrySingle } : {}),
    ...(createdById ? { createdById } : {}),
    ...(paymentType === "NONE"
      ? { paymentMethod: null }
      : paymentType
        ? { paymentMethod: paymentType as PaymentMethod }
        : {}),
    ...(amountMin != null || amountMax != null
      ? {
          amountUsd: {
            ...(amountMin != null ? { gte: new Prisma.Decimal(amountMin) } : {}),
            ...(amountMax != null ? { lte: new Prisma.Decimal(amountMax) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" } },
            { customerCodeSnapshot: { contains: q, mode: "insensitive" } },
            { customerNameSnapshot: { contains: q, mode: "insensitive" } },
            { createdBy: { fullName: { contains: q, mode: "insensitive" } } },
            { createdBy: { username: { contains: q, mode: "insensitive" } } },
            ...(parseAmount(q) != null
              ? [
                  { amountUsd: { equals: new Prisma.Decimal(parseAmount(q) ?? 0) } },
                  { commissionUsd: { equals: new Prisma.Decimal(parseAmount(q) ?? 0) } },
                  { totalUsd: { equals: new Prisma.Decimal(parseAmount(q) ?? 0) } },
                ]
              : []),
          ],
        }
      : {}),
  };

  const [totalOrders, payTotalsAgg, kpiOrders, createdByRows, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.payment.aggregate({
      where: { isPaid: true, order: { is: where } },
      _sum: { amountUsd: true },
    }),
    prisma.order.findMany({
      where,
      select: { id: true, totalIlsWithVat: true, totalIls: true },
      take: KPI_DEBT_ORDER_CAP,
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ fullName: "asc" }, { username: "asc" }],
      select: { id: true, fullName: true, username: true },
      take: 200,
    }),
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        customerCodeSnapshot: true,
        customerNameSnapshot: true,
        orderDate: true,
        weekCode: true,
        status: true,
        sourceCountry: true,
        paymentMethod: true,
        amountUsd: true,
        commissionUsd: true,
        totalUsd: true,
        totalIlsWithVat: true,
        totalIls: true,
        customer: { select: { phone: true, secondPhone: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
      },
    }),
  ]);

  const debtIds = kpiOrders.map((o) => o.id);
  const payIlsByOrder =
    debtIds.length > 0
      ? await prisma.payment.groupBy({
          by: ["orderId"],
          where: { orderId: { in: debtIds }, isPaid: true },
          _sum: { totalIlsWithVat: true, amountIls: true },
        })
      : [];
  const paidIlsMap = new Map<string, number>();
  for (const p of payIlsByOrder) {
    if (!p.orderId) continue;
    const raw = p._sum.totalIlsWithVat ?? p._sum.amountIls;
    paidIlsMap.set(p.orderId, Number(raw ?? 0));
  }

  let totalDebtIls = 0;
  for (const o of kpiOrders) {
    const orderIls = Number(o.totalIlsWithVat ?? o.totalIls ?? 0);
    const paidIls = paidIlsMap.get(o.id) ?? 0;
    const debt = orderIls - paidIls;
    if (debt > 0.01) totalDebtIls += debt;
  }

  const totalPaymentsUsd = Number(payTotalsAgg._sum.amountUsd ?? 0);

  const ids = rows.map((r) => r.id);
  const paySums =
    ids.length > 0
      ? await prisma.payment.groupBy({
          by: ["orderId"],
          where: { orderId: { in: ids } },
          _sum: { amountUsd: true },
        })
      : [];
  const paidByOrder = new Map<string, number>();
  for (const p of paySums) {
    if (p.orderId) {
      paidByOrder.set(p.orderId, Number(p._sum.amountUsd ?? 0));
    }
  }

  const orders: OrderListRow[] = rows.map((r) => {
    const total = r.totalUsd != null ? Number(r.totalUsd) : 0;
    const paid = paidByOrder.get(r.id) ?? 0;
    let paymentStatus: OrderListRow["paymentStatus"] = "unpaid";
    if (total > 0.01) {
      if (paid >= total - 0.02) paymentStatus = "paid";
      else if (paid > 0.01) paymentStatus = "partial";
    } else if (paid > 0.01) {
      paymentStatus = "partial";
    }

    return {
      id: r.id,
      orderNumber: r.orderNumber,
      customerId: r.customerId,
      customerName: r.customerNameSnapshot,
      customerPhone: r.customer?.phone ?? r.customer?.secondPhone ?? null,
      orderDateYmd: r.orderDate ? formatLocalYmd(new Date(r.orderDate)) : null,
      orderDateTime: fmtDateTime(r.orderDate ? new Date(r.orderDate) : null),
      weekCode: r.weekCode,
      status: r.status,
      sourceCountry: r.sourceCountry,
      paymentType: r.paymentMethod,
      createdByName: r.createdBy?.fullName || r.createdBy?.username || null,
      dealAmountUsd: fmtUsd2(r.amountUsd),
      commissionAmountUsd: fmtUsd2(r.commissionUsd),
      totalAmountUsd: fmtUsd2(r.totalUsd),
      totalAmountIls: fmtIls2(r.totalIlsWithVat ?? r.totalIls),
      paymentStatus,
    };
  });

  const createdByOptions: OrdersCreatedByOption[] = createdByRows.map((u) => ({
    id: u.id,
    label: u.fullName || u.username || u.id,
  }));

  return (
    <div className="adm-orders-excel-page">
      <Suspense fallback={<div className="adm-orders-toolbar-skel" />}>
        <OrdersListToolbar
          fromYmd={range.fromYmd}
          toYmd={range.toYmd}
          weekCode={range.weekCode}
          activePreset={presetParam}
          search={q}
          statusFilter={statusSingle ?? ""}
          countryFilter={countrySingle ?? ""}
          createdById={createdById}
          createdByOptions={createdByOptions}
          paymentType={paymentType}
          amountMin={amountMinRaw}
          amountMax={amountMaxRaw}
        />
      </Suspense>
      <OrdersListShell
        orders={orders}
        summary={{
          totalOrders: totalOrders.toLocaleString("he-IL"),
          totalPaymentsUsd: totalPaymentsUsd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          totalDebtIls: totalDebtIls.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        }}
        canCreateOrders={canCreateOrders}
        canEditOrders={canEditOrders}
        canViewCustomerCard={canViewCustomerCard}
        dateRange={range}
      />
    </div>
  );
}
