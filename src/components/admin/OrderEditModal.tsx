"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { OrderCreatePanel } from "@/components/admin/OrderCreatePanel";
import type { SerializedFinancial } from "@/lib/financial-settings";

type Props = {
  orderId: string | null;
  financial: SerializedFinancial | null;
  onToast: (msg: string) => void;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  onClose: () => void;
  /** רק אחרי עדכון מוצלח מהטופס */
  onSaved?: () => void;
};

/**
 * עריכת הזמנה מעל המסך הנוכחי — אותו טופס כמו „עריכת הזמנה” בחלון הקליטה הגלובלי.
 */
export function OrderEditModal({
  orderId,
  financial,
  onToast,
  canCreateOrders,
  canEditOrders,
  onClose,
  onSaved,
}: Props) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const windowId = useMemo(() => `pm-order-edit-${orderId ?? "x"}`, [orderId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!orderId || !mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [orderId, mounted]);

  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [orderId, onClose]);

  if (!orderId || !mounted || typeof document === "undefined") return null;

  const panel = (
    <div
      className="adm-win-layer adm-win-layer--top order-edit-modal-root"
      style={{ zIndex: 12000 }}
      role="presentation"
    >
      <button type="button" className="adm-win-layer-backdrop" aria-label="סגירה" onClick={onClose} />
      <div
        className="adm-win-panel adm-win-panel--order-capture order-edit-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir="rtl"
      >
        <div className="adm-win-header">
          <h2 id={titleId} className="adm-win-title">
            עריכת הזמנה
          </h2>
          <button type="button" className="ui-close" onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
        <div className="adm-win-body adm-win-body--order-capture">
          <OrderCreatePanel
            key={orderId}
            windowId={windowId}
            financial={financial}
            onToast={onToast}
            canCreateOrders={canCreateOrders}
            canEditOrders={canEditOrders}
            target={{ mode: "edit", orderId }}
            onClose={onClose}
            onSaved={onSaved}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
