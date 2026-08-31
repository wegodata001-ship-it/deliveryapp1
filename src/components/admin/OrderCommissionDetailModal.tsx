"use client";

import { useCallback, useEffect, useState } from "react";
import { History, X } from "lucide-react";
import type { OrderCommissionDetailView } from "@/lib/order-commission-ssot";
import { formatUsdDisplay } from "@/lib/money-format";
import { formatCommissionSignedCompact } from "@/lib/commission-lineage-view";
import { CommissionLineageTable } from "@/components/admin/CommissionLineageTable";

type Props = {
  open: boolean;
  orderId: string | null;
  orderNumber?: string | null;
  preview?: {
    baseCommissionUsd: number;
    adjustmentsUsd: number;
    currentCommissionUsd: number;
  } | null;
  onClose: () => void;
  onOpenPayment?: (paymentId: string, paymentCode: string) => void;
  onOpenOrder?: (orderId: string, orderNumber: string) => void;
};

export function OrderCommissionDetailModal({
  open,
  orderId,
  orderNumber,
  preview,
  onClose,
  onOpenPayment,
  onOpenOrder,
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
        className="adm-mini-modal order-commission-detail-modal order-commission-detail-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-commission-detail-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="order-commission-detail-modal__head">
          <div>
            <h3 id="order-commission-detail-title">פירוט עמלות</h3>
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
            <dd dir="ltr">{formatCommissionSignedCompact(adjustments)}</dd>
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

        {!busy && !view?.hasAdjustments ? (
          <p className="payment-modal-hint">אין שינויים — העמלה הנוכחית זהה למקורית.</p>
        ) : null}

        {(view?.movements.length ?? 0) > 0 ? (
          <CommissionLineageTable
            rows={view!.movements}
            onOpenOrder={onOpenOrder}
            onOpenPayment={onOpenPayment}
          />
        ) : null}

        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
