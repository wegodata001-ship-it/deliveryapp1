"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, FileText, MoreVertical, Pencil, XCircle } from "lucide-react";
import type { PaymentFeeSourceRow } from "@/lib/payment-fees-source-table";

type Props = {
  row: PaymentFeeSourceRow;
  onShowDetail: (row: PaymentFeeSourceRow) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenPayment: (paymentId: string) => void;
  onEdit?: (row: PaymentFeeSourceRow) => void;
  onCancel?: (row: PaymentFeeSourceRow) => void;
};

export function PaymentFeeRowActionsMenu({
  row,
  onShowDetail,
  onOpenOrder,
  onOpenPayment,
  onEdit,
  onCancel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="adm-ord-actions-menu" ref={rootRef}>
      <button
        type="button"
        className="adm-ord-actions-menu__trigger"
        aria-label="פעולות עמלה"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreVertical size={16} aria-hidden />
      </button>
      {open ? (
        <div className="adm-ord-actions-menu__panel" role="menu">
          <button type="button" role="menuitem" onClick={() => run(() => onShowDetail(row))}>
            <Eye size={14} aria-hidden />
            הצג פירוט
          </button>
          {row.orderId ? (
            <button type="button" role="menuitem" onClick={() => run(() => onOpenOrder(row.orderId!))}>
              <FileText size={14} aria-hidden />
              פתח הזמנה
            </button>
          ) : null}
          {row.paymentId ? (
            <button type="button" role="menuitem" onClick={() => run(() => onOpenPayment(row.paymentId!))}>
              <FileText size={14} aria-hidden />
              פתח תשלום
            </button>
          ) : null}
          {row.canEdit && onEdit ? (
            <button type="button" role="menuitem" onClick={() => run(() => onEdit(row))}>
              <Pencil size={14} aria-hidden />
              ערוך
            </button>
          ) : null}
          {row.canCancel && onCancel ? (
            <button type="button" role="menuitem" onClick={() => run(() => onCancel(row))}>
              <XCircle size={14} aria-hidden />
              {row.isAutomatic ? "ביטול (Reversal)" : "בטל"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
