import { Suspense } from "react";
import { OrderEditRequestStatus, OrderStatus, PaymentMethod } from "@prisma/client";
import { OrdersListShell, type OrderListRow } from "@/components/admin/OrdersListShell";
import { OrdersListToolbar, type OrdersCreatedByOption } from "@/components/admin/OrdersListToolbar";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import {
  formatLocalYmd,
  parseOrdersListDateFilterFromSearchParams,
} from "@/lib/work-week";
import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { hasActiveEditUnlock } from "@/lib/order-edit-lock";
import { withPerfTimer } from "@/lib/perf-log";
import { buildOrdersListWhereFromSearchParams } from "@/app/admin/orders/orders-list-where";

/** רשימת הזמנות חייבת להיבנות מחדש אחרי שמירה — לא מטמון סטטי */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const paymentLocationRaw = readTextParam(sp, "paymentLocation");
  const amountMinRaw = readTextParam(sp, "amountMin");
  const amountMaxRaw = readTextParam(sp, "amountMax");
  const amountMin = parseAmount(amountMinRaw);
  const amountMax = parseAmount(amountMaxRaw);

  const where = buildOrdersListWhereFromSearchParams(sp);

  /**
   * KPI לפי סטטוס — קלט יחיד ל־DB:
   * groupBy על כל ההזמנות בטווח (כולל CANCELLED) — סופרים ומסכמים totalUsd.
   * כך אפשר להציג 4 cards (פתוחות / בטיפול / מוכנות / מבוטלות)
   * בלי לשבור את ה־totals של הסיכומים האחרים שעדיין מסננים את CANCELLED.
   */

  const [statusGroups, createdByRows, intakeLocationRows, rows] = await withPerfTimer(
    "orders.page.fetchOrders",
    async () =>
      Promise.all([
        prisma.order.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
          _sum: { totalUsd: true },
        }),
        prisma.user.findMany({
          where: { isActive: true },
          orderBy: [{ fullName: "asc" }, { username: "asc" }],
          select: { id: true, fullName: true, username: true },
          take: 200,
        }),
        prisma.intakeLocation.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
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
            paymentPointId: true,
            locationId: true,
            paymentPoint: { select: { id: true, pointName: true } },
            amountUsd: true,
            commissionUsd: true,
            totalUsd: true,
            debtWithdrawalUsd: true,
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

  const sensitiveIds = rows
    .filter((r) => r.status === OrderStatus.COMPLETED || r.status === OrderStatus.CANCELLED)
    .map((r) => r.id);
  let pendingEditOrderIds = new Set<string>();
  /** לכל הזמנה עם בקשה ממתינה — מי שלח (לבדיקת "שלי" מול "אחר") */
  const pendingRequestedByUserId = new Map<string, string>();
  const latestEditRequestByOrder = new Map<
    string,
    { status: OrderEditRequestStatus; requestedByUserId: string }
  >();
  if (sensitiveIds.length > 0) {
    const [pendingRows, recentRequests] = await Promise.all([
      prisma.orderEditRequest.findMany({
        where: { orderId: { in: sensitiveIds }, status: OrderEditRequestStatus.PENDING },
        select: { orderId: true, requestedByUserId: true },
      }),
      prisma.orderEditRequest.findMany({
        where: { orderId: { in: sensitiveIds } },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, status: true, requestedByUserId: true },
        take: 4000,
      }),
    ]);
    pendingEditOrderIds = new Set(pendingRows.map((p) => p.orderId));
    for (const p of pendingRows) {
      pendingRequestedByUserId.set(p.orderId, p.requestedByUserId);
    }
    for (const req of recentRequests) {
      if (!latestEditRequestByOrder.has(req.orderId)) {
        latestEditRequestByOrder.set(req.orderId, {
          status: req.status,
          requestedByUserId: req.requestedByUserId,
        });
      }
    }
  }

  /**
   * חלוקת groupBy ל־4 דליים סטטיסטיים:
   *   open       — OPEN
   *   inProgress — WAITING_FOR_EXECUTION | SENT | WITHDRAWAL_FROM_SUPPLIER | WAITING_FOR_CHINA_EXECUTION
   *   completed  — COMPLETED
   *   cancelled  — CANCELLED  (מוצג ב־card נפרד; לא משתתף ב־totals של האחרים)
   */
  const statusSummaryAcc = {
    open: { count: 0, totalUsd: 0 },
    inProgress: { count: 0, totalUsd: 0 },
    completed: { count: 0, totalUsd: 0 },
    cancelled: { count: 0, totalUsd: 0 },
    debtWithdrawal: { count: 0, totalUsd: 0 },
  };
  for (const g of statusGroups) {
    const count = g._count?._all ?? 0;
    const totalUsd = Number(g._sum?.totalUsd ?? 0);
    switch (g.status) {
      case OrderStatus.OPEN:
        statusSummaryAcc.open.count += count;
        statusSummaryAcc.open.totalUsd += totalUsd;
        break;
      case OrderStatus.COMPLETED:
        statusSummaryAcc.completed.count += count;
        statusSummaryAcc.completed.totalUsd += totalUsd;
        break;
      case OrderStatus.CANCELLED:
        statusSummaryAcc.cancelled.count += count;
        statusSummaryAcc.cancelled.totalUsd += totalUsd;
        break;
      case OrderStatus.DEBT_WITHDRAWAL:
        statusSummaryAcc.debtWithdrawal.count += count;
        statusSummaryAcc.debtWithdrawal.totalUsd += totalUsd;
        break;
      case OrderStatus.WAITING_FOR_EXECUTION:
      case OrderStatus.WITHDRAWAL_FROM_SUPPLIER:
      case OrderStatus.SENT:
      case OrderStatus.WAITING_FOR_CHINA_EXECUTION:
        statusSummaryAcc.inProgress.count += count;
        statusSummaryAcc.inProgress.totalUsd += totalUsd;
        break;
      default:
        break;
    }
  }
  const fmtUsdCompact = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const statusSummary = {
    open: {
      count: statusSummaryAcc.open.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.open.totalUsd),
    },
    inProgress: {
      count: statusSummaryAcc.inProgress.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.inProgress.totalUsd),
    },
    completed: {
      count: statusSummaryAcc.completed.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.completed.totalUsd),
    },
    cancelled: {
      count: statusSummaryAcc.cancelled.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.cancelled.totalUsd),
    },
    debtWithdrawal: {
      count: statusSummaryAcc.debtWithdrawal.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.debtWithdrawal.totalUsd),
    },
  };

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
    const rawPaid = paidByOrder.get(r.id) ?? 0;
    /**
     * "משיכה מהחוב" — סכום שקוזז מקרדיט הלקוח נחשב כשולם
     * עבור ההזמנה (לא נוצר Payment record כדי לא לזהם דוחות הכנסה).
     */
    const debtWithdrawal = r.debtWithdrawalUsd != null ? Number(r.debtWithdrawalUsd) : 0;
    const paid = rawPaid + debtWithdrawal;
    const balanceUsd = total - paid;
    let paymentStatus: OrderListRow["paymentStatus"] = "unpaid";
    if (total > 0.01) {
      if (paid >= total - 0.02) paymentStatus = "paid";
      else if (paid > 0.01) paymentStatus = "partial";
    } else if (paid > 0.01) {
      paymentStatus = "partial";
    }

    let editBadge: OrderListRow["editBadge"] = null;
    let pendingEditOwnedByMe = false;
    const sensitiveForEditLock = r.status === OrderStatus.COMPLETED || r.status === OrderStatus.CANCELLED;
    if (sensitiveForEditLock) {
      if (pendingEditOrderIds.has(r.id)) {
        editBadge = "pending";
        pendingEditOwnedByMe = pendingRequestedByUserId.get(r.id) === me.id;
      } else if (
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
      sensitiveForEditLock &&
      !hasActiveEditUnlock({
        editUnlockedForUserId: r.editUnlockedForUserId,
        editUnlockedUntil: r.editUnlockedUntil,
        viewerUserId: me.id,
      });

    const intakeLocationNameById = (id: string | null | undefined): string | null => {
      if (!id) return null;
      const hit = intakeLocationRows.find((x) => x.id === id);
      return hit?.name?.trim() || null;
    };
    const paymentLocationId = r.paymentPointId ?? r.locationId ?? null;
    const paymentLocationName =
      r.paymentPoint?.pointName?.trim() || intakeLocationNameById(r.locationId) || null;

    return {
      id: r.id,
      orderNumber: r.orderNumber,
      customerId: r.customerId,
      customerCode: r.customerCodeSnapshot?.trim() || null,
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
      paymentLocationId,
      paymentLocationName,
      createdByName: r.createdBy?.fullName || r.createdBy?.username || null,
      dealAmountUsd: fmtUsd2(r.amountUsd),
      commissionAmountUsd: fmtUsd2(r.commissionUsd),
      totalAmountUsd: fmtUsd2(r.totalUsd),
      balanceUsd: fmtUsd2(balanceUsd),
      totalAmountIls: fmtIls2(r.totalIlsWithVat ?? r.totalIls),
      paymentStatus,
      editBadge,
      pendingEditOwnedByMe: editBadge === "pending" ? pendingEditOwnedByMe : undefined,
      quickStatusLocked,
    };
  });

  const createdByOptions: OrdersCreatedByOption[] = createdByRows.map((u) => ({
    id: u.id,
    label: u.fullName || u.username || u.id,
  }));

  const paymentLocationOptions = intakeLocationRows.map((l) => ({ id: l.id, label: l.name }));

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
          paymentLocation={paymentLocationRaw}
          paymentLocationOptions={paymentLocationOptions}
          amountMin={amountMinRaw}
          amountMax={amountMaxRaw}
        />
      </Suspense>
      <OrdersListShell
        orders={orders}
        statusSummary={statusSummary}
        viewerIsAdmin={isAdminUser(me)}
        canCreateOrders={canCreateOrders}
        canEditOrders={canEditOrders}
        canViewCustomerCard={canViewCustomerCard}
        dateRange={range}
        paymentLocationOptions={paymentLocationOptions}
      />
    </div>
  );
}
