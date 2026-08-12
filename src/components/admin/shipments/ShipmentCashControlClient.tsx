"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  addShipmentCashExpenseAction,
  closeShipmentCashDayAction,
  deleteShipmentCashExpenseAction,
  loadShipmentCashControlAction,
  openShipmentCashDayAction,
  reopenShipmentCashDayAction,
  saveShipmentCashCountsAction,
} from "@/app/admin/shipments/cash-control/actions";
import {
  SHIPMENT_CASH_EXPENSE_LABELS,
  type CashVarianceStatus,
  type ShipmentCashControlPayload,
  type ShipmentCashExpenseCategory,
  type ShipmentCashMethodLine,
} from "@/app/admin/shipments/cash-control/types";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";

type Props = {
  initialData: ShipmentCashControlPayload;
  initialDayDate: string;
  viewerIsAdmin: boolean;
  embedded?: boolean;
  onBack?: () => void;
};

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  });
}

function varianceClass(status: CashVarianceStatus): string {
  if (status === "ok") return "scc-var--ok";
  if (status === "small") return "scc-var--small";
  if (status === "large") return "scc-var--large";
  return "scc-var--pending";
}

function varianceLabel(status: CashVarianceStatus): string {
  if (status === "ok") return "תקין";
  if (status === "small") return "הפרש קטן";
  if (status === "large") return "הפרש גדול";
  return "ממתין לספירה";
}

