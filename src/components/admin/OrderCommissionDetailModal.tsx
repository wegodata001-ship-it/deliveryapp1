"use client";

import { useCallback, useEffect, useState } from "react";
import { History, X } from "lucide-react";
import type { OrderCommissionDetailView } from "@/lib/order-commission-ssot";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";
import { formatUsdDisplay } from "@/lib/money-format";

function fmtSigned(n: number): string {
  return formatSignedUsdDisplay(n);
}

type Props = {
  open: boolean;
  orderId: string | null;
  orderNumber?: string | null;
  /** תצוגה מיידית מטבלת הקליטה לפני טעינת השרת */
  preview?: {
    baseCommissionUsd: number;
    adjustmentsUsd: number;
    currentCommissionUsd: number;
  } | null;
  onClose: () => void;
};

export function OrderCommissionDetailModal({
  open,
  orderId,
  orderNumber,
  preview,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderCommissionDetailView | null>(null);

  const load = useCallback(async () => {
    const id = orderId?.trim();
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/payment-intake/order-commission?orderId=${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      const data = (await res.json()) as
        | { ok: true; detail: OrderCommissionDetailView }
        | { ok: false; error: string };
      if (!data.ok) {
        setErr(data.error);
        setDetail(null);
        return;
      }
      setDetail(data.detail);
    } catch {
      setErr("טעינת פירוט עמלה נכשלה");
      setDetail(null);
    } finally {
      setBusy(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!open || !orderId?.trim()) return;
    void load();
  }, [open, orderId, load]);

  if (!open) return null;

  const view = detail;
  const base = view?.baseCommissionUsd ?? preview?.baseCommissionUsd ?? 0;
  const adjustments = view?.adjustmentsUsd ?? preview?.adjustmentsUsd ?? 0;
  const current = view?.currentCommissionUsd ?? preview?.currentCommissionUsd ?? base;
  const titleNumber = view?.orderNumber ?? orderNumber ?? "—";

  return (
    <div className="adm-mini-modal-layer adm-mini-modal-layer--payment-overage" role="presentation" onClick={onClose}>
      <div
        className="adm-mini-modal order-commission-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-commission-detail-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="order-commission-detail-modal__head">
          <div>
            <h3 id="order-commission-detail-title">פירוט עמלה</h3>
            <p dir="ltr">{titleNumber}</p>
          </div>
          <button type="button" className="payment-method-adjust-modal__close" aria-label="סגור" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {busy ? <p className="payment-modal-hint">טוען…</p> : null}
        {err ? <p className="payment-modal-err">{err}</p> : null}

        <dl className="order-commission-detail-modal__stats">
          <div>
            <dt>עמלה מקורית</dt>
            <dd dir="ltr">{formatUsdDisplay(base)}</dd>
          </div>
          <div>
            <dt>שינויים</dt>
            <dd dir="ltr">{fmtSigned(adjustments)}</dd>
          </div>
          <div className="order-commission-detail-modal__stats--current">
            <dt>עמלה נוכחית</dt>
            <dd dir="ltr">{formatUsdDisplay(current)}</dd>
          </div>
        </dl>

        <h4 className="order-commission-detail-modal__section-title">
          <History size={14} aria-hidden />
          תנועות עמלה
        </h4>

        {!busy && !(view?.hasAdjustments) ? (
          <p className="payment-modal-hint">אין שינויים — העמלה הנוכחית זהה למקורית.</p>
        ) : null}

        {(view?.movements.length ?? 0) > 0 ? (
          <ul className="order-commission-detail-modal__movements">
            {view!.movements.map((m) => (
              <li key={m.id}>
                <div className="order-commission-detail-modal__move-main">
                  <strong>{m.label}</strong>
                  <span
                    dir="ltr"
                    className={
                      m.amountUsd >= 0
                        ? "commission-movement--credit"
                        : "commission-movement--debit"
                    }
                  >
                    {fmtSigned(m.amountUsd)}
                  </span>
                </div>
                <div className="order-commission-detail-modal__move-meta">
                  <span dir="ltr">{m.dateYmd.replace(/-/g, "/")}</span>
                  {m.sourceDocument ? <span dir="ltr">{m.sourceDocument}</span> : null}
                  {m.createdByName ? <span>{m.createdByName}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="order-commission-detail-modal__footer-sum">
          <div>
            <span>עמלה מקורית</span>
            <strong dir="ltr">{formatUsdDisplay(base)}</strong>
          </div>
          <div>
            <span>שינויים</span>
            <strong dir="ltr">{fmtSigned(adjustments)}</strong>
          </div>
          <div className="order-commission-detail-modal__footer-sum--total">
            <span>עמלה נוכחית</span>
            <strong dir="ltr">{formatUsdDisplay(current)}</strong>
          </div>
        </div>

        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
