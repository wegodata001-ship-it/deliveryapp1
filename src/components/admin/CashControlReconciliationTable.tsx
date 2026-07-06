"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Scale, X } from "lucide-react";
import {
  listCashReconciliationDetailAction,
  setPaymentCashAuditReviewAction,
  type CashReconciliationDetailRow,
} from "@/app/admin/cash-control/actions";
import { CashControlDeviationsHierarchy } from "@/components/admin/CashControlDeviationsHierarchy";
import type { CashControlDeviationRow } from "@/app/admin/cash-control/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  fmtReconciliationAmount,
  fmtReconciliationDiff,
  loadCountedFromStorage,
  reconciliationDiff,
  reconciliationStatus,
  RECON_STATUS_LABELS,
  saveCountedToStorage,
  CASH_RECONCILIATION_LINES,
  type CashReconciliationCurrency,
  type CashReconciliationLineId,
  type CashReconciliationSummaryPayload,
} from "@/lib/cash-control-reconciliation";

function parseCountedInput(raw: string): number {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function fmtDateYmd(ymd: string): string {
  if (!ymd || ymd === "—") return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}`;
}

function parseAmount(s: string): number {
  const n = Number(s.replace(/,/g, "") || 0);
  return Number.isFinite(n) ? n : 0;
}

export function CashControlReconciliationTable({
  week,
  summary,
  cashDeviations,
  isAdmin,
  onOpenIntake,
}: {
  week: string;
  summary: CashReconciliationSummaryPayload | null | undefined;
  cashDeviations: CashControlDeviationRow[];
  isAdmin: boolean;
  onOpenIntake: (customerId: string | null, orderId: string | null) => void;
}) {
  const { openWindow } = useAdminWindows();
  const [counted, setCounted] = useState<Partial<Record<CashReconciliationLineId, string>>>({});
  const [drillLine, setDrillLine] = useState<{
    lineId: CashReconciliationLineId;
    label: string;
    currency: CashReconciliationCurrency;
    recorded: number;
  } | null>(null);
  const [drillRows, setDrillRows] = useState<CashReconciliationDetailRow[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [onlyUnchecked, setOnlyUnchecked] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  useEffect(() => {
    setCounted(loadCountedFromStorage(week));
  }, [week]);

  useEffect(() => {
    setDrillLine(null);
    setDrillRows(null);
    setOnlyUnchecked(false);
  }, [week]);

  const persistCounted = useCallback(
    (next: Partial<Record<CashReconciliationLineId, string>>) => {
      setCounted(next);
      saveCountedToStorage(week, next);
    },
    [week],
  );

  const rows =
    summary?.rows ??
    CASH_RECONCILIATION_LINES.map((line) => ({
      lineId: line.id,
      label: line.label,
      icon: line.icon,
      currency: line.currency,
      recorded: 0,
      paymentCount: 0,
    }));

  const closeDrill = useCallback(() => {
    setDrillLine(null);
    setDrillRows(null);
    setOnlyUnchecked(false);
  }, []);

  const openDrill = useCallback(
    async (
      lineId: CashReconciliationLineId,
      label: string,
      currency: CashReconciliationCurrency,
      recorded: number,
    ) => {
      if (drillLine?.lineId === lineId) {
        closeDrill();
        return;
      }
      setDrillLine({ lineId, label, currency, recorded });
      setDrillRows(null);
      setOnlyUnchecked(false);
      setDrillLoading(true);
      try {
        const detail = await listCashReconciliationDetailAction(week, lineId);
        setDrillRows(detail);
      } finally {
        setDrillLoading(false);
      }
    },
    [week, drillLine, closeDrill],
  );

  const toggleReviewed = useCallback(
    async (paymentId: string, reviewed: boolean) => {
      setReviewBusy(paymentId);
      setDrillRows((prev) =>
        prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed } : r)) ?? prev,
      );
      try {
        const res = await setPaymentCashAuditReviewAction({ paymentId, week, reviewed });
        if (!res.ok) {
          setDrillRows((prev) =>
            prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed: !reviewed } : r)) ?? prev,
          );
        }
      } finally {
        setReviewBusy(null);
      }
    },
    [week],
  );

  const openPaymentIntake = useCallback(
    (row: CashReconciliationDetailRow) => {
      openWindow({ type: "paymentsUpdated", props: { paymentId: row.paymentId } });
    },
    [openWindow],
  );

  return (
    <section className="adm-cash-recon">
      <h2 className="adm-cash-recon__title">
        <Scale size={18} aria-hidden /> התאמת קופה — שבוע {week}
      </h2>

      <div className="adm-cash-recon__scroll">
        <table className="adm-table-excel adm-cash-recon__tbl">
          <thead>
            <tr>
              <th>אמצעי תשלום</th>
              <th>נקלט במערכת</th>
              <th>נספר בפועל</th>
              <th>הפרש</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const countedVal = parseCountedInput(counted[r.lineId] ?? "");
              const diff = reconciliationDiff(countedVal, r.recorded);
              const status = reconciliationStatus(diff);
              const statusMeta = RECON_STATUS_LABELS[status];
              const isExpanded = drillLine?.lineId === r.lineId;

              return (
                <tr
                  key={r.lineId}
                  className={`adm-cash-recon__row is-${status}${isExpanded ? " is-expanded" : ""}`}
                >
                  <td className="adm-cash-recon__method">
                    <span className="adm-cash-recon__icon" aria-hidden>
                      {r.icon}
                    </span>
                    {r.label}
                  </td>
                  <td dir="ltr" className="adm-cash-recon__num">
                    <button
                      type="button"
                      className={`adm-cash-recon__recorded-btn${isExpanded ? " is-active" : ""}`}
                      onClick={() => void openDrill(r.lineId, r.label, r.currency, r.recorded)}
                      title={r.paymentCount > 0 ? `פירוט ${r.paymentCount} קליטות` : "פירוט קליטות"}
                      aria-expanded={isExpanded}
                    >
                      {fmtReconciliationAmount(r.currency, r.recorded)}
                    </button>
                  </td>
                  <td dir="ltr" className="adm-cash-recon__counted">
                    {isAdmin ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="adm-cash-recon__input"
                        placeholder="0"
                        value={counted[r.lineId] ?? ""}
                        onChange={(e) => {
                          const next = { ...counted, [r.lineId]: e.target.value };
                          persistCounted(next);
                        }}
                        aria-label={`נספר בפועל — ${r.label}`}
                      />
                    ) : (
                      <span className="adm-cash-recon__muted">
                        {counted[r.lineId] ? fmtReconciliationAmount(r.currency, countedVal) : "—"}
                      </span>
                    )}
                  </td>
                  <td dir="ltr" className={`adm-cash-recon__diff is-${status}`}>
                    {counted[r.lineId] !== undefined && counted[r.lineId] !== ""
                      ? fmtReconciliationDiff(r.currency, diff)
                      : "—"}
                  </td>
                  <td className="adm-cash-recon__status">
                    {counted[r.lineId] !== undefined && counted[r.lineId] !== "" ? (
                      <span className={`adm-cash-recon__badge is-${status}`}>
                        {statusMeta.icon} {statusMeta.label}
                      </span>
                    ) : (
                      <span className="adm-cash-recon__muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drillLine ? (
        <ReconciliationDetailPanel
          line={drillLine}
          rows={drillRows}
          loading={drillLoading}
          onlyUnchecked={onlyUnchecked}
          reviewBusy={reviewBusy}
          onOnlyUncheckedChange={setOnlyUnchecked}
          onClose={closeDrill}
          onToggleReviewed={toggleReviewed}
          onOpenPayment={openPaymentIntake}
        />
      ) : null}

      <CashControlDeviationsHierarchy rows={cashDeviations} onOpenIntake={onOpenIntake} />
    </section>
  );
}

function ReconciliationDetailPanel({
  line,
  rows,
  loading,
  onlyUnchecked,
  reviewBusy,
  onOnlyUncheckedChange,
  onClose,
  onToggleReviewed,
  onOpenPayment,
}: {
  line: {
    lineId: CashReconciliationLineId;
    label: string;
    currency: CashReconciliationCurrency;
    recorded: number;
  };
  rows: CashReconciliationDetailRow[] | null;
  loading: boolean;
  onlyUnchecked: boolean;
  reviewBusy: string | null;
  onOnlyUncheckedChange: (v: boolean) => void;
  onClose: () => void;
  onToggleReviewed: (paymentId: string, reviewed: boolean) => void;
  onOpenPayment: (row: CashReconciliationDetailRow) => void;
}) {
  const allRows = rows ?? [];
  const visibleRows = useMemo(
    () => (onlyUnchecked ? allRows.filter((r) => !r.reviewed) : allRows),
    [allRows, onlyUnchecked],
  );

  const stats = useMemo(() => {
    const total = allRows.length;
    const reviewed = allRows.filter((r) => r.reviewed).length;
    const amount = allRows.reduce((s, r) => s + parseAmount(r.amount), 0);
    return { total, reviewed, remaining: total - reviewed, amount };
  }, [allRows]);

  return (
    <div className="adm-cash-recon-expand" aria-live="polite">
      <div className="adm-cash-recon-expand__head">
        <h3 className="adm-cash-recon-expand__title">
          פירוט קליטות — {line.label}
        </h3>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={onClose}>
          <X size={14} aria-hidden /> סגור
        </button>
      </div>

      <div className="adm-cash-recon-expand__summary">
        <div className="adm-cash-recon-expand__stat">
          <span className="adm-cash-recon-expand__stat-lbl">קליטות {line.label}:</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="adm-cash-recon-expand__stat is-ok">
          <span className="adm-cash-recon-expand__stat-lbl">נבדקו:</span>
          <strong>{stats.reviewed}</strong>
        </div>
        <div className="adm-cash-recon-expand__stat is-pending">
          <span className="adm-cash-recon-expand__stat-lbl">נותרו לבדיקה:</span>
          <strong>{stats.remaining}</strong>
        </div>
        <div className="adm-cash-recon-expand__stat">
          <span className="adm-cash-recon-expand__stat-lbl">סה״כ:</span>
          <strong dir="ltr">{fmtReconciliationAmount(line.currency, stats.amount || line.recorded)}</strong>
        </div>
        <label className="adm-cash-recon-expand__filter">
          <input
            type="checkbox"
            checked={onlyUnchecked}
            onChange={(e) => onOnlyUncheckedChange(e.target.checked)}
          />
          הצג רק קליטות שלא נבדקו
        </label>
      </div>

      {loading ? (
        <p className="adm-cash-recon-expand__loading">טוען פירוט קליטות…</p>
      ) : allRows.length === 0 ? (
        <p className="adm-table-empty">אין קליטות לאמצעי תשלום זה.</p>
      ) : (
        <div className="adm-cash-recon-expand__scroll">
          <table className="adm-table-excel adm-cash-recon-expand__tbl">
            <thead>
              <tr>
                <th className="adm-cash-recon-expand__col-check">נבדק</th>
                <th>מספר קליטה</th>
                <th>הזמנה</th>
                <th>לקוח</th>
                <th>עובד שקלט</th>
                <th>תאריך</th>
                <th>שעה</th>
                <th>סכום</th>
                <th>כניסה לקליטה</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="adm-table-empty">
                    כל הקליטות סומנו כנבדקו.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => (
                  <tr
                    key={r.paymentId}
                    className={`adm-cash-recon-expand__row${r.reviewed ? " is-reviewed" : ""}`}
                  >
                    <td className="adm-cash-recon-expand__col-check">
                      <label className="adm-cash-recon-expand__check">
                        <input
                          type="checkbox"
                          checked={r.reviewed}
                          disabled={reviewBusy === r.paymentId}
                          onChange={(e) => void onToggleReviewed(r.paymentId, e.target.checked)}
                          aria-label={`נבדק — ${r.paymentCode ?? r.paymentId}`}
                        />
                        <span className="adm-cash-recon-expand__check-lbl">נבדק</span>
                      </label>
                    </td>
                    <td dir="ltr">{r.paymentCode ?? "—"}</td>
                    <td dir="ltr">{r.orderNumber ?? "—"}</td>
                    <td>{r.customerName ?? "—"}</td>
                    <td>{r.recordedByName ?? "—"}</td>
                    <td dir="ltr">{fmtDateYmd(r.dateYmd)}</td>
                    <td dir="ltr">{r.timeHm}</td>
                    <td dir="ltr" className="adm-table-excel-num">
                      {line.currency === "ILS" ? `₪${r.amount}` : `$${r.amount}`}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="adm-cash-recon-expand__open"
                        onClick={() => onOpenPayment(r)}
                        title="פתח קליטת תשלום"
                      >
                        <ExternalLink size={14} aria-hidden /> פתח קליטת תשלום
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {visibleRows.length > 0 ? (
              <tfoot>
                <tr className="adm-cash-recon-expand__foot">
                  <td colSpan={7}>סה״כ</td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {fmtReconciliationAmount(line.currency, stats.amount || line.recorded)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}
