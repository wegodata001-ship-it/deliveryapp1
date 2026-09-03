"use client";

import type { CustomerLedgerRow } from "@/app/admin/capture/actions";
import { buildLedgerRowDetailView } from "@/lib/ledger-row-detail";

type Props = {
  row: CustomerLedgerRow | null;
  onClose: () => void;
  onOpenPayment?: (paymentId: string) => void;
  onOpenOrder?: (orderId: string) => void;
};

export function LedgerRowDetailModal({ row, onClose, onOpenPayment, onOpenOrder }: Props) {
  if (!row) return null;
  const view = buildLedgerRowDetailView(row);

  return (
    <div className="adm-mini-modal-layer" role="presentation" onClick={onClose}>
      <div
        className="adm-mini-modal ledger-row-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="ledger-row-detail-modal__head">
          <h3 className="adm-mini-modal-title">{view.title}</h3>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose}>
            סגור
          </button>
        </div>
        {view.fields.length === 0 ? (
          <p className="adm-win-meta">אין פירוט נוסף לתנועה זו.</p>
        ) : (
          <dl className="ledger-row-detail-modal__list">
            {view.fields.map((field) => (
              <div key={`${field.label}:${field.value}`} className="ledger-row-detail-modal__row">
                <dt>{field.label}</dt>
                <dd dir="auto">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="adm-mini-modal-actions">
          {view.openPaymentId && onOpenPayment ? (
            <button
              type="button"
              className="adm-btn adm-btn--ghost"
              onClick={() => onOpenPayment(view.openPaymentId!)}
            >
              פתח תשלום
            </button>
          ) : null}
          {view.openOrderId && onOpenOrder ? (
            <button
              type="button"
              className="adm-btn adm-btn--ghost"
              onClick={() => onOpenOrder(view.openOrderId!)}
            >
              פתח הזמנה
            </button>
          ) : null}
          <button type="button" className="adm-btn adm-btn--primary" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
