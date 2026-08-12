"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteCashExpenseAction,
  listCashExpensesFullAction,
} from "@/app/admin/cash-expenses/actions";
import type { CashExpenseCapabilities, CashExpenseRowDto } from "@/app/admin/cash-expenses/types";
import type { CashCurrency } from "@/app/admin/cash-control/constants";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { num } from "@/components/admin/cash-flow/shared";
import {
  CashExpenseFormModal,
  timeFromIso,
  type CashExpenseEditable,
} from "@/components/admin/CashExpenseFormModal";
import {
  CashExpenseDeleteConfirmModal,
  type CashExpenseDeleteTarget,
} from "@/components/admin/cash-control/CashExpenseDeleteConfirmModal";
import { PaymentMethodColorDot } from "@/components/admin/PaymentMethodColorDot";

export type WeekExpensesSummary = {
  ils: number;
  usd: number;
  ilsCount: number;
  usdCount: number;
  totalCount: number;
};

export type WeekExpensesPanelHandle = {
  scrollIntoView: () => void;
  setCurrencyFilter: (currency: CashCurrency | null) => void;
  openCreate: () => void;
};

type Props = {
  week: string;
  weekLabel?: string | null;
  weekDateRange?: string | null;
  caps: CashExpenseCapabilities;
  balancedWeekLabel?: string | null;
  defaultDateYmd?: string | null;
  currencyFilter?: CashCurrency | null;
  onCurrencyFilterChange?: (currency: CashCurrency | null) => void;
  onSummaryChange?: (summary: WeekExpensesSummary) => void;
  onChanged: () => void;
  reloadKey?: number;
};

function emptySummary(): WeekExpensesSummary {
  return { ils: 0, usd: 0, ilsCount: 0, usdCount: 0, totalCount: 0 };
}

function computeSummary(rows: CashExpenseRowDto[]): WeekExpensesSummary {
  let ils = 0;
  let usd = 0;
  let ilsCount = 0;
  let usdCount = 0;
  for (const r of rows) {
    const amount = num(r.amount);
    if (r.currency === "USD") {
      usd += amount;
      usdCount += 1;
    } else {
      ils += amount;
      ilsCount += 1;
    }
  }
  return { ils, usd, ilsCount, usdCount, totalCount: rows.length };
}

