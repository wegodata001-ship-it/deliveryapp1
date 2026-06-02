import { OrdersListShell } from "@/components/admin/OrdersListShell";
import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";
import { fetchOrdersListPageData } from "@/lib/orders-list-data";
import { perfEnabled } from "@/lib/perf-log";
import { requireRoutePermission } from "@/lib/route-access";
import { resolveOrdersListCustomerQuery } from "@/app/admin/orders/orders-list-where";
import { parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";

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
  const { orders, statusSummary, createdByOptions, paymentLocationOptions, pagination } =
    await fetchOrdersListPageData(sp, me);
  const fetchMs = Date.now() - fetchT0;

  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canEditOrders = userHasAnyPermission(me, ["edit_orders"]);
  const canViewCustomerCard = userHasAnyPermission(me, ["view_customer_card"]);

  const toolbarProps = {
    fromYmd: range.fromYmd,
    toYmd: range.toYmd,
    ahWeekSelect: range.ahWeekSelect,
    activePreset: presetParam,
    customerQuery: resolveOrdersListCustomerQuery(sp),
    ordersOrderNum: readTextParam(sp, "ordersOrderNum"),
    customerPhone: readTextParam(sp, "ordersPhone"),
    statusFilter: readTextParam(sp, "status"),
    countryFilter: readTextParam(sp, "ordersCountry"),
    createdById: readTextParam(sp, "createdBy"),
    createdByOptions,
    paymentType: readTextParam(sp, "paymentType"),
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
        canViewCustomerCard={canViewCustomerCard}
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
