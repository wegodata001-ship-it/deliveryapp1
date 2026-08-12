"use client";

import { useEffect } from "react";
import {
  manualShipmentPaymentFromRow,
} from "@/lib/manual-shipment-payment";
import { statusLabel, type ManualShipmentDto } from "@/app/admin/shipments/manual/types";

type Props = {
  open: boolean;
  row: ManualShipmentDto | null;
  onClose: () => void;
  onEdit?: (row: ManualShipmentDto) => void;
};

function fmtMoney(v: number): string {
  return v.toLocaleString("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  });
}

function fmtMoneyPlain(v: number): string {
  return v.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

export function ManualShipmentPaymentDetailModal({ open, row, onClose, onEdit }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const breakdown = manualShipmentPaymentFromRow(row);
  const title =
    [row.shipmentDetails, row.containerNumber].filter(Boolean).join(" · ") ||
    row.shipmentNumber ||
    "משלוח ידני";

  return (
    <div className="msh-detail-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="msh-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="msh-detail-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="msh-detail-modal__head">
          <div>
            <h2 id="msh-detail-modal-title">פירוט תשלום</h2>
            <p className="msh-detail-modal__sub">{title}</p>
          </div>
          <button type="button" className="msh-detail-modal__close" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </header>

        <div className="msh-detail-modal__body">
          <section className="msh-detail-modal__section">
            <h3>פרטי המשלוח</h3>
            <dl className="msh-detail-modal__dl">
              {row.country ? (
                <>
                  <dt>מדינה</dt>
                  <dd>{row.country}</dd>
                </>
              ) : null}
              {row.containerNumber ? (
                <>
                  <dt>מספר קונטיינר</dt>
                  <dd>{row.containerNumber}</dd>
                </>
              ) : null}
              {row.shipmentDetails ? (
                <>
                  <dt>פרטי משלוח</dt>
                  <dd>{row.shipmentDetails}</dd>
                </>
              ) : null}
              {row.city ? (
                <>
                  <dt>עיר</dt>
                  <dd>{row.city}</dd>
                </>
              ) : null}
              <dt>סטטוס</dt>
              <dd>{statusLabel(row.status)}</dd>
            </dl>
          </section>

          <section className="msh-detail-modal__section">
            <h3>חישוב התשלום</h3>
            <div className="msh-detail-modal__formula">
              <div className="msh-detail-modal__line">
                <span>סכום תשלום</span>
                <span>{fmtMoney(breakdown.paymentAmount)}</span>
              </div>
              <div className="msh-detail-modal__line msh-detail-modal__line--minus">
                <span>פחות רידומין</span>
                <span>-{fmtMoneyPlain(breakdown.ridominAmount)} ₪</span>
              </div>
              <div className="msh-detail-modal__line msh-detail-modal__line--plus">
                <span>מע״מ מקאסה 18%</span>
                <span>+{fmtMoneyPlain(breakdown.makasaVat)} ₪</span>
              </div>
              <div className="msh-detail-modal__divider" />
              <div className="msh-detail-modal__line msh-detail-modal__line--total">
                <span>סה״כ</span>
                <span>{fmtMoney(breakdown.payment)}</span>
              </div>
            </div>
          </section>
        </div>

        <footer className="msh-detail-modal__foot">
          {onEdit ? (
            <button type="button" className="shp-btn" onClick={() => onEdit(row)}>
              עריכת נתונים
            </button>
          ) : null}
          <button type="button" className="shp-btn shp-btn--primary" onClick={onClose}>
            סגור
          </button>
        </footer>
      </div>
    </div>
  );
}
