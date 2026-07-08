"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import type { MyOrderEditRequestRow } from "@/app/admin/order-edit-requests/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  MY_REQUEST_STATUS_LABEL,
  myRequestStatusChipClass,
} from "@/lib/order-edit-request-labels";

function fmtDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  } catch {
    return "—";
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function approverLabel(row: MyOrderEditRequestRow): string {
  if (row.status === "APPROVED" || row.status === "USED") return row.approvedByName ?? "—";
  if (row.status === "REJECTED") return row.rejectedByName ?? "—";
  return "—";
}

function RequestDetailPanel({
  row,
  onClose,
}: {
  row: MyOrderEditRequestRow;
  onClose: () => void;
}) {
  const { openWindow } = useAdminWindows();

  return (
    <div className="adm-my-req-detail-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-my-req-detail-modal"
        role="dialog"
        aria-modal="true"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="adm-my-req-detail-head">
          <h4>
            {row.requestTypeLabel} — {row.orderNumber ?? "—"}
          </h4>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </div>

        <div className="adm-my-req-detail-body">
          <p className="adm-my-req-detail-reason">
            <strong>מה ביקשת:</strong>
          </p>
          {row.diff.length === 0 ? (
            <p className="adm-muted-keys">אין פירוט שינויים (בקשה ישנה)</p>
          ) : (
            <table className="adm-my-req-diff-tbl">
              <thead>
                <tr>
                  <th>שדה</th>
                  <th>לפני</th>
                  <th>אחרי</th>
                </tr>
              </thead>
              <tbody>
                {row.diff.map((d) => (
                  <tr key={d.key}>
                    <td>{d.label}</td>
                    <td>{d.before}</td>
                    <td>{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="adm-my-req-detail-reason">
            <strong>סיבה:</strong> {row.requestReason}
          </p>

          <div className="adm-my-req-detail-meta">
            <div>
              <span>סטטוס</span>
              <strong className={myRequestStatusChipClass(row.status)}>
                {MY_REQUEST_STATUS_LABEL[row.status]}
              </strong>
            </div>
            {row.status === "APPROVED" || row.status === "USED" ? (
              <>
                <div>
                  <span>אושר ע״י</span>
                  <strong>{row.approvedByName ?? "—"}</strong>
                </div>
                <div>
                  <span>מתי</span>
                  <strong dir="ltr">{fmtWhen(row.approvedAtIso)}</strong>
                </div>
              </>
            ) : null}
            {row.status === "REJECTED" ? (
              <>
                <div>
                  <span>נדחה ע״י</span>
                  <strong>{row.rejectedByName ?? "—"}</strong>
                </div>
                <div>
                  <span>מתי</span>
                  <strong dir="ltr">{fmtWhen(row.rejectedAtIso)}</strong>
                </div>
                {row.rejectionReason ? (
                  <div className="adm-my-req-detail-meta--wide">
                    <span>הערת מנהל</span>
                    <strong>{row.rejectionReason}</strong>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="adm-my-req-detail-foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>
            סגור
          </button>
          {row.status === "APPROVED" || row.status === "USED" ? (
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              onClick={() => {
                onClose();
                openWindow({
                  type: "orderCapture",
                  props: { mode: "edit", orderId: row.orderId, orderNumber: row.orderNumber },
                });
              }}
            >
              פתח הזמנה
            </button>
          ) : null}
          {row.relatedPaymentId ? (
            <button
              type="button"
              className="adm-btn adm-btn--ghost"
              onClick={() => {
                onClose();
                openWindow({
                  type: "paymentsUpdated",
                  props: { paymentId: row.relatedPaymentId!, orderId: row.orderId, orderNumber: row.orderNumber },
                });
              }}
            >
              <ExternalLink size={14} aria-hidden /> פתח קליטת תשלום
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function MyRequestsClient({ initialRows }: { initialRows: MyOrderEditRequestRow[] }) {
  const [rows] = useState(initialRows);
  const [detailRow, setDetailRow] = useState<MyOrderEditRequestRow | null>(null);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso)),
    [rows],
  );

  return (
    <div className="adm-my-requests" dir="rtl">
      <div className="adm-page-head">
        <h1 className="adm-page-title">הבקשות שלי</h1>
        <p className="adm-page-sub">
          כל בקשות העריכה ששלחת למנהל — סטטוס, אישור או דחייה, וקישורים להזמנה ולקליטת תשלום.
        </p>
      </div>

      <div className="adm-table-wrap adm-my-req-table-wrap">
        <table className="adm-table adm-my-req-table">
          <thead>
            <tr>
              <th aria-hidden />
              <th>תאריך</th>
              <th>סוג בקשה</th>
              <th>מספר הזמנה</th>
              <th>סטטוס</th>
              <th>אושר / נדחה ע״י</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="adm-table-empty">
                  עדיין לא שלחת בקשות עריכה.
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                  <tr
                    key={row.id}
                    className="adm-my-req-row"
                    onClick={() => setDetailRow(row)}
                  >
                    <td className="adm-my-req-expand">
                      <ChevronDown size={16} aria-hidden />
                    </td>
                    <td dir="ltr">{fmtDateShort(row.createdAtIso)}</td>
                    <td>{row.requestTypeLabel}</td>
                    <td dir="ltr">{row.orderNumber ?? "—"}</td>
                    <td>
                      <span className={myRequestStatusChipClass(row.status)}>
                        {MY_REQUEST_STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td>{approverLabel(row)}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      {detailRow ? <RequestDetailPanel row={detailRow} onClose={() => setDetailRow(null)} /> : null}
    </div>
  );
}
