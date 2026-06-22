"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Eye, X } from "lucide-react";
import {
  approveOrderEditRequestAction,
  type OrderEditRequestRow,
  rejectOrderEditRequestAction,
} from "@/app/admin/order-edit-requests/actions";
import {
  approveInvoiceCancelRequestAction,
  type InvoiceCancelRequestRow,
  rejectInvoiceCancelRequestAction,
} from "@/app/admin/invoice-cancel-requests/actions";
import type { OrderEditDiffRow } from "@/lib/order-edit-snapshot";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

type RequestKind = "ORDER_EDIT" | "INVOICE_CANCEL";

type UnifiedStatus = "PENDING" | "APPROVED" | "REJECTED" | "USED";

type UnifiedRow = {
  id: string;
  kind: RequestKind;
  typeLabel: string;
  createdAtIso: string;
  documentNumber: string | null;
  requestedByName: string;
  prevValue: string;
  newValue: string;
  status: UnifiedStatus;
  isPending: boolean;
  orderEdit?: OrderEditRequestRow;
};

const TYPE_LABEL: Record<RequestKind, string> = {
  ORDER_EDIT: "עריכת הזמנה",
  INVOICE_CANCEL: "ביטול חשבונית",
};

const STATUS_LABEL: Record<UnifiedStatus, string> = {
  PENDING: "ממתין לאישור",
  APPROVED: "מאושר",
  REJECTED: "נדחה",
  USED: "נוצלה",
};