export function ShipmentCashControlClient({
  initialData,
  initialDayDate,
  viewerIsAdmin,
  embedded,
  onBack,
}: Props) {
  const { workCountry } = useShipmentCountry();
  const [data, setData] = useState(initialData);
  const [dayDate, setDayDate] = useState(initialData.dayDate || initialDayDate);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countedDraft, setCountedDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialData.methods.map((m) => [
        m.method,
        m.countedIls != null ? String(m.countedIls) : "",
      ]),
    ),
  );
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseCategory, setExpenseCategory] =
    useState<ShipmentCashExpenseCategory>("FUEL");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");

  void viewerIsAdmin; // הרשאות כתיבה נאכפות בשרת
  const dayOpen = data.day?.status === "OPEN";
  const dayClosed = data.day?.status === "CLOSED";

  const syncDraftFromData = useCallback((payload: ShipmentCashControlPayload) => {
    setData(payload);
    setDayDate(payload.dayDate);
    setCountedDraft(
      Object.fromEntries(
        payload.methods.map((m) => [
          m.method,
          m.countedIls != null ? String(m.countedIls) : "",
        ]),
      ),
    );
  }, []);

  const refresh = useCallback(
    async (date = dayDate) => {
      setBusy(true);
      setError(null);
      const res = await loadShipmentCashControlAction({ workCountry, dayDate: date });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      syncDraftFromData(res.data);
    },
    [dayDate, syncDraftFromData],
  );

  async function openDay() {
    setBusy(true);
    setError(null);
    const res = await openShipmentCashDayAction(workCountry, dayDate);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.reusedExistingOpen && res.day.dayDate !== dayDate) {
      setMsg(`כבר קיים יום פתוח (${res.day.dayDate}) — עוברים אליו`);
      setDayDate(res.day.dayDate);
      await refresh(res.day.dayDate);
      return;
    }
    setMsg("יום העבודה נפתח");
    await refresh(dayDate);
  }

  async function closeDay() {
    if (!window.confirm("לסגור את יום העבודה?")) return;
    setBusy(true);
    const res = await closeShipmentCashDayAction(workCountry, dayDate);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMsg("היום נסגר");
    await refresh();
  }

  async function reopenDay() {
    setBusy(true);
    const res = await reopenShipmentCashDayAction(workCountry, dayDate);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMsg("היום נפתח מחדש");
    await refresh();
  }

  async function saveCounts() {
    const counts = data.methods.map((m) => {
      const raw = countedDraft[m.method]?.trim() ?? "";
      const countedIls = raw === "" ? 0 : Number(raw);
      return { method: m.method, countedIls };
    });
    if (counts.some((c) => !Number.isFinite(c.countedIls) || c.countedIls < 0)) {
      setError("יש להזין סכומים תקינים בספירה");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveShipmentCashCountsAction(workCountry, { dayDate, counts });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    syncDraftFromData(res.data);
    setMsg("ספירת הקופה נשמרה");
  }

  async function addExpense() {
    const amountIls = Number(expenseAmount);
    if (!Number.isFinite(amountIls) || amountIls <= 0) {
      setError("סכום הוצאה לא תקין");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addShipmentCashExpenseAction(workCountry, {
      dayDate,
      category: expenseCategory,
      paymentMethod: "CASH",
      amountIls,
      notes: expenseNotes,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setExpenseOpen(false);
    setExpenseAmount("");
    setExpenseNotes("");
    setMsg("ההוצאה נוספה");
    await refresh();
  }

  async function removeExpense(id: string) {
    if (!window.confirm("למחוק הוצאה?")) return;
    setBusy(true);
    const res = await deleteShipmentCashExpenseAction(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await refresh();
  }

  const previewMethods: ShipmentCashMethodLine[] = useMemo(() => {
    return data.methods.map((m) => {
      const raw = countedDraft[m.method]?.trim() ?? "";
      const countedIls = raw === "" ? null : Number(raw);
      const counted =
        countedIls != null && Number.isFinite(countedIls) ? countedIls : null;
      const differenceIls = counted == null ? 0 : counted - m.collectedIls;
      let status: CashVarianceStatus = "pending";
      if (counted != null) {
        const abs = Math.abs(differenceIls);
        status = abs < 0.5 ? "ok" : abs <= 50 ? "small" : "large";
      }
      return { ...m, countedIls: counted, differenceIls, status };
    });
  }, [data.methods, countedDraft]);

  const previewSummary = useMemo(() => {
    const collectedIls = previewMethods.reduce((s, m) => s + m.collectedIls, 0);
    const countedIls = previewMethods.reduce((s, m) => s + (m.countedIls ?? 0), 0);
    const expensesIls = data.summary.expensesIls;
    return {
      collectedIls,
      countedIls,
      expensesIls,
      cashDifferenceIls: countedIls - collectedIls,
      balanceAfterExpensesIls: countedIls - expensesIls,
    };
  }, [previewMethods, data.summary.expensesIls]);

  return (
    <div className="shp-page shp-page--wide scc-page scc-page--reconcile" dir="rtl">
      <div className="shp-header">
        {embedded && onBack && (
          <button type="button" className="shp-btn shp-btn--ghost" onClick={onBack}>
            <ArrowRight size={16} />
            חזרה
          </button>
        )}
        <Wallet size={22} style={{ color: "#2563eb" }} />
        <div>
          <h1>בקרת קופה</h1>
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            התאמה בין מה שנקלט מהלקוחות במשלוחים לבין מה שנספר בפועל בקופה
          </p>
        </div>
        <div className="shp-header-actions">
          <label className="scc-day-picker">
            <CalendarDays size={14} />
            <input
              type="date"
              value={dayDate}
              onChange={(e) => {
                setDayDate(e.target.value);
                void loadShipmentCashControlAction({ workCountry, dayDate: e.target.value }).then(
                  (res) => {
                    if (res.ok) syncDraftFromData(res.data);
                    else setError(res.error);
                  },
                );
              }}
            />
          </label>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
            רענון
          </button>
        </div>
      </div>

      {(msg || error) && (
        <div className={`shp-alert ${error ? "shp-alert--error" : ""}`} role="status">
          {error || msg}
          <button
            type="button"
            className="shp-icon-btn"
            style={{ marginInlineStart: 8 }}
            onClick={() => {
              setMsg(null);
              setError(null);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <section className="scc-session">
        <div className="scc-session__status">
          {data.day ? (
            <>
              <strong>יום {data.day.dayDate}</strong>
              <span className={dayOpen ? "scc-badge scc-badge--open" : "scc-badge scc-badge--closed"}>
                {dayOpen ? "פתוח" : "סגור"}
              </span>
            </>
          ) : (
            <span>לא נפתח יום עבודה לתאריך זה</span>
          )}
        </div>
        <div className="scc-session__actions">
          {!data.day && (
            <button
              type="button"
              className="shp-btn shp-btn--primary shp-btn--sm"
              disabled={busy}
              onClick={() => void openDay()}
            >
              פתח יום עבודה
            </button>
          )}
          {dayOpen && (
            <button
              type="button"
              className="shp-btn shp-btn--secondary shp-btn--sm"
              disabled={busy}
              onClick={() => void closeDay()}
            >
              סגור יום
            </button>
          )}
          {dayClosed && (
            <button
              type="button"
              className="shp-btn shp-btn--secondary shp-btn--sm"
              disabled={busy}
              onClick={() => void reopenDay()}
            >
              פתח מחדש
            </button>
          )}
        </div>
      </section>

      {/* שלב 1+2+3 — התאמה */}
      <section className="scc-card">
        <div className="scc-card__head">
          <h2>
            <Banknote size={18} />
            התאמת קופה לפי אמצעי תשלום
          </h2>
          <p>
            עמודת «נקלט מהמשלוחים» מחושבת אוטומטית מקליטות התשלום. עמודת «נספר בפועל» —
            להזנת המנהל.
          </p>
        </div>

        <div className="shp-table-wrap">
          <table className="shp-table shp-table--compact scc-reconcile-table">
            <thead>
              <tr>
                <th>אמצעי תשלום</th>
                <th>נקלט מהמשלוחים</th>
                <th>נספר בפועל</th>
                <th>הפרש</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {previewMethods.map((m) => (
                <tr key={m.method}>
                  <td style={{ fontWeight: 600 }}>{m.label}</td>
                  <td className="scc-readonly">{fmtIls(m.collectedIls)}</td>
                  <td>
                    <input
                      className="scc-count-input"
                      type="number"
                      min={0}
                      step={0.01}
                      disabled={busy || dayClosed}
                      value={countedDraft[m.method] ?? ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        setCountedDraft((prev) => ({
                          ...prev,
                          [m.method]: e.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className={`scc-diff ${varianceClass(m.status)}`}>
                    {m.countedIls == null ? "—" : fmtIls(m.differenceIls)}
                  </td>
                  <td>
                    <span className={`scc-var-pill ${varianceClass(m.status)}`}>
                      {varianceLabel(m.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="scc-card__footer">
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={busy || dayClosed}
            onClick={() => void saveCounts()}
          >
            <Save size={14} />
            שמור ספירה
          </button>
          {!data.day && (
            <span className="scc-hint">שמירה תפתח יום עבודה אוטומטית אם צריך</span>
          )}
        </div>
      </section>

      {/* שלב 4 — הוצאות */}
      <section className="scc-card">
        <div className="scc-card__head scc-card__head--row">
          <div>
            <h2>הוצאות יום</h2>
            <p>ההוצאות אינן משנות את סכומי הקליטה — רק את סיכום הקופה.</p>
          </div>
          <button
            type="button"
            className="shp-btn shp-btn--primary shp-btn--sm"
            disabled={busy || dayClosed}
            onClick={() => setExpenseOpen(true)}
          >
            <Plus size={14} />
            הוסף הוצאה
          </button>
        </div>

        <div className="shp-table-wrap">
          <table className="shp-table shp-table--compact">
            <thead>
              <tr>
                <th>סוג הוצאה</th>
                <th>סכום</th>
                <th>הערה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "#94a3b8", padding: 20 }}>
                    אין הוצאות ליום זה
                  </td>
                </tr>
              )}
              {data.expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.categoryLabel}</td>
                  <td style={{ fontWeight: 600 }}>{fmtIls(e.amountIls)}</td>
                  <td style={{ color: "#64748b" }}>{e.notes || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="shp-btn shp-btn--sm shp-btn--danger"
                      disabled={busy || dayClosed}
                      onClick={() => void removeExpense(e.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="scc-expense-total">
          סה״כ הוצאות: <strong>{fmtIls(data.summary.expensesIls)}</strong>
        </div>
      </section>

      {/* שלב 5 — סיכום */}
      <section className="scc-summary-grid">
        <div className="scc-summary-card">
          <span>נקלט מהלקוחות</span>
          <strong>{fmtIls(previewSummary.collectedIls)}</strong>
        </div>
        <div className="scc-summary-card">
          <span>נספר בקופה</span>
          <strong>{fmtIls(previewSummary.countedIls)}</strong>
        </div>
        <div className="scc-summary-card">
          <span>סה״כ הוצאות</span>
          <strong>{fmtIls(previewSummary.expensesIls)}</strong>
        </div>
        <div
          className={`scc-summary-card ${
            Math.abs(previewSummary.cashDifferenceIls) < 0.5
              ? "scc-summary-card--ok"
              : Math.abs(previewSummary.cashDifferenceIls) <= 50
                ? "scc-summary-card--warn"
                : "scc-summary-card--bad"
          }`}
        >
          <span>הפרש קופה</span>
          <strong>{fmtIls(previewSummary.cashDifferenceIls)}</strong>
        </div>
        <div className="scc-summary-card scc-summary-card--accent">
          <span>יתרה לאחר הוצאות</span>
          <strong>{fmtIls(previewSummary.balanceAfterExpensesIls)}</strong>
        </div>
      </section>

      {expenseOpen && (
        <div
          className="shp-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setExpenseOpen(false)}
        >
          <div
            className="shp-modal"
            style={{ maxWidth: 420, width: "92vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shp-modal__header">
              <strong>הוספת הוצאה</strong>
              <button type="button" className="shp-icon-btn" onClick={() => setExpenseOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="shp-modal__body" style={{ display: "grid", gap: 10 }}>
              <label className="sc-expense-field">
                <span>סוג הוצאה</span>
                <select
                  value={expenseCategory}
                  onChange={(e) =>
                    setExpenseCategory(e.target.value as ShipmentCashExpenseCategory)
                  }
                >
                  {(Object.keys(SHIPMENT_CASH_EXPENSE_LABELS) as ShipmentCashExpenseCategory[]).map(
                    (key) => (
                      <option key={key} value={key}>
                        {SHIPMENT_CASH_EXPENSE_LABELS[key]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="sc-expense-field">
                <span>סכום</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                />
              </label>
              <label className="sc-expense-field">
                <span>הערה</span>
                <input
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  placeholder="אופציונלי"
                />
              </label>
            </div>
            <div className="shp-modal__footer">
              <button type="button" className="shp-btn" onClick={() => setExpenseOpen(false)}>
                ביטול
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                disabled={busy}
                onClick={() => void addExpense()}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
