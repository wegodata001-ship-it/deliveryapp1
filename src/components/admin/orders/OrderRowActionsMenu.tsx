"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, Eye, FileText, MoreVertical, Pencil } from "lucide-react";
import type { OrderListRow } from "@/components/admin/OrdersListShell";

export type OrderRowActionsMenuProps = {
  row: OrderListRow;
  canEditOrders: boolean;
  canReceivePayments: boolean;
  onView: (row: OrderListRow) => void;
  onEdit: (row: OrderListRow) => void;
  onPayment: (row: OrderListRow) => void;
  onExportPdf?: (row: OrderListRow) => void;
};

export function OrderRowActionsMenu({
  row,
  canEditOrders,
  canReceivePayments,
  onView,
  onEdit,
  onPayment,
  onExportPdf,
}: OrderRowActionsMenuProps) {
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
        aria-label="פעולות הזמנה"
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
          <button type="button" role="menuitem" onClick={() => run(() => onView(row))}>
            <Eye size={14} aria-hidden />
            צפייה
          </button>
          {canEditOrders ? (
            <button type="button" role="menuitem" onClick={() => run(() => onEdit(row))}>
              <Pencil size={14} aria-hidden />
              עריכה
            </button>
          ) : null}
          {canReceivePayments ? (
            <button type="button" role="menuitem" onClick={() => run(() => onPayment(row))}>
              <CreditCard size={14} aria-hidden />
              קליטת תשלום
            </button>
          ) : null}
          {onExportPdf ? (
            <button type="button" role="menuitem" onClick={() => run(() => onExportPdf(row))}>
              <FileText size={14} aria-hidden />
              PDF
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function paymentStatusLabel(status: OrderListRow["paymentStatus"]): string {
  if (status === "paid") return "שולם";
  if (status === "partial") return "חלקי";
  return "לא שולם";
}

export function OrderPaymentStatusBadge({ status }: { status: OrderListRow["paymentStatus"] }) {
  return (
    <span className={`adm-ord-pay-badge adm-ord-pay-badge--${status}`}>{paymentStatusLabel(status)}</span>
  );
}
