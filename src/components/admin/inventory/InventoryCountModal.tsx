"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Package, X, Plus, Trash2, Save, ChevronDown, BarChart2, Clock, GitCompare, ClipboardList } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { formatLocalYmd } from "@/lib/work-week";
import type {
  InventoryItemDto,
  InventoryCountSummary,
  InventoryCountDetail,
  InventoryWeekCompareRow,
  InventoryChartPoint,
} from "@/app/admin/inventory/actions";
import {
  listInventoryItemsAction,
  listInventoryCountsAction,
  getInventoryCountDetailAction,
  saveInventoryCountAction,
  submitInventoryCountAction,
  compareInventoryWeeksAction,
  getInventoryChartDataAction,
  upsertInventoryItemAction,
  deleteInventoryItemAction,
} from "@/app/admin/inventory/actions";

type Tab = "count" | "history" | "compare" | "charts";

type CountLineState = {
  itemId: string;
  itemName: string;
  unit: string;
  pricePerUnit: number;
  currency: string;
  systemQty: string;
  countedQty: string;
  notes: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function fmtNum(n: number, dec = 2) {
  return n.toLocaleString("he-IL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtMoney(n: number, currency = "ILS") {
  const sym = currency === "USD" ? "$" : "₪";
  return `${sym}${fmtNum(Math.abs(n), 2)}`;
}

function statusLabel(s: string) {
  if (s === "DRAFT") return "טיוטה";
  if (s === "SUBMITTED") return "הוגשה";
  if (s === "APPROVED") return "אושרה";
  return s;
}

function statusClass(s: string) {
  if (s === "DRAFT") return "inv-badge inv-badge--draft";
  if (s === "SUBMITTED") return "inv-badge inv-badge--submitted";
  return "inv-badge inv-badge--approved";
}

// ─── Mini bar chart (pure SVG) ───────────────────────────────────────────────
function MiniBarChart({ points, field }: { points: InventoryChartPoint[]; field: "exceptions" | "totalDiffValue" }) {
  if (points.length === 0) return <p className="inv-chart-empty">אין נתונים</p>;
  const values = points.map((p) => (field === "exceptions" ? p.exceptions : Math.abs(p.totalDiffValue)));
  const max = Math.max(...values, 1);
  const W = 500, H = 120, pad = 30, barW = Math.max(6, Math.floor((W - pad * 2) / points.length) - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H + pad}`} className="inv-chart-svg" role="img">
      {points.map((p, i) => {
        const val = values[i] ?? 0;
        const barH = Math.max(2, Math.round((val / max) * H));
        const x = pad + i * ((W - pad * 2) / points.length);
        const y = H - barH;
        return (
          <g key={p.weekCode}>
            <rect x={x} y={y} width={barW} height={barH} rx={2} className="inv-chart-bar" />
            <text x={x + barW / 2} y={H + pad - 4} textAnchor="middle" className="inv-chart-label">
              {p.weekCode.replace("AH-", "")}
            </text>
            {barH > 16 && (
              <text x={x + barW / 2} y={y + 12} textAnchor="middle" className="inv-chart-val">
                {field === "exceptions" ? String(val) : fmtNum(val, 0)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main Modal ──────────────────────────────────────────────────────────────
export function InventoryCountModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("count");
  const [items, setItems] = useState<InventoryItemDto[]>([]);
  const [history, setHistory] = useState<InventoryCountSummary[]>([]);
  const [detail, setDetail] = useState<InventoryCountDetail | null>(null);
  const [chartData, setChartData] = useState<InventoryChartPoint[]>([]);
  const [compareWeekA, setCompareWeekA] = useState(ACTIVE_WORK_WEEK_CODE);
  const [compareWeekB, setCompareWeekB] = useState("");
  const [compareRows, setCompareRows] = useState<InventoryWeekCompareRow[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Count form state
  const [editingCountId, setEditingCountId] = useState<string | null>(null);
  const [weekCode, setWeekCode] = useState(ACTIVE_WORK_WEEK_CODE);
  const [countDate, setCountDate] = useState(formatLocalYmd(new Date()));
  const [countNotes, setCountNotes] = useState("");
  const [lines, setLines] = useState<CountLineState[]>([]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // New item inline form
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("יח'");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCurrency, setNewItemCurrency] = useState("ILS");
  const [addItemBusy, setAddItemBusy] = useState(false);
  const [addItemError, setAddItemError] = useState<string | null>(null);

  // Derived summary
  const summary = useMemo(() => {
    let exceptions = 0, totalDiffQty = 0, totalDiffValue = 0;
    for (const l of lines) {
      const sys = Number(l.systemQty) || 0;
      const cnt = Number(l.countedQty) || 0;
      const diff = round2(cnt - sys);
      const val = round2(diff * l.pricePerUnit);
      if (Math.abs(diff) > 0.001) exceptions++;
      totalDiffQty = round2(totalDiffQty + diff);
      totalDiffValue = round2(totalDiffValue + val);
    }
    return { totalItems: lines.length, exceptions, totalDiffQty, totalDiffValue };
  }, [lines]);

  const loadItems = useCallback(async () => {
    const res = await listInventoryItemsAction();
    if (res.ok) setItems(res.items);
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const res = await listInventoryCountsAction(50);
    if (res.ok) setHistory(res.counts);
    setLoadingHistory(false);
  }, []);

  const loadCharts = useCallback(async () => {
    const res = await getInventoryChartDataAction(12);
    if (res.ok) setChartData(res.points);
  }, []);

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => {
    if (tab === "history") void loadHistory();
    if (tab === "charts") void loadCharts();
  }, [tab, loadHistory, loadCharts]);

  function addItemToCount(item: InventoryItemDto) {
    if (lines.some((l) => l.itemId === item.id)) return;
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        pricePerUnit: item.pricePerUnit,
        currency: item.currency,
        systemQty: "0",
        countedQty: "0",
        notes: "",
      },
    ]);
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  function updateLine(itemId: string, field: "systemQty" | "countedQty" | "notes", value: string) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, [field]: value } : l)));
  }

  async function handleSave(submit = false) {
    setSaveError(null);
    setSaveSuccess(false);
    setSaveBusy(true);
    try {
      const res = await saveInventoryCountAction({
        id: editingCountId,
        weekCode,
        countDateYmd: countDate,
        notes: countNotes,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          systemQty: Number(l.systemQty) || 0,
          countedQty: Number(l.countedQty) || 0,
          notes: l.notes || null,
        })),
      });
      if (!res.ok) { setSaveError(res.error); return; }
      setEditingCountId(res.id);
      if (submit) {
        await submitInventoryCountAction(res.id);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      void loadHistory();
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleAddItem() {
    setAddItemError(null);
    setAddItemBusy(true);
    try {
      const res = await upsertInventoryItemAction({
        name: newItemName,
        unit: newItemUnit,
        pricePerUnit: newItemPrice,
        currency: newItemCurrency,
      });
      if (!res.ok) { setAddItemError(res.error); return; }
      await loadItems();
      setNewItemName(""); setNewItemUnit("יח'"); setNewItemPrice(""); setNewItemCurrency("ILS");
      setShowAddItem(false);
    } finally {
      setAddItemBusy(false);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm("למחוק מוצר זה מהקטלוג?")) return;
    await deleteInventoryItemAction(itemId);
    await loadItems();
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  async function handleViewDetail(countId: string) {
    setLoadingDetail(true);
    const res = await getInventoryCountDetailAction(countId);
    if (res.ok) setDetail(res.count);
    setLoadingDetail(false);
  }

  async function handleCompare() {
    if (!compareWeekA || !compareWeekB) return;
    setCompareLoading(true);
    setCompareError(null);
    const res = await compareInventoryWeeksAction(compareWeekA, compareWeekB);
    if (!res.ok) { setCompareError(res.error); setCompareLoading(false); return; }
    setCompareRows(res.rows);
    setCompareLoading(false);
  }

  function startNewCount() {
    setEditingCountId(null);
    setWeekCode(ACTIVE_WORK_WEEK_CODE);
    setCountDate(formatLocalYmd(new Date()));
    setCountNotes("");
    setLines([]);
    setSaveError(null);
    setSaveSuccess(false);
    setTab("count");
  }

  return (
    <div className="inv-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="inv-modal" role="dialog" aria-modal="true" aria-label="ספירת מלאי" dir="rtl">
        {/* Header */}
        <header className="inv-modal__header">
          <div className="inv-modal__title-row">
            <Package size={20} className="inv-modal__icon" />
            <h2 className="inv-modal__title">ספירת מלאי</h2>
          </div>
          <button className="inv-modal__close" onClick={onClose} aria-label="סגור"><X size={18} /></button>
        </header>

        {/* Tabs */}
        <nav className="inv-tabs" role="tablist">
          {([ ["count", <ClipboardList size={14} />, "ספירה חדשה"],
              ["history", <Clock size={14} />, "היסטוריה"],
              ["compare", <GitCompare size={14} />, "השוואת שבועות"],
              ["charts", <BarChart2 size={14} />, "גרפים"],
          ] as [Tab, React.ReactNode, string][]).map(([id, icon, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`inv-tab${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {icon} {label}
            </button>
          ))}
        </nav>

        <div className="inv-modal__body">

          {/* ── TAB: COUNT ─────────────────────────────────────────────── */}
          {tab === "count" && (
            <div className="inv-count">
              {/* Meta row */}
              <div className="inv-count__meta">
                <label className="inv-field">
                  <span>שבוע</span>
                  <input className="inv-input" value={weekCode} onChange={(e) => setWeekCode(e.target.value)} placeholder="AH-131" />
                </label>
                <label className="inv-field">
                  <span>תאריך</span>
                  <input type="date" className="inv-input" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
                </label>
                <label className="inv-field inv-field--wide">
                  <span>הערות</span>
                  <input className="inv-input" value={countNotes} onChange={(e) => setCountNotes(e.target.value)} placeholder="הערות לספירה..." />
                </label>
              </div>

              {/* Product catalog */}
              <div className="inv-catalog">
                <div className="inv-catalog__header">
                  <h3 className="inv-catalog__title">קטלוג מוצרים</h3>
                  <button className="inv-btn inv-btn--xs" onClick={() => setShowAddItem((v) => !v)}>
                    <Plus size={13} /> מוצר חדש
                  </button>
                </div>
                {showAddItem && (
                  <div className="inv-add-item-form">
                    <input className="inv-input inv-input--sm" placeholder="שם מוצר" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
                    <input className="inv-input inv-input--sm inv-input--narrow" placeholder="יחידה" value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)} />
                    <input className="inv-input inv-input--sm inv-input--narrow" placeholder="מחיר" type="number" value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} />
                    <select className="inv-select inv-select--sm" value={newItemCurrency} onChange={(e) => setNewItemCurrency(e.target.value)}>
                      <option value="ILS">₪</option>
                      <option value="USD">$</option>
                    </select>
                    <button className="inv-btn inv-btn--primary inv-btn--xs" disabled={addItemBusy} onClick={() => void handleAddItem()}>שמור</button>
                    <button className="inv-btn inv-btn--ghost inv-btn--xs" onClick={() => setShowAddItem(false)}>ביטול</button>
                    {addItemError && <span className="inv-err">{addItemError}</span>}
                  </div>
                )}
                <div className="inv-catalog__items">
                  {items.length === 0 && <p className="inv-empty">לא הוגדרו מוצרים. הוסף מוצר ראשון.</p>}
                  {items.map((item) => {
                    const inCount = lines.some((l) => l.itemId === item.id);
                    return (
                      <div key={item.id} className={`inv-catalog-item${inCount ? " is-added" : ""}`}>
                        <div className="inv-catalog-item__info">
                          <span className="inv-catalog-item__name">{item.name}</span>
                          <span className="inv-catalog-item__meta">{item.unit} · {fmtMoney(item.pricePerUnit, item.currency)}</span>
                        </div>
                        <div className="inv-catalog-item__actions">
                          {inCount
                            ? <span className="inv-badge inv-badge--added">✓ בספירה</span>
                            : <button className="inv-btn inv-btn--xs" onClick={() => addItemToCount(item)}><Plus size={12} /></button>
                          }
                          <button className="inv-btn inv-btn--xs inv-btn--danger" title="מחק מוצר" onClick={() => void handleDeleteItem(item.id)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Count table */}
              {lines.length > 0 && (
                <>
                  <div className="inv-table-wrap">
                    <table className="inv-table">
                      <thead>
                        <tr>
                          <th>מוצר</th>
                          <th>יחידה</th>
                          <th className="inv-th--num">כמות במערכת</th>
                          <th className="inv-th--num">כמות שנספרה</th>
                          <th className="inv-th--num">הפרש</th>
                          <th className="inv-th--num">ערך כספי</th>
                          <th className="inv-th--num">הערות</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => {
                          const sys = Number(l.systemQty) || 0;
                          const cnt = Number(l.countedQty) || 0;
                          const diff = round2(cnt - sys);
                          const val = round2(diff * l.pricePerUnit);
                          return (
                            <tr key={l.itemId} className={Math.abs(diff) > 0.001 ? "inv-tr--diff" : ""}>
                              <td className="inv-td--name">{l.itemName}</td>
                              <td>{l.unit}</td>
                              <td className="inv-td--num">
                                <input
                                  className="inv-input inv-input--cell"
                                  type="number"
                                  value={l.systemQty}
                                  onChange={(e) => updateLine(l.itemId, "systemQty", e.target.value)}
                                />
                              </td>
                              <td className="inv-td--num">
                                <input
                                  className="inv-input inv-input--cell inv-input--counted"
                                  type="number"
                                  value={l.countedQty}
                                  onChange={(e) => updateLine(l.itemId, "countedQty", e.target.value)}
                                />
                              </td>
                              <td className={`inv-td--num inv-diff${diff > 0 ? " inv-diff--pos" : diff < 0 ? " inv-diff--neg" : ""}`}>
                                {diff > 0 ? "+" : ""}{fmtNum(diff, 3)}
                              </td>
                              <td className={`inv-td--num inv-diff${val > 0 ? " inv-diff--pos" : val < 0 ? " inv-diff--neg" : ""}`}>
                                {val !== 0 ? (val > 0 ? "+" : "") + fmtMoney(val, l.currency) : "—"}
                              </td>
                              <td>
                                <input className="inv-input inv-input--cell" value={l.notes} onChange={(e) => updateLine(l.itemId, "notes", e.target.value)} placeholder="הערה..." />
                              </td>
                              <td>
                                <button className="inv-btn inv-btn--xs inv-btn--danger" onClick={() => removeLine(l.itemId)} title="הסר">
                                  <X size={12} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary */}
                  <div className="inv-summary">
                    <div className="inv-summary__kpi">
                      <span className="inv-summary__lbl">מוצרים</span>
                      <strong className="inv-summary__val">{summary.totalItems}</strong>
                    </div>
                    <div className="inv-summary__kpi">
                      <span className="inv-summary__lbl">חריגות</span>
                      <strong className={`inv-summary__val${summary.exceptions > 0 ? " inv-summary__val--warn" : ""}`}>{summary.exceptions}</strong>
                    </div>
                    <div className="inv-summary__kpi">
                      <span className="inv-summary__lbl">הפרש כמות</span>
                      <strong className={`inv-summary__val${summary.totalDiffQty !== 0 ? " inv-summary__val--diff" : ""}`}>
                        {summary.totalDiffQty > 0 ? "+" : ""}{fmtNum(summary.totalDiffQty, 2)}
                      </strong>
                    </div>
                    <div className="inv-summary__kpi">
                      <span className="inv-summary__lbl">הפרש כספי</span>
                      <strong className={`inv-summary__val${summary.totalDiffValue < 0 ? " inv-summary__val--neg" : summary.totalDiffValue > 0 ? " inv-summary__val--pos" : ""}`}>
                        {summary.totalDiffValue !== 0 ? (summary.totalDiffValue > 0 ? "+" : "") + fmtMoney(summary.totalDiffValue) : "—"}
                      </strong>
                    </div>
                  </div>
                </>
              )}

              {saveError && <div className="inv-err-banner">{saveError}</div>}
              {saveSuccess && <div className="inv-ok-banner">✓ הספירה נשמרה בהצלחה</div>}

              <div className="inv-count__footer">
                <button className="inv-btn inv-btn--ghost" onClick={startNewCount}>ספירה חדשה</button>
                <button className="inv-btn inv-btn--primary" disabled={saveBusy || lines.length === 0} onClick={() => void handleSave(false)}>
                  <Save size={14} /> {saveBusy ? "שומר…" : "שמירת טיוטה"}
                </button>
                <button className="inv-btn inv-btn--submit" disabled={saveBusy || lines.length === 0} onClick={() => void handleSave(true)}>
                  {saveBusy ? "שומר…" : "שמירה והגשה"}
                </button>
              </div>
            </div>
          )}

          {/* ── TAB: HISTORY ───────────────────────────────────────────── */}
          {tab === "history" && (
            <div className="inv-history">
              <div className="inv-history__toolbar">
                <h3>היסטוריית ספירות</h3>
                <button className="inv-btn inv-btn--ghost inv-btn--xs" onClick={() => void loadHistory()}>רענן</button>
              </div>
              {loadingHistory ? <p className="inv-loading">טוען…</p> : (
                <>
                  {history.length === 0 && <p className="inv-empty">אין ספירות שמורות.</p>}
                  <div className="inv-table-wrap">
                    <table className="inv-table">
                      <thead>
                        <tr>
                          <th>שבוע</th>
                          <th>תאריך</th>
                          <th>מבצע</th>
                          <th className="inv-th--num">מוצרים</th>
                          <th className="inv-th--num">חריגות</th>
                          <th className="inv-th--num">הפרש כספי</th>
                          <th>סטטוס</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((c) => (
                          <tr key={c.id}>
                            <td dir="ltr">{c.weekCode}</td>
                            <td dir="ltr">{c.countDateYmd}</td>
                            <td>{c.createdByName ?? "—"}</td>
                            <td className="inv-td--num">{c.totalItems}</td>
                            <td className={`inv-td--num${c.exceptions > 0 ? " inv-diff--neg" : ""}`}>{c.exceptions}</td>
                            <td className={`inv-td--num${c.totalDiffValue < 0 ? " inv-diff--neg" : c.totalDiffValue > 0 ? " inv-diff--pos" : ""}`}>
                              {c.totalDiffValue !== 0 ? (c.totalDiffValue > 0 ? "+" : "") + fmtMoney(c.totalDiffValue) : "—"}
                            </td>
                            <td><span className={statusClass(c.status)}>{statusLabel(c.status)}</span></td>
                            <td>
                              <button className="inv-btn inv-btn--xs" onClick={() => void handleViewDetail(c.id)}>צפה</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Detail panel */}
              {loadingDetail && <p className="inv-loading">טוען פרטים…</p>}
              {detail && (
                <div className="inv-detail">
                  <div className="inv-detail__header">
                    <h4>פרטי ספירה — {detail.weekCode} · {detail.countDateYmd}</h4>
                    <button className="inv-btn inv-btn--xs inv-btn--ghost" onClick={() => setDetail(null)}>סגור</button>
                  </div>
                  <div className="inv-summary inv-summary--sm">
                    <div className="inv-summary__kpi"><span className="inv-summary__lbl">מוצרים</span><strong>{detail.totalItems}</strong></div>
                    <div className="inv-summary__kpi"><span className="inv-summary__lbl">חריגות</span><strong className={detail.exceptions > 0 ? "inv-summary__val--warn" : ""}>{detail.exceptions}</strong></div>
                    <div className="inv-summary__kpi"><span className="inv-summary__lbl">הפרש כספי</span><strong>{detail.totalDiffValue !== 0 ? (detail.totalDiffValue > 0 ? "+" : "") + fmtMoney(detail.totalDiffValue) : "—"}</strong></div>
                    <div className="inv-summary__kpi"><span className="inv-summary__lbl">סטטוס</span><strong>{statusLabel(detail.status)}</strong></div>
                  </div>
                  <div className="inv-table-wrap">
                    <table className="inv-table">
                      <thead>
                        <tr><th>מוצר</th><th>יח'</th><th className="inv-th--num">מערכת</th><th className="inv-th--num">נספר</th><th className="inv-th--num">הפרש</th><th className="inv-th--num">ערך</th></tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((l) => (
                          <tr key={l.itemId} className={Math.abs(l.diffQty) > 0.001 ? "inv-tr--diff" : ""}>
                            <td>{l.itemName}</td>
                            <td>{l.unit}</td>
                            <td className="inv-td--num">{fmtNum(l.systemQty, 3)}</td>
                            <td className="inv-td--num">{fmtNum(l.countedQty, 3)}</td>
                            <td className={`inv-td--num${l.diffQty > 0 ? " inv-diff--pos" : l.diffQty < 0 ? " inv-diff--neg" : ""}`}>
                              {l.diffQty !== 0 ? (l.diffQty > 0 ? "+" : "") + fmtNum(l.diffQty, 3) : "—"}
                            </td>
                            <td className={`inv-td--num${l.diffValue < 0 ? " inv-diff--neg" : l.diffValue > 0 ? " inv-diff--pos" : ""}`}>
                              {l.diffValue !== 0 ? (l.diffValue > 0 ? "+" : "") + fmtMoney(l.diffValue, l.currency) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: COMPARE ───────────────────────────────────────────── */}
          {tab === "compare" && (
            <div className="inv-compare">
              <div className="inv-compare__controls">
                <label className="inv-field">
                  <span>שבוע א'</span>
                  <input className="inv-input" value={compareWeekA} onChange={(e) => setCompareWeekA(e.target.value)} placeholder="AH-130" />
                </label>
                <span className="inv-compare__vs">vs.</span>
                <label className="inv-field">
                  <span>שבוע ב'</span>
                  <input className="inv-input" value={compareWeekB} onChange={(e) => setCompareWeekB(e.target.value)} placeholder="AH-131" />
                </label>
                <button className="inv-btn inv-btn--primary" disabled={compareLoading || !compareWeekA || !compareWeekB} onClick={() => void handleCompare()}>
                  {compareLoading ? "משווה…" : "השווה"}
                </button>
              </div>
              {compareError && <div className="inv-err-banner">{compareError}</div>}
              {compareRows.length > 0 && (
                <div className="inv-table-wrap">
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th>מוצר</th>
                        <th>יח'</th>
                        <th className="inv-th--num">שבוע א' — נספר</th>
                        <th className="inv-th--num">שבוע א' — הפרש</th>
                        <th className="inv-th--num">שבוע ב' — נספר</th>
                        <th className="inv-th--num">שבוע ב' — הפרש</th>
                        <th className="inv-th--num">שינוי כמות</th>
                        <th className="inv-th--num">שינוי ערך</th>
                        <th>מגמה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((r) => (
                        <tr key={r.itemId}>
                          <td>{r.itemName}</td>
                          <td>{r.unit}</td>
                          <td className="inv-td--num">{r.weekA ? fmtNum(r.weekA.countedQty, 2) : "—"}</td>
                          <td className={`inv-td--num${r.weekA && r.weekA.diffQty !== 0 ? r.weekA.diffQty > 0 ? " inv-diff--pos" : " inv-diff--neg" : ""}`}>
                            {r.weekA ? (r.weekA.diffQty > 0 ? "+" : "") + fmtNum(r.weekA.diffQty, 2) : "—"}
                          </td>
                          <td className="inv-td--num">{r.weekB ? fmtNum(r.weekB.countedQty, 2) : "—"}</td>
                          <td className={`inv-td--num${r.weekB && r.weekB.diffQty !== 0 ? r.weekB.diffQty > 0 ? " inv-diff--pos" : " inv-diff--neg" : ""}`}>
                            {r.weekB ? (r.weekB.diffQty > 0 ? "+" : "") + fmtNum(r.weekB.diffQty, 2) : "—"}
                          </td>
                          <td className={`inv-td--num${r.changeQty !== null && r.changeQty !== 0 ? r.changeQty > 0 ? " inv-diff--pos" : " inv-diff--neg" : ""}`}>
                            {r.changeQty !== null ? (r.changeQty > 0 ? "+" : "") + fmtNum(r.changeQty, 2) : "—"}
                          </td>
                          <td className={`inv-td--num${r.changeValue !== null && r.changeValue !== 0 ? r.changeValue > 0 ? " inv-diff--pos" : " inv-diff--neg" : ""}`}>
                            {r.changeValue !== null && r.changeValue !== 0 ? (r.changeValue > 0 ? "+" : "") + fmtMoney(r.changeValue) : "—"}
                          </td>
                          <td className="inv-trend">
                            {r.trend === "up" ? "📈 עלייה" : r.trend === "down" ? "📉 ירידה" : r.trend === "stable" ? "➡️ יציב" : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: CHARTS ────────────────────────────────────────────── */}
          {tab === "charts" && (
            <div className="inv-charts">
              {chartData.length === 0 && <p className="inv-empty">אין נתוני ספירות לגרפים.</p>}
              {chartData.length > 0 && (
                <>
                  <div className="inv-chart-block">
                    <h3 className="inv-chart-title">חריגות לפי שבוע</h3>
                    <MiniBarChart points={chartData} field="exceptions" />
                  </div>
                  <div className="inv-chart-block">
                    <h3 className="inv-chart-title">הפרש כספי לפי שבוע (ערך מוחלט)</h3>
                    <MiniBarChart points={chartData} field="totalDiffValue" />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