export const WeekExpensesPanel = forwardRef<WeekExpensesPanelHandle, Props>(function WeekExpensesPanel(
  {
    week,
    weekLabel,
    weekDateRange,
    caps,
    balancedWeekLabel = null,
    defaultDateYmd = null,
    currencyFilter = null,
    onCurrencyFilterChange,
    onSummaryChange,
    onChanged,
    reloadKey = 0,
  },
  ref,
) {
  const rootRef = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<CashExpenseRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashExpenseDeleteTarget | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CashExpenseEditable | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listCashExpensesFullAction({ week: week.trim() || undefined }).then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
      setExpanded(data.length > 0);
      onSummaryChange?.(computeSummary(data));
    });
    return () => {
      cancelled = true;
    };
  }, [week, tick, reloadKey, onSummaryChange]);

  useEffect(() => {
    onSummaryChange?.(emptySummary());
  }, [week, onSummaryChange]);

  const filteredRows = useMemo(() => {
    if (!currencyFilter) return rows;
    return rows.filter((r) => r.currency === currencyFilter);
  }, [currencyFilter, rows]);

  const totals = useMemo(() => computeSummary(rows), [rows]);

  const filteredTotals = useMemo(() => computeSummary(filteredRows), [filteredRows]);

  const openCreate = useCallback(() => {
    if (!caps.canCreate) return;
    setEditing(null);
    setModalOpen(true);
    setExpanded(true);
  }, [caps.canCreate]);

  useImperativeHandle(
    ref,
    () => ({
      scrollIntoView: () => {
        setExpanded(true);
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      setCurrencyFilter: (currency) => {
        onCurrencyFilterChange?.(currency);
        setExpanded(true);
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      openCreate,
    }),
    [onCurrencyFilterChange, openCreate],
  );

  const handleSaved = useCallback(() => {
    refresh();
    onChanged();
    if (week.trim()) dispatchCashControlRefresh(week.trim());
  }, [onChanged, refresh, week]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setBusyId(id);
    try {
      const res = await deleteCashExpenseAction(id);
      if (!res.ok) {
        alert(res.error ?? "מחיקה נכשלה");
        return;
      }
      setDeleteTarget(null);
      handleSaved();
    } finally {
      setBusyId(null);
    }
  }, [deleteTarget, handleSaved]);

  const headerMeta = [
    weekLabel?.trim() || week.trim(),
    weekDateRange?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");

  const collapseSummary = [
    fmtDailyMoney("ILS", totals.ils),
    fmtDailyMoney("USD", totals.usd),
    `${totals.totalCount} הוצאות`,
  ].join(" | ");

  return (
    <section ref={rootRef} className="cc-week-expenses" aria-label="הוצאות השבוע">
      <header className="cc-week-expenses__head">
        <button
          type="button"
          className="cc-week-expenses__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="cc-week-expenses__toggle-icon" aria-hidden>
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
          <span className="cc-week-expenses__toggle-text">
            <strong>הוצאות השבוע</strong>
            {headerMeta ? <span className="cc-week-expenses__meta">{headerMeta}</span> : null}
          </span>
          {!expanded ? (
            <span className="cc-week-expenses__collapsed-summary" dir="ltr">
              {collapseSummary}
            </span>
          ) : null}
        </button>

        <div className="cc-week-expenses__head-actions">
          {currencyFilter ? (
            <button
              type="button"
              className="cc-btn cc-btn--ghost cc-btn--sm"
              onClick={() => onCurrencyFilterChange?.(null)}
            >
              הצג הכל
            </button>
          ) : null}
          {caps.canCreate ? (
            <button type="button" className="cc-btn cc-btn--danger cc-btn--sm" onClick={openCreate}>
              <Plus size={14} aria-hidden />
              הוצאה חדשה
            </button>
          ) : null}
        </div>
      </header>

      {expanded ? (
        <div className="cc-week-expenses__body">
          {currencyFilter ? (
            <p className="cc-week-expenses__filter-note">
              מציג הוצאות {currencyFilter === "USD" ? "דולר ($)" : "שקל (₪)"} בלבד
            </p>
          ) : null}

          {loading ? (
            <p className="cc-loading">טוען הוצאות…</p>
          ) : filteredRows.length === 0 ? (
            <p className="cc-empty">
              {currencyFilter
                ? `אין הוצאות ${currencyFilter === "USD" ? "דולר" : "שקל"} בשבוע זה`
                : "אין הוצאות קופה בשבוע זה"}
            </p>
          ) : (
            <div className="cc-summary__scroll">
              <table className="cc-table cc-table--week-expenses">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>סוג הוצאה</th>
                    <th>תיאור</th>
                    <th>מטבע</th>
                    <th className="cc-num">סכום</th>
                    <th>אמצעי תשלום</th>
                    <th>נרשם ע״י</th>
                    <th>הערה</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id}>
                      <td dir="ltr">{r.dateDisplay}</td>
                      <td>{r.reasonLabel}</td>
                      <td>{r.notes?.trim() || "—"}</td>
                      <td>{r.currency === "USD" ? "$" : "₪"}</td>
                      <td dir="ltr" className="cc-num">
                        {fmtDailyMoney(r.currency, num(r.amount))}
                      </td>
                      <td>
                        <PaymentMethodColorDot
                          method={r.paymentMethod}
                          label={r.paymentMethodLabel}
                          size={7}
                        />
                      </td>
                      <td>{r.createdByName ?? "—"}</td>
                      <td>—</td>
                      <td className="cc-icon-cell">
                        <div className="cc-row-actions">
                          {caps.canEdit || caps.canView ? (
                            <button
                              type="button"
                              className="cc-iconbtn"
                              title={caps.canEdit ? "עריכה" : "צפייה"}
                              onClick={() => {
                                setEditing({
                                  id: r.id,
                                  dateYmd: r.dateYmd,
                                  timeHm: timeFromIso(r.expenseDateIso),
                                  reason: r.reason,
                                  notes: r.notes,
                                  currency: r.currency,
                                  amount: r.amount,
                                  paymentMethod: r.paymentMethod,
                                });
                                setModalOpen(true);
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                          ) : null}
                          {caps.canDelete ? (
                            <button
                              type="button"
                              className="cc-iconbtn cc-iconbtn--danger"
                              title="מחיקה"
                              disabled={busyId === r.id}
                              onClick={() =>
                                setDeleteTarget({
                                  id: r.id,
                                  reasonLabel: r.reasonLabel,
                                  amount: r.amount,
                                  currency: r.currency,
                                  dateDisplay: r.dateDisplay,
                                  weekCode: r.weekCode,
                                  notes: r.notes,
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <footer className="cc-week-expenses__foot">
            <div dir="ltr">
              <span className="cc-week-expenses__foot-label">סה״כ ₪:</span>{" "}
              <strong>{fmtDailyMoney("ILS", filteredTotals.ils)}</strong>
            </div>
            <div dir="ltr">
              <span className="cc-week-expenses__foot-label">סה״כ $:</span>{" "}
              <strong>{fmtDailyMoney("USD", filteredTotals.usd)}</strong>
            </div>
          </footer>
        </div>
      ) : null}

      <CashExpenseFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        expense={editing}
        week={week.trim() || undefined}
        defaultDateYmd={defaultDateYmd ?? undefined}
      />

      <CashExpenseDeleteConfirmModal
        open={!!deleteTarget}
        expense={deleteTarget}
        busy={!!busyId}
        balancedWeekLabel={balancedWeekLabel}
        onCancel={() => {
          if (busyId) return;
          setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
});

export default WeekExpensesPanel;
