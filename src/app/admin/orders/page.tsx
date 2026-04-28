import { OrderStatus } from "@prisma/client";
import { OrdersListShell, type OrderListRow } from "@/components/admin/OrdersListShell";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import { formatLocalYmd, parseDateFilterFromSearchParams } from "@/lib/work-week";

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_orders"]);
  const me = await requireAuth();
  const sp = await searchParams;
  const range = parseDateFilterFromSearchParams(sp);
  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canEditOrders = userHasAnyPermission(me, ["edit_orders"]);
  const canViewCustomerCard = userHasAnyPermission(me, ["view_customer_card"]);
  const rawStatus = typeof sp.status === "string" ? sp.status : "";
  const status = Object.values(OrderStatus).includes(rawStatus as OrderStatus) ? (rawStatus as OrderStatus) : null;

  const rows = await prisma.order.findMany({
    where: {
      deletedAt: null,
      orderDate: { gte: range.fromStart, lte: range.toEnd },
      ...(status ? { status } : {}),
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    take: 120,
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      customerNameSnapshot: true,
      orderDate: true,
      status: true,
      totalUsd: true,
    },
  });

  const orders: OrderListRow[] = rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    customerId: r.customerId,
    customerName: r.customerNameSnapshot,
    orderDateYmd: r.orderDate ? formatLocalYmd(new Date(r.orderDate)) : null,
    status: r.status,
    totalUsd: r.totalUsd != null ? r.totalUsd.toString() : null,
  }));

  return (
    <OrdersListShell
      orders={orders}
      canCreateOrders={canCreateOrders}
      canEditOrders={canEditOrders}
      canViewCustomerCard={canViewCustomerCard}
    />
  );
}
