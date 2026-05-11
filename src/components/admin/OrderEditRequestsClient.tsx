"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OrderEditRequestStatus } from "@prisma/client";
import {
  approveOrderEditRequestAction,
  type OrderEditRequestRow,
  rejectOrderEditRequestAction,
} from "@/app/admin/order-edit-requests/actions";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

const STATUS_LABEL: Record<OrderEditRequestStatus, string> = {
  PENDING: "ממתין",
  APPROVED: "אושר",
  REJECTED: "נדחה",
};

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

type Props = { initialRows: OrderEditRequestRow[] };

export function OrderEditRequestsClient({ initialRows }: Props) {
  const router = useRouter();
  const { runWithLoading } = useAdminLoading();
  const [listErr, setListErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => {
      void router.refresh();
    });
  }, [router]);

  async function onApprove(id: string) {
    setListErr(null);
    setBusyId(id);
    const res = await runWithLoading(() => approveOrderEditRequestAction(id), { message: "מאשר…", mode: "overlay" });
    setBusyId(null);
    if (!res.ok) {
      setListErr(res.error);
      return;
    }
    refresh();
  }

  async function onReject(id: string) {
    setListErr(null);
    setBusyId(id);
    const res = await runWithLoading(() => rejectOrderEditRequestAction(id), { message: "דוחה…", mode: "overlay" });
    setBusyId(null);
    if (!res.ok) {
      setListErr(res.error);
      return;
    }
    refresh();
  }

  const blocked = busyId !== null || isPending;

  return (
    <div className="adm-order-edit-requests">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">בקשות עריכת הזמנות</h1>
      </div>

      {listErr ? (
        <p className="adm-orders-inline-err" role="alert">
          {listErr}
        </p>
      ) : null}

      <div className="adm-table-excel-wrap" dir="rtl">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>מספר הזמנה</th>
              <th>לקוח</th>
              <th>מי ביקש</th>
              <th>תאריך</th>
              <th>סיבת בקשה</th>
              <th>סטטוס</th>
              <th aria-label="פעולות" />
            </tr>
          </thead>
          <tbody>
            {initialRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="adm-table-empty">
                  אין בקשות עדיין.
                </td>
              </tr>
            ) : (
              initialRows.map((r) => (
                <tr key={r.id} className="adm-table-excel-row">
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.orderNumber ?? "—"}
                  </td>
                  <td className="adm-table-excel-cust">{r.customerLabel ?? "—"}</td>
                  <td>{r.requestedByName}</td>
                  <td dir="ltr" className="adm-table-excel-date">
                    {formatWhen(r.createdAtIso)}
                  </td>
                  <td className="adm-order-edit-reason-cell">{r.requestReason}</td>
                  <td>
                    <span
                      className={
                        r.status === OrderEditRequestStatus.PENDING
                          ? "adm-order-edit-req-status adm-order-edit-req-status--pending"
                          : r.status === OrderEditRequestStatus.APPROVED
                            ? "adm-order-edit-req-status adm-order-edit-req-status--approved"
                            : "adm-order-edit-req-status adm-order-edit-req-status--rejected"
                      }
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="adm-order-edit-actions-cell" onClick={(e) => e.stopPropagation()}>
                    {r.status === OrderEditRequestStatus.PENDING ? (
                      <div className="adm-order-edit-actions">
                        <button
                          type="button"
                          className="adm-btn adm-btn--primary adm-btn--dense"
                          disabled={blocked}
                          onClick={() => void onApprove(r.id)}
                        >
                          אישור
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--dense"
                          disabled={blocked}
                          onClick={() => void onReject(r.id)}
                        >
                          דחייה
                        </button>
                      </div>
                    ) : (
                      <span className="adm-table-empty">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