function statusChipClass(s: UnifiedStatus): string {
  switch (s) {
    case "PENDING":
      return "adm-order-edit-req-status adm-order-edit-req-status--pending";
    case "APPROVED":
      return "adm-order-edit-req-status adm-order-edit-req-status--approved";
    case "REJECTED":
      return "adm-order-edit-req-status adm-order-edit-req-status--rejected";
    case "USED":
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

function diffSummary(diff: OrderEditDiffRow[], side: "before" | "after"): string {
  if (!diff.length) return "—";
  return diff.map((d) => `${d.label}: ${side === "before" ? d.before : d.after}`).join(" · ");
}

function DiffModal({ row, onClose }: { row: OrderEditRequestRow; onClose: () => void }) {
  return (
    <div className="adm-oc-edit-request-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-order-update-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unified-diff-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="adm-order-update-diff-modal__head">
          <h4 id="unified-diff-title">הבדלים — הזמנה {row.orderNumber ?? "—"}</h4>
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
                {row.diff.map((d) => (
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
        {row.status === "APPROVED" && row.approvedByName ? (
          <p className="adm-order-update-diff-modal__meta">
            אושר ע&quot;י {row.approvedByName} · {formatWhen(row.approvedAtIso)}
          </p>
        ) : null}
        {row.status === "REJECTED" && row.rejectedByName ? (
          <p className="adm-order-update-diff-modal__meta">
            נדחה ע&quot;י {row.rejectedByName} · {formatWhen(row.rejectedAtIso)}
            {row.rejectionReason ? ` — ${row.rejectionReason}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Props = {
  orderEditRows: OrderEditRequestRow[];
  invoiceCancelRows: InvoiceCancelRequestRow[];
};

export function UnifiedEditRequestsClient({ orderEditRows, invoiceCancelRows }: Props) {
  const router = useRouter();
  const { runWithLoading } = useAdminLoading();
  const [listErr, setListErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [diffRow, setDiffRow] = useState<OrderEditRequestRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: RequestKind } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | RequestKind>("ALL");

  const rows = useMemo<UnifiedRow[]>(() => {
    const orderRows: UnifiedRow[] = orderEditRows.map((r) => ({
      id: r.id,
      kind: "ORDER_EDIT",
      typeLabel: TYPE_LABEL.ORDER_EDIT,
      createdAtIso: r.createdAtIso,
      documentNumber: r.orderNumber,
      requestedByName: r.requestedByName,
      prevValue: diffSummary(r.diff, "before"),
      newValue: diffSummary(r.diff, "after"),
      status: r.status,
      isPending: r.status === "PENDING",
      orderEdit: r,
    }));
    const invoiceRows: UnifiedRow[] = invoiceCancelRows.map((r) => ({
      id: r.id,
      kind: "INVOICE_CANCEL",
      typeLabel: TYPE_LABEL.INVOICE_CANCEL,
      createdAtIso: r.createdAtIso,
      documentNumber: r.paymentCode,
      requestedByName: r.requestedByName,
      prevValue: `חשבונית פעילה · $${r.amountUsd}`,
      newValue: r.cancelReason ? `ביטול — ${r.cancelReason}` : "ביטול חשבונית",
      status: r.status,
      isPending: r.status === "PENDING",
    }));
    const all = [...orderRows, ...invoiceRows];
    all.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    return all;
  }, [orderEditRows, invoiceCancelRows]);

  const visibleRows = useMemo(
    () => (typeFilter === "ALL" ? rows : rows.filter((r) => r.kind === typeFilter)),
    [rows, typeFilter],
  );

  const refresh = useCallback(() => {
    startTransition(() => {
      void router.refresh();
    });
  }, [router]);

  const blocked = busyId !== null || isPending;

  async function onApprove(row: UnifiedRow) {
    setListErr(null);
    setBusyId(row.id);
    const res = await runWithLoading(
      () =>
        row.kind === "ORDER_EDIT"
          ? approveOrderEditRequestAction(row.id)
          : approveInvoiceCancelRequestAction(row.id),
      { message: "מאשר…", mode: "overlay" },
    );
    setBusyId(null);
    if (!res.ok) {
      setListErr(res.error);
      return;
    }
    setDiffRow(null);
    refresh();
  }

  async function onRejectConfirm() {
    if (!rejectTarget) return;
    setListErr(null);
    setBusyId(rejectTarget.id);
    const res = await runWithLoading(
      () =>
        rejectTarget.kind === "ORDER_EDIT"
          ? rejectOrderEditRequestAction(rejectTarget.id, rejectReason)
          : rejectInvoiceCancelRequestAction(rejectTarget.id),
      { message: "דוחה…", mode: "overlay" },
    );
    setBusyId(null);
    if (!res.ok) {
      setListErr(res.error);
      return;
    }
    setRejectTarget(null);
    setRejectReason("");
    setDiffRow(null);
    refresh();
  }

  return (
    <div className="adm-order-edit-requests">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">בקשות עריכה</h1>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">סוג בקשה</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "ALL" | RequestKind)}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="ALL">הכל</option>
            <option value="ORDER_EDIT">עריכת הזמנה</option>
            <option value="INVOICE_CANCEL">ביטול חשבונית</option>
          </select>
        </label>
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
              <th>תאריך</th>
              <th>סוג בקשה</th>
              <th>מספר מסמך</th>
              <th>מבקש</th>
              <th>ערך קודם</th>
              <th>ערך חדש</th>
              <th>סטטוס</th>
              <th aria-label="פעולות" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="adm-table-empty">
                  אין בקשות עדיין.
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => (
                <tr key={`${r.kind}:${r.id}`} className="adm-table-excel-row">
                  <td dir="ltr" className="adm-table-excel-date">
                    {formatWhen(r.createdAtIso)}
                  </td>
                  <td>{r.typeLabel}</td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.documentNumber ?? "—"}
                  </td>
                  <td>{r.requestedByName}</td>
                  <td className="adm-order-edit-reason-cell adm-order-update-diff-old">{r.prevValue}</td>
                  <td className="adm-order-edit-reason-cell adm-order-update-diff-new">{r.newValue}</td>
                  <td>
                    <span className={statusChipClass(r.status)}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="adm-order-edit-actions-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="adm-order-edit-actions">
                      {r.kind === "ORDER_EDIT" && r.orderEdit ? (
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--dense"
                          disabled={blocked}
                          onClick={() => setDiffRow(r.orderEdit!)}
                        >
                          <Eye size={14} aria-hidden />
                          הצג הבדלים
                        </button>
                      ) : null}
                      {r.isPending ? (
                        <>
                          <button
                            type="button"
                            className="adm-btn adm-btn--primary adm-btn--dense"
                            disabled={blocked}
                            onClick={() => void onApprove(r)}
                          >
                            אשר
                          </button>
                          <button
                            type="button"
                            className="adm-btn adm-btn--ghost adm-btn--dense"
                            disabled={blocked}
                            onClick={() => {
                              setRejectTarget({ id: r.id, kind: r.kind });
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

      {rejectTarget ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => {
            if (!blocked) setRejectTarget(null);
          }}
        >
          <div
            className="adm-oc-edit-request-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>דחיית בקשה</h4>
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
                onClick={() => setRejectTarget(null)}
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
