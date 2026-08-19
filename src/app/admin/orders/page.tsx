import { OrdersListShell } from "@/components/admin/OrdersListShell";
import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";
import { fetchOrdersListPageData } from "@/lib/orders-list-data";
import { readMultiParam } from "@/lib/orders-list-filter-params";
import { perfEnabled } from "@/lib/perf-log";
import { requireRoutePermission } from "@/lib/route-access";
import { resolveOrdersListCustomerQuery } from "@/app/admin/orders/orders-list-where";
import { parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";
import "@/app/admin/shipments/shipments.css";

/** רשימת הזמנות חייבת להיבנות מחדש אחרי שמירה — לא מטמון סטטי */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readTextParam(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t0 = Date.now();
  const me = await requireRoutePermission(["view_orders"]);
  const sp = await searchParams;
  const range = parseOrdersListDateFilterFromSearchParams(sp);
  const presetParam =
    (typeof sp.ordersPreset === "string" ? sp.ordersPreset : null) ??
    (typeof sp.preset === "string" ? sp.preset : null);

  const fetchT0 = Date.now();
  let orders: Awaited<ReturnType<typeof fetchOrdersListPageData>>["orders"] = [];
  let statusSummary: Awaited<ReturnType<typeof fetchOrdersListPageData>>["statusSummary"];
  let createdByOptions: Awaited<ReturnType<typeof fetchOrdersListPageData>>["createdByOptions"] = [];
  let countryFilterOptions: Awaited<ReturnType<typeof fetchOrdersListPageData>>["countryFilterOptions"] = [];
  let paymentLocationOptions: Awaited<ReturnType<typeof fetchOrdersListPageData>>["paymentLocationOptions"] = [];
  let pagination: Awaited<ReturnType<typeof fetchOrdersListPageData>>["pagination"] = {
    page: 1,
    pageSize: 50,
    totalCount: 0,
    totalPages: 0,
  };
  let loadError: string | null = null;

  try {
    const data = await fetchOrdersListPageData(sp, me);
    orders = data.orders;
    statusSummary = data.statusSummary;
    createdByOptions = data.createdByOptions;
    countryFilterOptions = data.countryFilterOptions;
    paymentLocationOptions = data.paymentLocationOptions;
    pagination = data.pagination;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "שגיאה בטעינת רשימת ההזמנות";
    console.error("[orders-list] fetchOrdersListPageData failed", err);
    statusSummary = {
      all: { count: "0", totalUsd: "0.00" },
      open: { count: "0", totalUsd: "0.00" },
      inProgress: { count: "0", totalUsd: "0.00" },
      completed: { count: "0", totalUsd: "0.00" },
      cancelled: { count: "0", totalUsd: "0.00" },
      debtWithdrawal: { count: "0", totalUsd: "0.00" },
      operationalCompleted: { count: "0", totalUsd: "0.00" },
    };
  }
  const fetchMs = Date.now() - fetchT0;

  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canEditOrders = userHasAnyPermission(me, ["edit_orders"]);
  const canReceivePayments = userHasAnyPermission(me, ["receive_payments"]);
  const canViewCustomerCard = userHasAnyPermission(me, ["view_customer_card"]);

  const toolbarProps = {
    fromYmd: range.fromYmd,
    toYmd: range.toYmd,
    ahWeekSelect: range.ahWeekSelect,
    activePreset: presetParam,
    customerQuery: resolveOrdersListCustomerQuery(sp),
    ordersOrderNum: readTextParam(sp, "ordersOrderNum"),
    customerPhone: readTextParam(sp, "ordersPhone"),
    statusFilter: readMultiParam(sp, "status"),
    countryFilter: readMultiParam(sp, "ordersCountry"),
    createdByIds: readMultiParam(sp, "createdBy"),
    createdByOptions,
    countryFilterOptions,
    paymentTypes: readMultiParam(sp, "paymentType"),
    paymentLocation: readTextParam(sp, "paymentLocation"),
    paymentLocationOptions,
    amountMin: readTextParam(sp, "amountMin"),
    amountMax: readTextParam(sp, "amountMax"),
    ordersOpenOnly: readTextParam(sp, "ordersOpenOnly") === "1",
    ordersReadyOnly: readTextParam(sp, "ordersReadyOnly") === "1",
  };

  const renderT0 = Date.now();
  const node = (
    <div className="adm-orders-excel-page adm-page--page-scroll">
      <OrdersListShell
        orders={orders}
        statusSummary={statusSummary}
        pagination={pagination}
        viewerIsAdmin={isAdminUser(me)}
        canCreateOrders={canCreateOrders}
        canEditOrders={canEditOrders}
        canReceivePayments={canReceivePayments}
        canViewCustomerCard={canViewCustomerCard}
        loadError={loadError}
        dateRange={range}
        paymentLocationOptions={paymentLocationOptions}
        toolbarProps={toolbarProps}
      />
    </div>
  );
  const renderMs = Date.now() - renderT0;

  if (perfEnabled()) {
    const totalMs = Date.now() - t0;
    const serializationMs = 0;
    console.table({
      fetchMs,
      renderMs,
      serializationMs,
      totalMs,
    });
  }

  return node;
}
