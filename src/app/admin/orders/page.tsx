import { Suspense } from "react";
import { OrderEditRequestStatus, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { OrdersListShell, type OrderListRow } from "@/components/admin/OrdersListShell";
import { OrdersListToolbar, type OrdersCreatedByOption } from "@/components/admin/OrdersListToolbar";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import {
  formatLocalYmd,
  normalizeAhWeekCode,
  parseOrdersListDateFilterFromSearchParams,
} from "@/lib/work-week";
import { ORDER_COUNTRY_CODES, orderCountryCodesMatchingHeSearch, type OrderCountryCode } from "@/lib/order-countries";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { hasActiveEditUnlock } from "@/lib/order-edit-lock";
import { withPerfTimer } from "@/lib/perf-log";

/** רשימת הזמנות חייבת להיבנות מחדש אחרי שמירה — לא מטמון סטטי */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function buildOrdersListSearchWhere(q: string): Prisma.OrderWhereInput | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const amt = parseAmount(t);
  const countryHits = orderCountryCodesMatchingHeSearch(t);
  const compactAh = t.replace(/\s+/g, "").toUpperCase();
  const bareWeek = /^AH-\d{1,6}$/i.test(compactAh) ? normalizeAhWeekCode(compactAh) : null;

  const ors: Prisma.OrderWhereInput[] = [
    { orderNumber: { contains: t, mode: "insensitive" } },
    { customerCodeSnapshot: { contains: t, mode: "insensitive" } },
    { customerNameSnapshot: { contains: t, mode: "insensitive" } },
    { createdBy: { fullName: { contains: t, mode: "insensitive" } } },
    { createdBy: { username: { contains: t, mode: "insensitive" } } },
    { weekCode: { contains: t, mode: "insensitive" } },
    { customer: { phone: { contains: t, mode: "insensitive" } } },
    { customer: { secondPhone: { contains: t, mode: "insensitive" } } },
  ];
  if (countryHits.length > 0) {
    ors.push({ sourceCountry: { in: countryHits } });
  }
  if (bareWeek) {
    ors.push({ weekCode: { equals: bareWeek, mode: "insensitive" } });
  }
  if (amt != null) {
    const d = new Prisma.Decimal(amt);
    ors.push(
      { amountUsd: { equals: d } },
      { commissionUsd: { equals: d } },
      { totalUsd: { equals: d } },
    );
  }
  return { OR: ors };
}

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_orders"]);
  const me = await requireAuth();
  const sp = await searchParams;
  const range = parseOrdersListDateFilterFromSearchParams(sp);
  const presetParam =
    (typeof sp.ordersPreset === "string" ? sp.ordersPreset : null) ??
    (typeof sp.preset === "string" ? sp.preset : null);

  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canEditOrders = userHasAnyPermission(me, ["edit_orders"]);
  const canViewCustomerCard = userHasAnyPermission(me, ["view_customer_card"]);
  const q = readTextParam(sp, "q");

  const statusSingleRaw = readTextParam(sp, "status");
  const statusSingle =
    statusSingleRaw && TABLE_STATUS_SET.has(statusSingleRaw as OrderStatus)
      ? (statusSingleRaw as OrderStatus)
      : null;

  const ordersCountryRaw = readTextParam(sp, "ordersCountry");
  const countrySingle =
    ordersCountryRaw && ORDER_COUNTRY_CODES.includes(ordersCountryRaw as OrderCountryCode)
      ? (ordersCountryRaw as OrderCountryCode)
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

  const searchWhere = buildOrdersListSearchWhere(q);

  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: range.fromStart, lte: range.toEnd },
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
    ...(searchWhere ? searchWhere : {}),
  };

  const [totalOrders, payTotalsAgg, kpiOrders, createdByRows, rows] = await withPerfTimer(
    "orders.page.fetchOrders",
    async () =>
      Promise.all([
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
            customer: {
              select: {
                phone: true,
                secondPhone: true,
                displayName: true,
                nameAr: true,
                nameEn: true,
                nameHe: true,
              },
            },
            createdBy: { select: { id: true, fullName: true, username: true } },
            editUnlockedForUserId: true,
            editUnlockedUntil: true,
          },
        }),
      ]),
  );

  const completedIds = rows.filter((r) => r.status === OrderStatus.COMPLETED).map((r) => r.id);
  let pendingEditOrderIds = new Set<string>();
  const latestEditRequestByOrder = new Map<
    string,
    { status: OrderEditRequestStatus; requestedByUserId: string }
  >();
  if (completedIds.length > 0) {
    const [pendingRows, recentRequests] = await Promise.all([
      prisma.orderEditRequest.findMany({
        where: { orderId: { in: completedIds }, status: OrderEditRequestStatus.PENDING },
        select: { orderId: true },
      }),
      prisma.orderEditRequest.findMany({
        where: { orderId: { in: completedIds } },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, status: true, requestedByUserId: true },
        take: 4000,
      }),
    ]);
    pendingEditOrderIds = new Set(pendingRows.map((p) => p.orderId));
    for (const req of recentRequests) {
      if (!latestEditRequestByOrder.has(req.orderId)) {
        latestEditRequestByOrder.set(req.orderId, {
          status: req.status,
          requestedByUserId: req.requestedByUserId,
        });
      }
    }
  }

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
    const balanceUsd = total - paid;
    let paymentStatus: OrderListRow["paymentStatus"] = "unpaid";
    if (total > 0.01) {
      if (paid >= total - 0.02) paymentStatus = "paid";
      else if (paid > 0.01) paymentStatus = "partial";
    } else if (paid > 0.01) {
      paymentStatus = "partial";
    }

    let editBadge: OrderListRow["editBadge"] = null;
    if (r.status === OrderStatus.COMPLETED) {
      if (pendingEditOrderIds.has(r.id)) editBadge = "pending";
      else if (
        hasActiveEditUnlock({
          editUnlockedForUserId: r.editUnlockedForUserId,
          editUnlockedUntil: r.editUnlockedUntil,
          viewerUserId: me.id,
        })
      )
        editBadge = "unlock";
      else {
        const latest = latestEditRequestByOrder.get(r.id);
        if (
          latest?.status === OrderEditRequestStatus.REJECTED &&
          latest.requestedByUserId === me.id
        )
          editBadge = "rejected";
        else if (!isAdminUser(me)) editBadge = "locked";
      }
    }

    const quickStatusLocked =
      canEditOrders &&
      !isAdminUser(me) &&
      r.status === OrderStatus.COMPLETED &&
      !hasActiveEditUnlock({
        editUnlockedForUserId: r.editUnlockedForUserId,
        editUnlockedUntil: r.editUnlockedUntil,
        viewerUserId: me.id,
      });

    return {
      id: r.id,
      orderNumber: r.orderNumber,
      customerId: r.customerId,
      customerName: primaryCustomerDisplayName({
        nameAr: r.customer?.nameAr ?? null,
        nameEn: r.customer?.nameEn ?? null,
        nameHe: r.customer?.nameHe ?? null,
        displayName: r.customerNameSnapshot ?? r.customer?.displayName ?? "",
      }),
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
      balanceUsd: fmtUsd2(balanceUsd),
      totalAmountIls: fmtIls2(r.totalIlsWithVat ?? r.totalIls),
      paymentStatus,
      editBadge,
      quickStatusLocked,
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
          ahWeekSelect={range.ahWeekSelect}
          activePreset={presetParam}
          search={q}
          statusFilter={statusSingle ?? ""}
          countryFilter={ordersCountryRaw}
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
