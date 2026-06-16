"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ApprovalRequestStatus } from "@prisma/client";
import {
  approveInvoiceCancelRequestAction,
  type InvoiceCancelRequestRow,
  rejectInvoiceCancelRequestAction,
} from "@/app/admin/invoice-cancel-requests/actions";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

const STATUS_LABEL: Record<ApprovalRequestStatus, string> = {
  PENDING: "ממתין",
  APPROVED: "אושר",
  REJECTED: "נדחה",
};

function statusChipClass(s: ApprovalRequestStatus): string {
  switch (s) {
    case ApprovalRequestStatus.PENDING:
      return "adm-order-edit-req-status adm-order-edit-req-status--pending";
    case ApprovalRequestStatus.APPROVED:
      return "adm-order-edit-req-status adm-order-edit-req-status--approved";
    case ApprovalRequestStatus.REJECTED:
      return "adm-order-edit-req-status adm-order-edit-req-status--rejected";
    default:
      return "adm-order-edit-req-status";
  }
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

type Props = { initialRows: InvoiceCancelRequestRow[] };

export function InvoiceCancelRequestsClient({ initialRows }: Props) {
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
    const res = await runWithLoading(() => approveInvoiceCancelRequestAction(id), {
      message: "מאשר…",
      mode: "overlay",
    });
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
    const res = await runWithLoading(() => rejectInvoiceCancelRequestAction(id), {
      message: "דוחה…",
      mode: "overlay",
    });
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
        <h1 className="adm-page-title adm-page-title--sm">בקשות ביטול חשבונית</h1>
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
              <th>מספר חשבונית</th>
              <th>לקוח</th>
              <th>סכום ($)</th>
              <th>מבקש</th>
              <th>תאריך</th>
              <th>סיבת ביטול</th>
              <th>הערות</th>
              <th>סטטוס</th>
              <th aria-label="פעולות" />
            </tr>
          </thead>
          <tbody>
            {initialRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="adm-table-empty">
                  אין בקשות עדיין.
                </td>
              </tr>
            ) : (
              initialRows.map((r) => (
                <tr key={r.id} className="adm-table-excel-row">
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.paymentCode ?? "—"}
                  </td>
                  <td className="adm-table-excel-cust">{r.customerLabel ?? "—"}</td>
                  <td dir="ltr" className="adm-table-excel-num">
                    ${r.amountUsd}
                  </td>
                  <td>{r.requestedByName}</td>
                  <td dir="ltr" className="adm-table-excel-date">
                    {formatWhen(r.createdAtIso)}
                  </td>
                  <td className="adm-order-edit-reason-cell">{r.cancelReason}</td>
                  <td className="adm-order-edit-reason-cell">{r.notes ?? "—"}</td>
                  <td>
                    <span className={statusChipClass(r.status)}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="adm-order-edit-actions-cell" onClick={(e) => e.stopPropagation()}>
                    {r.status === ApprovalRequestStatus.PENDING ? (
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
                      "—"
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
