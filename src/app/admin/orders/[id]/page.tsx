import { notFound } from "next/navigation";
import { getOrderEditEntryHintAction, type OrderEditEntryHint } from "@/app/admin/order-edit-requests/actions";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { formatLocalYmd } from "@/lib/work-week";
import { orderBusinessStatusDisplay } from "@/lib/order-business-status";
import { orderCountryBadgeClass, orderCountryLabel } from "@/lib/order-countries";
import { OrderDetailActions } from "@/components/admin/OrderDetailActions";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";
import { isCompositePaymentMethod } from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";

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
  const docCanView = userHasAnyPermission(me, ["documents.view"]);
  const docCanUpload = userHasAnyPermission(me, ["documents.upload"]);
  const docCanDelete = userHasAnyPermission(me, ["documents.delete"]);
  const docCanDownload = userHasAnyPermission(me, ["documents.download", "documents.view"]);
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
      paymentMethod: true,
      paymentBreakdown: {
        select: { paymentMethod: true, amount: true, currency: true },
        orderBy: { createdAt: "asc" },
      },
      editUnlockedForUserId: true,
      editUnlockedUntil: true,
    },
  });
  if (!order) notFound();

  const isComposite = isCompositePaymentMethod(order.paymentMethod);
  const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m] ?? m;

  let editEntryHint: OrderEditEntryHint = { kind: "direct" };
  if (userHasAnyPermission(me, ["edit_orders"])) {
    editEntryHint = await getOrderEditEntryHintAction(order.id);
  }

  const paidAgg = await prisma.payment.aggregate({
    where: { orderId: order.id, amountUsd: { not: null } },
    _sum: { amountUsd: true },
  });
  const paidUsd = Number(paidAgg._sum.amountUsd ?? 0);

  // בוצע בפועל לכל אמצעי (USD) — לצורך הצגת מתוכנן מול בפועל בהזמנה מורכבת
  const actualByMethod = new Map<string, number>();
  if (isComposite) {
    const methodPayments = await prisma.payment.findMany({
      where: { orderId: order.id, status: "ACTIVE", amountUsd: { not: null } },
      select: { amountUsd: true, paymentMethod: true, usdPaymentMethod: true, ilsPaymentMethod: true },
    });
    for (const p of methodPayments) {
      const m = (p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod || "").trim();
      if (!m || isCompositePaymentMethod(m)) continue;
      actualByMethod.set(m, (actualByMethod.get(m) ?? 0) + Number(p.amountUsd ?? 0));
    }
  }
  const plannedMethods = new Set(order.paymentBreakdown.map((b) => b.paymentMethod));
  const extraActualMethods = [...actualByMethod.keys()].filter((m) => !plannedMethods.has(m));
  const hasMethodDeviation = extraActualMethods.length > 0;
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
        <OrderDetailActions orderId={order.id} canEdit={canEdit} editEntryHint={editEntryHint} />
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
            <div>
              <dt>אמצעי תשלום</dt>
              <dd>
                {order.paymentMethod ? methodLabel(order.paymentMethod) : "—"}
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

      {isComposite && order.paymentBreakdown.length > 0 ? (
        <section className="adm-order-detail-card">
          <h2 className="adm-order-detail-h">
            חלוקת תשלום — מתוכנן מול בפועל
            {hasMethodDeviation ? (
              <span className="payment-upd-deviation-badge" style={{ marginInlineStart: 8 }}>
                חריגת אמצעי תשלום
              </span>
            ) : null}
          </h2>
          <table className="adm-order-detail-pbd">
            <thead>
              <tr>
                <th>אמצעי תשלום</th>
                <th>מתוכנן</th>
                <th>בוצע בפועל</th>
              </tr>
            </thead>
            <tbody>
              {order.paymentBreakdown.map((b, i) => {
                const actual = actualByMethod.get(b.paymentMethod);
                return (
                  <tr key={`p-${i}`}>
                    <td>{methodLabel(b.paymentMethod)}</td>
                    <td dir="ltr" className="adm-order-detail-money">
                      {b.currency === "ILS" ? "₪" : "$"}
                      {fmtUsd2(b.amount)}
                    </td>
                    <td dir="ltr" className="adm-order-detail-money">
                      {actual != null ? `$${actual.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                );
              })}
              {extraActualMethods.map((m) => (
                <tr key={`a-${m}`} className="adm-order-detail-pbd-dev">
                  <td>
                    {methodLabel(m)} <span className="adm-order-detail-pbd-tag">לא תוכנן</span>
                  </td>
                  <td dir="ltr" className="adm-order-detail-money">—</td>
                  <td dir="ltr" className="adm-order-detail-money">${(actualByMethod.get(m) ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {order.notes?.trim() ? (
        <section className="adm-order-detail-notes">
          <h2 className="adm-order-detail-h">הערות</h2>
          <p className="adm-order-detail-notes-body">{order.notes.trim()}</p>
        </section>
      ) : null}

      {docCanView ? (
        <section className="adm-order-detail-docs">
          <DocumentsPanel
            entityType="ORDER"
            entityId={order.id}
            canView={docCanView}
            canUpload={docCanUpload}
            canDelete={docCanDelete}
            canDownload={docCanDownload}
          />
        </section>
      ) : null}
    </div>
  );
}
