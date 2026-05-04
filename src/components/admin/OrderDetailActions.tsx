"use client";

import Link from "next/link";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

type Props = {
  orderId: string;
  canEdit: boolean;
};

export function OrderDetailActions({ orderId, canEdit }: Props) {
  const { openWindow } = useAdminWindows();

  return (
    <div className="adm-order-detail-actions">
      <Link href="/admin/orders" className="adm-btn adm-btn--ghost adm-btn--dense">
        חזרה להזמנות
      </Link>
      {canEdit ? (
        <button
          type="button"
          className="adm-btn adm-btn--primary adm-btn--dense"
          onClick={() => openWindow({ type: "orderCapture", props: { mode: "edit", orderId } })}
        >
          עריכת הזמנה
        </button>
      ) : null}
    </div>
  );
}
