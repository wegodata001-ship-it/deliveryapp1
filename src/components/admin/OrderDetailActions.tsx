"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderEditEntryHint } from "@/app/admin/order-edit-requests/actions";
import { OrderEditLockGateModal } from "@/components/admin/OrderEditLockGateModal";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

type Props = {
  orderId: string;
  canEdit: boolean;
  /** נקבע בשרת — האם לפתוח ישר עריכה או מודל נעילה */
  editEntryHint: OrderEditEntryHint;
};

export function OrderDetailActions({ orderId, canEdit, editEntryHint }: Props) {
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  const [hint, setHint] = useState(editEntryHint);
  const [lockOpen, setLockOpen] = useState<OrderEditEntryHint | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setHint(editEntryHint);
  }, [editEntryHint]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  const openEdit = useCallback(() => {
    if (hint.kind === "prelock") {
      setLockOpen(hint);
      return;
    }
    openWindow({ type: "orderCapture", props: { mode: "edit", orderId } });
  }, [hint, openWindow, orderId]);

  if (!canEdit) {
    return (
      <div className="adm-order-detail-actions">
        <Link href="/admin/orders" className="adm-btn adm-btn--ghost adm-btn--dense">
          חזרה להזמנות
        </Link>
      </div>
    );
  }

  return (
    <div className="adm-order-detail-actions">
      <Link href="/admin/orders" className="adm-btn adm-btn--ghost adm-btn--dense">
        חזרה להזמנות
      </Link>
      <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={openEdit}>
        עריכת הזמנה
      </button>
      {lockOpen?.kind === "prelock" ? (
        <OrderEditLockGateModal
          open
          payload={lockOpen}
          onClose={() => setLockOpen(null)}
          onToast={showToast}
          onAfterRequestSent={() => {
            setLockOpen(null);
            router.refresh();
          }}
        />
      ) : null}
      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
