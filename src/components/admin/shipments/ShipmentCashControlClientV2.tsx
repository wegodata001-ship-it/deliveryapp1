"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  Lock,
  Plus,
  Save,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import {
  CASH_CONTROL_METHODS,
  CASH_CONTROL_METHOD_LABELS,
  type CashControlMethodValue,
} from "@/app/admin/shipments/types";
import type {
  CashControlDayRow,
  CashControlViewMode,
  CashControlWeekPayload,
  CashDrilldownExpenseRow,
  CashDrilldownPayload,
  CashDrilldownPaymentRow,
  ShipmentCashControlPayload,
  ShipmentCashExpenseCategory,
  ShipmentCashExpenseDto,
  ShipmentCashMethodLine,
} from "@/app/admin/shipments/cash-control/types";
import { SHIPMENT_CASH_EXPENSE_LABELS } from "@/app/admin/shipments/cash-control/types";
import {
  addShipmentCashExpenseAction,
  closeShipmentCashDayAction,
  deleteShipmentCashExpenseAction,
  drilldownExpensesAction,
  drilldownPaymentsAction,
  loadShipmentCashControlAction,
  loadShipmentCashWeekAction,
  openShipmentCashDayAction,
  reopenShipmentCashDayAction,
  saveManualCollectedAction,
  saveShipmentCashCountsAction,
} from "@/app/admin/shipments/cash-control/actions";

