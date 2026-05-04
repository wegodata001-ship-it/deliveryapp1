import { notFound } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { formatLocalYmd } from "@/lib/work-week";
import { orderBusinessStatusDisplay } from "@/lib/order-business-status";
import { orderCountryBadgeClass, orderCountryLabel } from "@/lib/order-countries";
import { OrderDetailActions } from "@/components/admin/OrderDetailActions";

const PAYMENT_STATUS_HE = {
  unpaid: "לא שולם",
  partial: "שולם חלקי",
  paid: "שולם",
} as const;

function fmtUsd2(n: unknown): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function derivePaymentStatus(total: number, paid: number): keyof typeof PAYMENT_STATUS_HE {
  let paymentStatus: keyof typeof PAYMENT_STATUS_HE = "unpaid";
  if (total > 0.01) {
    if (paid >= total - 0.02) paymentStatus = "paid";
    else if (paid > 0.01) paymentStatus = "partial";
  } else if (paid > 0.01) {
    paymentStatus = "partial";
  }
  return paymentStatus;
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRoutePermission(["view_orders"]);
  const me = await requireAuth();
  const canEdit = userHasAnyPermission(me, ["edit_orders"]);
  const { id } = await params;

  const order = await prisma.order.findFirst({
    where: { id: id.trim(), deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      customerNameSnapshot: true,
      orderDate: true,
      status: true,
      sourceCountry: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
      notes: true,
    },
  });
  if (!order) notFound();

  const paidAgg = await prisma.payment.aggregate({
    where: { orderId: order.id, amountUsd: { not: null } },
    _sum: { amountUsd: true },
  });
  const paidUsd = Number(paidAgg._sum.amountUsd ?? 0);
  const totalUsd = order.totalUsd != null ? Number(order.totalUsd) : 0;
  const payKey = derivePaymentStatus(totalUsd, paidUsd);
  const st = orderBusinessStatusDisplay(order.status);

  const orderDateYmd = order.orderDate ? formatLocalYmd(new Date(order.orderDate)) : "—";

  return (
    <div className="adm-order-detail-page">
      <div className="adm-order-detail-head">
        <div>
          <h1 className="adm-page-title adm-page-title--sm">הזמנה {order.orderNumber ?? "—"}</h1>
          <p className="adm-order-detail-sub">דף הזמנה · תצוגה בלבד</p>
        </div>
        <OrderDetailActions orderId={order.id} canEdit={canEdit} />
      </div>

      <div className="adm-order-detail-grid">
        <section className="adm-order-detail-card">
          <h2 className="adm-order-detail-h">פרטים</h2>
          <dl className="adm-order-detail-dl">
            <div>
              <dt>לקוח</dt>
              <dd>
                <strong>{order.customerNameSnapshot ?? "—"}</strong>
              </dd>
            </div>
            <div>
              <dt>תאריך</dt>
              <dd dir="ltr">{orderDateYmd}</dd>
            </div>
            <div>
              <dt>מדינה</dt>
              <dd>
                <span className={orderCountryBadgeClass(order.sourceCountry)}>{orderCountryLabel(order.sourceCountry)}</span>
              </dd>
            </div>
            <div>
              <dt>סטטוס</dt>
              <dd>
                <span className={st.className}>{st.label}</span>
              </dd>
            </div>
            <div>
              <dt>מצב תשלום</dt>
              <dd>
                <span className={`adm-pay-st adm-pay-st--${payKey}`}>{PAYMENT_STATUS_HE[payKey]}</span>
              </dd>
            </div>
          </dl>
        </section>

        <section className="adm-order-detail-card">
          <h2 className="adm-order-detail-h">סכומים (USD)</h2>
          <dl className="adm-order-detail-dl">
            <div>
              <dt>סכום עסקה</dt>
              <dd dir="ltr" className="adm-order-detail-money">
                {fmtUsd2(order.amountUsd)}
              </dd>
            </div>
            <div>
              <dt>עמלה</dt>
              <dd dir="ltr" className="adm-order-detail-money">
                {fmtUsd2(order.commissionUsd)}
              </dd>
            </div>
            <div>
              <dt>סה״כ</dt>
              <dd dir="ltr" className="adm-order-detail-money adm-order-detail-money--total">
                {fmtUsd2(order.totalUsd)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {order.notes?.trim() ? (
        <section className="adm-order-detail-notes">
          <h2 className="adm-order-detail-h">הערות</h2>
          <p className="adm-order-detail-notes-body">{order.notes.trim()}</p>
        </section>
      ) : null}
    </div>
  );
}
