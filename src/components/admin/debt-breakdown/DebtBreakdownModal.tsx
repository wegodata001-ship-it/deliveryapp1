"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import type { CustomerDebtBreakdownDto, DebtBreakdownOpenOrder } from "@/lib/customer-debt-breakdown-types";
import { formatUsdDisplay } from "@/lib/money-format";
import { CustomerDebtSummary } from "@/components/admin/debt-breakdown/CustomerDebtSummary";
import { OpenDebtOrdersTable } from "@/components/admin/debt-breakdown/OpenDebtOrdersTable";
import { DebtPaymentHistoryTable } from "@/components/admin/debt-breakdown/DebtPaymentHistoryTable";
import { DebtAdjustmentsTable } from "@/components/admin/debt-breakdown/DebtAdjustmentsTable";
import { DebtMismatchAlert } from "@/components/admin/debt-breakdown/DebtMismatchAlert";
import { DebtOrderDetailPanel } from "@/components/admin/debt-breakdown/DebtOrderDetailPanel";

type TabId = "orders" | "payments" | "adjustments" | "sources";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export type DebtBreakdownModalProps = {
  open: boolean;
  customerId: string | null;
  country?: string | null;
  weekCode?: string | null;
  onClose: () => void;
  onOrderClick?: (orderId: string) => void;
};

export function DebtBreakdownModal({
  open,
  customerId,
  country,
  weekCode,
  onClose,
  onOrderClick,
}: DebtBreakdownModalProps) {
  const [data, setData] = useState<CustomerDebtBreakdownDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("orders");
  const [selectedOrder, setSelectedOrder] = useState<DebtBreakdownOpenOrder | null>(null);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (country) qs.set("country", country);
      if (weekCode) qs.set("week", weekCode);
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/debt-breakdown?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "טעינת פירוט החוב נכשלה");
      }
      const json = (await res.json()) as CustomerDebtBreakdownDto;
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בטעינה");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, country, weekCode]);

  useEffect(() => {
    if (!open || !customerId) return;
    setTab("orders");
    setSelectedOrder(null);
    void load();
  }, [open, customerId, load]);

  if (!open) return null;

  function handleOrderClick(orderId: string) {
    const row = data?.openOrders.find((o) => o.orderId === orderId);
    if (row) {
      setSelectedOrder(row);
      return;
    }
    onOrderClick?.(orderId);
    onClose();
  }

  return (
    <div className="adm-cash-modal-backdrop debt-breakdown-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal debt-breakdown-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="debt-breakdown-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cash-modal__head debt-breakdown-modal__head">
          <h3 id="debt-breakdown-title">
            <FileText size={18} aria-hidden /> פירוט החוב הפתוח
          </h3>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="adm-cash-modal__body debt-breakdown-modal__body">
          {loading ? (
            <p className="debt-breakdown-loading">
              <Loader2 size={18} className="debt-breakdown-spin" aria-hidden /> טוען פירוט חוב…
            </p>
          ) : err ? (
            <p className="debt-breakdown-error">{err}</p>
          ) : data ? (
            <>
              <CustomerDebtSummary data={data} />
              <DebtMismatchAlert data={data} onInspectSources={() => setTab("sources")} />
              <p className="debt-breakdown-explain">{data.explanationText}</p>

              <div className="debt-breakdown-tabs" role="tablist">
                <button type="button" role="tab" className={tab === "orders" ? "is-active" : ""} onClick={() => setTab("orders")}>
                  הזמנות פתוחות
                </button>
                <button type="button" role="tab" className={tab === "payments" ? "is-active" : ""} onClick={() => setTab("payments")}>
                  היסטוריית תשלומים
                </button>
                <button type="button" role="tab" className={tab === "adjustments" ? "is-active" : ""} onClick={() => setTab("adjustments")}>
                  יתרות והתאמות
                </button>
                <button type="button" role="tab" className={tab === "sources" ? "is-active" : ""} onClick={() => setTab("sources")}>
                  מקורות החוב
                </button>
              </div>

              {selectedOrder ? (
                <DebtOrderDetailPanel
                  order={selectedOrder}
                  payments={data.paymentHistory}
                  onClose={() => setSelectedOrder(null)}
                />
              ) : null}

              {tab === "orders" ? (
                <OpenDebtOrdersTable rows={data.openOrders} onOrderClick={handleOrderClick} />
              ) : null}
              {tab === "payments" ? <DebtPaymentHistoryTable rows={data.paymentHistory} /> : null}
              {tab === "adjustments" ? <DebtAdjustmentsTable rows={data.adjustments} /> : null}
              {tab === "sources" ? (
                <div className="debt-breakdown-sources">
                  <table className="debt-breakdown-table">
                    <thead>
                      <tr>
                        <th>מקור</th>
                        <th>סכום</th>
                        <th>הסבר</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.length === 0 ? (
                        <tr>
                          <td colSpan={3}>אין מקורות נוספים</td>
                        </tr>
                      ) : (
                        data.sources.map((s) => (
                          <tr key={s.id}>
                            <td>{s.label}</td>
                            <td dir="ltr">{money(Math.abs(s.amountUsd))}</td>
                            <td>{s.description ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <footer className="debt-breakdown-footer">
                <div className="debt-breakdown-footer__row">
                  <span>סה״כ יתרות פתוחות מההזמנות (בטבלת קליטה):</span>
                  <strong dir="ltr">{money(data.totals.openOrdersDebtVisible)}</strong>
                </div>
                {data.totals.otherSourcesTotal > 0.01 ? (
                  <div className="debt-breakdown-footer__row">
                    <span>חוב נוסף / יתרה ממקור אחר:</span>
                    <strong dir="ltr">{money(data.totals.otherSourcesTotal)}</strong>
                  </div>
                ) : null}
                <div className="debt-breakdown-footer__row debt-breakdown-footer__row--total">
                  <span>סה״כ חוב נוכחי:</span>
                  <strong dir="ltr">{money(data.totals.currentDebt)}</strong>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DebtBreakdownModal;