function fmtIls(n: number): string {
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftWeek(code: string, dir: 1 | -1): string {
  const m = code.match(/^AH-(\d+)$/);
  if (!m) return code;
  return `AH-${Number(m[1]) + dir}`;
}

function getCurrentWeekCode(): string {
  const ref = new Date(Date.UTC(2026, 4, 10)); // AH-122 = 2026-05-10
  const now = new Date();
  const diffMs = now.getTime() - ref.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 86400000));
  return `AH-${122 + diffWeeks}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ShipmentCashControlClient() {
  const [viewMode, setViewMode] = useState<CashControlViewMode>("day");
  const [dayDate, setDayDate] = useState(todayYmd());
  const [weekCode, setWeekCode] = useState(getCurrentWeekCode());

  // Day view state
  const [dayData, setDayData] = useState<ShipmentCashControlPayload | null>(null);
  // Week view state
  const [weekData, setWeekData] = useState<CashControlWeekPayload | null>(null);
  // Drill-down
  const [drilldown, setDrilldown] = useState<CashDrilldownPayload | null>(null);
  // Expense modal
  const [expenseOpen, setExpenseOpen] = useState(false);
  // Count edit mode
  const [countEditing, setCountEditing] = useState(false);
  const [countDraft, setCountDraft] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadDay = useCallback(async (date: string) => {
    setBusy(true);
    setError(null);
    const res = await loadShipmentCashControlAction({ dayDate: date });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDayData(res.data);
  }, []);

  const loadWeek = useCallback(async (code: string) => {
    setBusy(true);
    setError(null);
    const res = await loadShipmentCashWeekAction(code);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setWeekData(res.data);
  }, []);

  useEffect(() => {
    if (viewMode === "day") void loadDay(dayDate);
    else if (viewMode === "week") void loadWeek(weekCode);
  }, [viewMode, dayDate, weekCode, loadDay, loadWeek]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function openDay() {
    setBusy(true);
    const res = await openShipmentCashDayAction(dayDate);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    void loadDay(dayDate);
    setSuccess("יום עבודה נפתח");
    setTimeout(() => setSuccess(null), 3000);
  }

  async function closeDay() {
    setBusy(true);
    const res = await closeShipmentCashDayAction(dayDate);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    void loadDay(dayDate);
    setSuccess("יום העבודה נסגר");
    setTimeout(() => setSuccess(null), 3000);
  }

  async function reopenDay() {
    setBusy(true);
    const res = await reopenShipmentCashDayAction(dayDate);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    void loadDay(dayDate);
  }

  function startCountEdit() {
    const draft: Record<string, string> = {};
    for (const m of dayData?.methods ?? []) {
      draft[m.method] = m.countedIls != null ? String(m.countedIls) : "";
    }
    setCountDraft(draft);
    setCountEditing(true);
  }

  async function saveCounts() {
    const counts = Object.entries(countDraft)
      .filter(([, v]) => v.trim() !== "")
      .map(([method, v]) => ({ method, countedIls: Number(v) }));
    if (counts.length === 0) return;
    setBusy(true);
    const res = await saveShipmentCashCountsAction({ dayDate, counts });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDayData(res.data);
    setCountEditing(false);
    setSuccess("ספירת קופה נשמרה");
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleDrilldown(date: string, method: string, type: "receipts" | "expenses") {
    setBusy(true);
    const res = type === "receipts"
      ? await drilldownPaymentsAction(date, method)
      : await drilldownExpensesAction(date, method);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDrilldown(res.data);
  }

  async function handleDeleteExpense(id: string) {
    if (!confirm("למחוק את ההוצאה?")) return;
    setBusy(true);
    const res = await deleteShipmentCashExpenseAction(id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    void loadDay(dayDate);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const dayOpen = dayData?.day?.status === "OPEN";
  const hasDaySession = dayData?.day != null;

  return (
    <div className="shp-cash-control" dir="rtl">
      {/* Header */}
      <div className="shp-cash-control__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CircleDollarSign size={20} />
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>בקרת קופה — דמי משלוח</h2>
        </div>

        {/* View mode tabs */}
        <div className="scc-view-tabs">
          <button className={`scc-tab ${viewMode === "day" ? "scc-tab--active" : ""}`} onClick={() => setViewMode("day")}>יום</button>
          <button className={`scc-tab ${viewMode === "week" ? "scc-tab--active" : ""}`} onClick={() => setViewMode("week")}>שבוע</button>
        </div>
      </div>

      {/* Navigation */}
      {viewMode === "day" && (
        <div className="scc-nav">
          <button className="shp-icon-btn" onClick={() => setDayDate((d) => { const dt = new Date(d); dt.setDate(dt.getDate() - 1); return dt.toISOString().slice(0, 10); })}><ArrowRight size={16} /></button>
          <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} className="scc-date-input" />
          <button className="shp-icon-btn" onClick={() => setDayDate((d) => { const dt = new Date(d); dt.setDate(dt.getDate() + 1); return dt.toISOString().slice(0, 10); })}><ArrowLeft size={16} /></button>
          {!hasDaySession && <button className="shp-btn shp-btn--primary shp-btn--sm" disabled={busy} onClick={openDay}><Unlock size={14} /> פתח יום עבודה</button>}
          {dayOpen && <button className="shp-btn shp-btn--sm" disabled={busy} onClick={closeDay}><Lock size={14} /> סגור יום</button>}
          {hasDaySession && !dayOpen && <button className="shp-btn shp-btn--sm" disabled={busy} onClick={reopenDay}><Unlock size={14} /> פתח מחדש</button>}
        </div>
      )}
      {viewMode === "week" && (
        <div className="scc-nav">
          <button className="shp-icon-btn" onClick={() => setWeekCode((c) => shiftWeek(c, -1))}><ArrowRight size={16} /></button>
          <span className="scc-week-label"><CalendarDays size={14} /> {weekData?.weekLabel || weekCode}</span>
          <button className="shp-icon-btn" onClick={() => setWeekCode((c) => shiftWeek(c, 1))}><ArrowLeft size={16} /></button>
        </div>
      )}

      {/* Messages */}
      {error && <div className="shp-alert shp-alert--error">{error}</div>}
      {success && <div className="shp-alert shp-alert--success">{success}</div>}

      {/* Day View */}
      {viewMode === "day" && dayData && (
        <DayView
          data={dayData}
          busy={busy}
          dayOpen={dayOpen}
          countEditing={countEditing}
          countDraft={countDraft}
          onCountDraftChange={setCountDraft}
          onStartCountEdit={startCountEdit}
          onSaveCounts={saveCounts}
          onCancelCountEdit={() => setCountEditing(false)}
          onDrilldown={(method, type) => handleDrilldown(dayDate, method, type)}
          onAddExpense={() => setExpenseOpen(true)}
          onDeleteExpense={handleDeleteExpense}
        />
      )}

      {/* Week View */}
      {viewMode === "week" && weekData && (
        <WeekView
          data={weekData}
          onDrilldown={(date, method, type) => handleDrilldown(date, method, type)}
        />
      )}

      {/* Expense Modal */}
      {expenseOpen && dayData && (
        <ExpenseModal
          dayDate={dayDate}
          busy={busy}
          onClose={() => setExpenseOpen(false)}
          onSaved={() => { setExpenseOpen(false); void loadDay(dayDate); }}
        />
      )}

      {/* Drilldown Modal */}
      {drilldown && (
        <DrilldownModal
          data={drilldown}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({ data, busy, dayOpen, countEditing, countDraft, onCountDraftChange, onStartCountEdit, onSaveCounts, onCancelCountEdit, onDrilldown, onAddExpense, onDeleteExpense }: {
  data: ShipmentCashControlPayload;
  busy: boolean;
  dayOpen: boolean;
  countEditing: boolean;
  countDraft: Record<string, string>;
  onCountDraftChange: (d: Record<string, string>) => void;
  onStartCountEdit: () => void;
  onSaveCounts: () => void;
  onCancelCountEdit: () => void;
  onDrilldown: (method: string, type: "receipts" | "expenses") => void;
  onAddExpense: () => void;
  onDeleteExpense: (id: string) => void;
}) {
  return (
    <div className="scc-day-view">
      {/* Method table */}
      <div className="shp-table-wrap">
        <table className="shp-table shp-table--compact scc-method-table">
          <thead>
            <tr>
              <th>אמצעי תשלום</th>
              <th>נקלט</th>
              <th>הוצאות</th>
              <th>יתרה</th>
              <th>נספר בפועל</th>
              <th>הפרש</th>
            </tr>
          </thead>
          <tbody>
            {data.methods.map((m) => (
              <tr key={m.method} className={m.status === "large" ? "scc-row--alert" : m.status === "small" ? "scc-row--warn" : ""}>
                <td className="scc-method-name">{m.label}{m.isManual && <span className="scc-manual-badge">ידני</span>}</td>
                <td className="scc-clickable" onClick={() => m.collectedIls > 0 && onDrilldown(m.method, "receipts")}>{fmtIls(m.collectedIls)}</td>
                <td className="scc-clickable" onClick={() => m.expensesIls > 0 && onDrilldown(m.method, "expenses")}>{m.expensesIls > 0 ? fmtIls(m.expensesIls) : "—"}</td>
                <td style={{ fontWeight: 600 }}>{fmtIls(m.balanceIls)}</td>
                <td>
                  {countEditing ? (
                    <input
                      type="number"
                      className="scc-count-input"
                      value={countDraft[m.method] ?? ""}
                      onChange={(e) => onCountDraftChange({ ...countDraft, [m.method]: e.target.value })}
                      min={0}
                      step={0.01}
                    />
                  ) : (
                    m.countedIls != null ? fmtIls(m.countedIls) : <span style={{ color: "#94a3b8" }}>—</span>
                  )}
                </td>
                <td className={`scc-diff scc-diff--${m.status}`}>
                  {m.countedIls != null ? fmtIls(m.differenceIls) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="scc-totals-row">
              <td><strong>סה״כ</strong></td>
              <td><strong>{fmtIls(data.summary.collectedIls)}</strong></td>
              <td><strong>{fmtIls(data.summary.expensesIls)}</strong></td>
              <td><strong>{fmtIls(data.summary.balanceAfterExpensesIls)}</strong></td>
              <td><strong>{fmtIls(data.summary.countedIls)}</strong></td>
              <td className={`scc-diff scc-diff--${Math.abs(data.summary.cashDifferenceIls) < 0.5 ? "ok" : Math.abs(data.summary.cashDifferenceIls) <= 50 ? "small" : "large"}`}>
                <strong>{fmtIls(data.summary.cashDifferenceIls)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Action buttons */}
      <div className="scc-actions">
        {dayOpen && !countEditing && <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={onStartCountEdit}><Save size={14} /> ספירת קופה</button>}
        {countEditing && (
          <>
            <button className="shp-btn shp-btn--primary shp-btn--sm" disabled={busy} onClick={onSaveCounts}><Save size={14} /> שמור ספירה</button>
            <button className="shp-btn shp-btn--sm" onClick={onCancelCountEdit}>ביטול</button>
          </>
        )}
        {dayOpen && <button className="shp-btn shp-btn--sm" onClick={onAddExpense}><Plus size={14} /> הוספת הוצאה</button>}
      </div>

      {/* Expenses list */}
      {data.expenses.length > 0 && (
        <div className="scc-expenses-section">
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 8px" }}>הוצאות היום</h3>
          <div className="shp-table-wrap" style={{ maxHeight: 200 }}>
            <table className="shp-table shp-table--compact">
              <thead>
                <tr>
                  <th>סוג</th>
                  <th>אמצעי תשלום</th>
                  <th>סכום</th>
                  <th>הערה</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.categoryLabel}</td>
                    <td>{e.paymentMethodLabel}</td>
                    <td>{fmtIls(e.amountIls)}</td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{e.notes || "—"}</td>
                    <td>
                      {dayOpen && (
                        <button className="shp-icon-btn" title="מחק" onClick={() => onDeleteExpense(e.id)} disabled={busy}><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day Summary */}
      <div className="scc-summary-bar">
        <div><span>נקלט:</span> <strong>{fmtIls(data.summary.collectedIls)}</strong></div>
        <div><span>הוצאות:</span> <strong>{fmtIls(data.summary.expensesIls)}</strong></div>
        <div><span>יתרה:</span> <strong>{fmtIls(data.summary.balanceAfterExpensesIls)}</strong></div>
        <div><span>הפרש קופה:</span> <strong className={Math.abs(data.summary.cashDifferenceIls) > 50 ? "scc-alert-text" : ""}>{fmtIls(data.summary.cashDifferenceIls)}</strong></div>
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({ data, onDrilldown }: {
  data: CashControlWeekPayload;
  onDrilldown: (date: string, method: string, type: "receipts" | "expenses") => void;
}) {
  return (
    <div className="scc-week-view">
      <div className="shp-table-wrap" style={{ overflowX: "auto" }}>
        <table className="shp-table shp-table--compact scc-week-table">
          <thead>
            <tr>
              <th>יום</th>
              {CASH_CONTROL_METHODS.map((m) => (
                <th key={m.value}>{m.label}</th>
              ))}
              <th>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.dayDate} className={day.dayStatus === "CLOSED" ? "scc-row--closed" : ""}>
                <td className="scc-day-cell">
                  <span className="scc-day-name">{day.dayLabel}</span>
                  <span className="scc-day-date">{day.dayDate.slice(5)}</span>
                  {day.dayStatus && <span className={`scc-status-dot scc-status-dot--${day.dayStatus.toLowerCase()}`} />}
                </td>
                {CASH_CONTROL_METHODS.map((m) => {
                  const amount = day.byMethod[m.value] ?? 0;
                  return (
                    <td key={m.value} className={amount > 0 ? "scc-clickable" : ""} onClick={() => amount > 0 && onDrilldown(day.dayDate, m.value, "receipts")}>
                      {amount > 0 ? fmtIls(amount) : "—"}
                    </td>
                  );
                })}
                <td style={{ fontWeight: 600 }}>{fmtIls(day.totalCollected)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="scc-totals-row">
              <td><strong>סה״כ שבועי</strong></td>
              {CASH_CONTROL_METHODS.map((m) => (
                <td key={m.value}><strong>{fmtIls(data.totalByMethod[m.value] ?? 0)}</strong></td>
              ))}
              <td><strong>{fmtIls(data.totalCollected)}</strong></td>
            </tr>
            <tr className="scc-totals-row scc-expenses-row">
              <td>הוצאות</td>
              {CASH_CONTROL_METHODS.map((m) => (
                <td key={m.value}>{(data.totalExpensesByMethod[m.value] ?? 0) > 0 ? fmtIls(data.totalExpensesByMethod[m.value]) : "—"}</td>
              ))}
              <td><strong>{fmtIls(data.totalExpenses)}</strong></td>
            </tr>
            <tr className="scc-totals-row scc-balance-row">
              <td><strong>יתרה</strong></td>
              {CASH_CONTROL_METHODS.map((m) => {
                const bal = (data.totalByMethod[m.value] ?? 0) - (data.totalExpensesByMethod[m.value] ?? 0);
                return <td key={m.value}><strong>{fmtIls(bal)}</strong></td>;
              })}
              <td><strong>{fmtIls(data.totalBalance)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Weekly Summary */}
      <div className="scc-summary-bar scc-summary-bar--week">
        <div><span>סך תקבולים:</span> <strong>{fmtIls(data.totalCollected)}</strong></div>
        <div><span>סך הוצאות:</span> <strong>{fmtIls(data.totalExpenses)}</strong></div>
        <div><span>יתרה לאחר הוצאות:</span> <strong>{fmtIls(data.totalBalance)}</strong></div>
      </div>
    </div>
  );
}

// ─── Expense Modal ────────────────────────────────────────────────────────────

function ExpenseModal({ dayDate, busy, onClose, onSaved }: {
  dayDate: string;
  busy: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<ShipmentCashExpenseCategory>("FUEL");
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const amountIls = Number(amount);
    if (!Number.isFinite(amountIls) || amountIls <= 0) { setErr("סכום לא תקין"); return; }
    setSaving(true);
    setErr(null);
    const res = await addShipmentCashExpenseAction({ dayDate, category, paymentMethod, amountIls, notes: notes.trim() || null });
    setSaving(false);
    if (!res.ok) { setErr(res.error); return; }
    onSaved();
  }

  return (
    <div className="shp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="shp-modal" style={{ maxWidth: 440, width: "92vw" }} dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="shp-modal__header">
          <strong>הוספת הוצאה</strong>
          <button type="button" className="shp-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <label className="sc-expense-field">
            <span>סוג הוצאה</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as ShipmentCashExpenseCategory)}>
              {Object.entries(SHIPMENT_CASH_EXPENSE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="sc-expense-field">
            <span>אמצעי תשלום</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              {CASH_CONTROL_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="sc-expense-field">
            <span>סכום (₪)</span>
            <input type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          <label className="sc-expense-field">
            <span>הערה</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="(אופציונלי)" />
          </label>
          {err && <div className="shp-alert shp-alert--error">{err}</div>}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose}>ביטול</button>
          <button type="button" className="shp-btn shp-btn--primary" disabled={saving || busy} onClick={save}>
            {saving ? "שומר..." : "הוסף הוצאה"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Drilldown Modal ──────────────────────────────────────────────────────────

function DrilldownModal({ data, onClose }: {
  data: CashDrilldownPayload;
  onClose: () => void;
}) {
  const title = data.type === "receipts"
    ? `פירוט קליטות — ${data.methodLabel} (${data.dayDate})`
    : `פירוט הוצאות — ${data.methodLabel} (${data.dayDate})`;

  return (
    <div className="shp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="shp-modal" style={{ maxWidth: 640, width: "96vw" }} dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="shp-modal__header">
          <strong>{title}</strong>
          <button type="button" className="shp-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="shp-modal__body" style={{ maxHeight: 400, overflow: "auto" }}>
          {data.type === "receipts" ? (
            <table className="shp-table shp-table--compact">
              <thead>
                <tr>
                  <th>משלוח</th>
                  <th>לקוח</th>
                  <th>סכום</th>
                  <th>שעה</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows as CashDrilldownPaymentRow[]).map((r) => (
                  <tr key={r.id}>
                    <td>{r.shipmentLabel}</td>
                    <td>{r.customerName || "—"}</td>
                    <td>{fmtIls(r.amountIls)}</td>
                    <td>{r.time}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="scc-totals-row">
                  <td colSpan={2}><strong>סה״כ</strong></td>
                  <td><strong>{fmtIls(data.totalIls)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="shp-table shp-table--compact">
              <thead>
                <tr>
                  <th>הוצאה</th>
                  <th>סכום</th>
                  <th>הערה</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows as CashDrilldownExpenseRow[]).map((r) => (
                  <tr key={r.id}>
                    <td>{r.categoryLabel}</td>
                    <td>{fmtIls(r.amountIls)}</td>
                    <td>{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="scc-totals-row">
                  <td><strong>סה״כ</strong></td>
                  <td><strong>{fmtIls(data.totalIls)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
          {data.rows.length === 0 && <div style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>אין נתונים</div>}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
