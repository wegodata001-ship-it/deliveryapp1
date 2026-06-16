"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OrderEditRequestStatus } from "@prisma/client";
import { ArrowDown, Eye, X } from "lucide-react";
import {
  approveOrderEditRequestAction,
  type OrderEditRequestRow,
  rejectOrderEditRequestAction,
} from "@/app/admin/order-edit-requests/actions";
import type { OrderEditDiffRow } from "@/lib/order-edit-snapshot";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

const STATUS_LABEL: Record<OrderEditRequestStatus, string> = {
  PENDING: "ממתין לאישור עדכון",
  APPROVED: "מאושר",
  REJECTED: "נדחה",
  USED: "נוצלה",
};

function statusChipClass(s: OrderEditRequestStatus): string {
  switch (s) {
    case OrderEditRequestStatus.PENDING:
      return "adm-order-edit-req-status adm-order-edit-req-status--pending";
    case OrderEditRequestStatus.APPROVED:
      return "adm-order-edit-req-status adm-order-edit-req-status--approved";
    case OrderEditRequestStatus.REJECTED:
      return "adm-order-edit-req-status adm-order-edit-req-status--rejected";
    case OrderEditRequestStatus.USED:
      return "adm-order-edit-req-status adm-order-edit-req-status--used";
    default:
      return "adm-order-edit-req-status";
  }
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function DiffModal({
  row,
  onClose,
}: {
  row: OrderEditRequestRow;
  onClose: () => void;
}) {
  return (
    <div
      className="adm-oc-edit-request-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="adm-order-update-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-update-diff-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="adm-order-update-diff-modal__head">
          <h4 id="order-update-diff-title">הבדלים — הזמנה {row.orderNumber ?? "—"}</h4>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose} aria-label="סגור">
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className="adm-order-update-diff-modal__reason">
          <strong>סיבת העדכון:</strong> {row.requestReason}
        </p>
        {row.diff.length === 0 ? (
          <p className="adm-table-empty">אין הבדלים לתצוגה (בקשה ישנה).</p>
        ) : (
          <div className="adm-table-excel-wrap">
            <table className="adm-table-excel adm-order-update-diff-table">
              <thead>
                <tr>
                  <th>שדה</th>
                  <th>ערך קודם</th>
                  <th aria-hidden />
                  <th>ערך חדש</th>
                </tr>
              </thead>
              <tbody>
                {row.diff.map((d: OrderEditDiffRow) => (
                  <tr key={d.key}>
                    <td>{d.label}</td>
                    <td className="adm-order-update-diff-old">{d.before}</td>
                    <td className="adm-order-update-diff-arrow" aria-hidden>
                      <ArrowDown size={14} />
                    </td>
                    <td className="adm-order-update-diff-new">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {row.status === OrderEditRequestStatus.APPROVED && row.approvedByName ? (
          <p className="adm-order-update-diff-modal__meta">
            אושר ע&quot;י {row.approvedByName} · {formatWhen(row.approvedAtIso)}
          </p>
        ) : null}
        {row.status === OrderEditRequestStatus.REJECTED && row.rejectedByName ? (
          <p className="adm-order-update-diff-modal__meta">
            נדחה ע&quot;י {row.rejectedByName} · {formatWhen(row.rejectedAtIso)}
            {row.rejectionReason ? ` — ${row.rejectionReason}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Props = { initialRows: OrderEditRequestRow[] };

export function OrderEditRequestsClient({ initialRows }: Props) {
  const router = useRouter();
  const { runWithLoading } = useAdminLoading();
  const [listErr, setListErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [diffRow, setDiffRow] = useState<OrderEditRequestRow | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const refresh = useCallback(() => {
    startTransition(() => {
      void router.refresh();
    });
  }, [router]);

  async function onApprove(id: string) {
    setListErr(null);
    setBusyId(id);
    const res = await runWithLoading(() => approveOrderEditRequestAction(id), { message: "מאשר ומיישם…", mode: "overlay" });
    setBusyId(null);
    if (!res.ok) {
      setListErr(res.error);
      return;
    }
    setDiffRow(null);
    refresh();
  }

  async function onRejectConfirm() {
    if (!rejectId) return;
    setListErr(null);
    setBusyId(rejectId);
    const res = await runWithLoading(
      () => rejectOrderEditRequestAction(rejectId, rejectReason),
      { message: "דוחה…", mode: "overlay" },
    );
    setBusyId(null);
    if (!res.ok) {
      setListErr(res.error);
      return;
    }
    setRejectId(null);
    setRejectReason("");
    setDiffRow(null);
    refresh();
  }

  const blocked = busyId !== null || isPending;

  return (
    <div className="adm-order-edit-requests">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">בקשות עדכון הזמנות</h1>
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
              <th>מבקש</th>
              <th>תאריך</th>
              <th>סיבת עדכון</th>
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
                    <span className={statusChipClass(r.status)}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="adm-order-edit-actions-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="adm-order-edit-actions">
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost adm-btn--dense"
                        disabled={blocked}
                        onClick={() => setDiffRow(r)}
                      >
                        <Eye size={14} aria-hidden />
                        הצג הבדלים
                      </button>
                      {r.status === OrderEditRequestStatus.PENDING ? (
                        <>
                          <button
                            type="button"
                            className="adm-btn adm-btn--primary adm-btn--dense"
                            disabled={blocked}
                            onClick={() => void onApprove(r.id)}
                          >
                            אשר
                          </button>
                          <button
                            type="button"
                            className="adm-btn adm-btn--ghost adm-btn--dense"
                            disabled={blocked}
                            onClick={() => {
                              setRejectId(r.id);
                              setRejectReason("");
                            }}
                          >
                            דחה
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {diffRow ? <DiffModal row={diffRow} onClose={() => setDiffRow(null)} /> : null}

      {rejectId ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => {
            if (!blocked) setRejectId(null);
          }}
        >
          <div
            className="adm-oc-edit-request-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>דחיית בקשת עדכון</h4>
            <label className="adm-field">
              סיבת דחייה (אופציונלי)
              <textarea
                value={rejectReason}
                disabled={blocked}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="למשל: נדרש אישור מנהל כספים…"
              />
            </label>
            <div className="adm-oc-edit-request-modal-actions">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--dense"
                disabled={blocked}
                onClick={() => setRejectId(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                disabled={blocked}
                onClick={() => void onRejectConfirm()}
              >
                דחה בקשה
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
