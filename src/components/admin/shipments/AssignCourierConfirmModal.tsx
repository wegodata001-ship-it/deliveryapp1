"use client";

import { AlertTriangle, Truck, X } from "lucide-react";

export type AssignCourierConfirmModalProps = {
  open: boolean;
  courierName: string;
  shipmentCount: number;
  /** כמה מהמשלוחים הנבחרים כבר משויכים לשליח */
  withExistingCourierCount?: number;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function shipmentCountLabel(count: number): string {
  return count === 1 ? "משלוח אחד" : `${count} המשלוחים`;
}

export function AssignCourierConfirmModal({
  open,
  courierName,
  shipmentCount,
  withExistingCourierCount = 0,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: AssignCourierConfirmModalProps) {
  if (!open) return null;

  const locked = busy;
  const showReplaceWarning = withExistingCourierCount > 0;
  const countLabel = shipmentCountLabel(shipmentCount);
  const confirmLabel =
    shipmentCount === 1
      ? "אישור ושיוך משלוח אחד"
      : `אישור ושיוך ${shipmentCount} משלוחים`;

  return (
    <div
      className="shp-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onCancel();
      }}
    >
      <div
        className="shp-modal shp-confirm-modal shp-confirm-modal--assign-courier"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-courier-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shp-confirm-modal__head">
          <div className="shp-confirm-modal__icon-wrap" aria-hidden>
            <Truck size={22} />
          </div>
          <h2 id="assign-courier-title" className="shp-confirm-modal__title">
            שיוך שליח למשלוחים
          </h2>
          <button
            type="button"
            className="shp-modal__header-close"
            onClick={onCancel}
            disabled={locked}
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div className="shp-confirm-modal__body">
          <p className="shp-confirm-modal__message">
            האם לשייך את השליח <strong>&quot;{courierName}&quot;</strong> ל־
            <strong>{countLabel}</strong> שנבחרו?
          </p>

          <div className="shp-confirm-modal__info-box">
            <div className="shp-confirm-modal__info-row">
              <span className="shp-confirm-modal__info-label">שליח נבחר:</span>
              <span className="shp-confirm-modal__info-value">{courierName}</span>
            </div>
            <div className="shp-confirm-modal__info-row">
              <span className="shp-confirm-modal__info-label">משלוחים שנבחרו:</span>
              <span className="shp-confirm-modal__info-value">{shipmentCount}</span>
            </div>
          </div>

          {showReplaceWarning ? (
            <div className="shp-confirm-modal__warn" role="note">
              <AlertTriangle size={16} aria-hidden />
              <span>
                שים לב: לחלק מהמשלוחים כבר משויך שליח. אישור הפעולה יחליף את השליח הקיים.
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="shp-confirm-modal__error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="shp-confirm-modal__foot">
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            onClick={onCancel}
            disabled={locked}
          >
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            onClick={onConfirm}
            disabled={locked}
          >
            {busy ? "משייך משלוחים…" : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function countSelectedWithExistingCourier(
  records: Array<{ id: string; courierId: string | null }>,
  selectedIds: Iterable<string>,
): number {
  const ids = new Set(selectedIds);
  let count = 0;
  for (const r of records) {
    if (ids.has(r.id) && r.courierId) count += 1;
  }
  return count;
}
