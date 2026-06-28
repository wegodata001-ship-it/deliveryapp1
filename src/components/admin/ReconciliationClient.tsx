"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Pencil,
  Scale,
  X,
} from "lucide-react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import {
  reconcile,
  RECON_STATUS_STYLE,
  RECON_THRESHOLDS,
  type ExternalReconRow,
  type ReconResultRow,
  type ReconSeverity,
  type SystemOrderForRecon,
} from "@/lib/controls/reconcile-core";
import {
  loadWegoOrdersAction,
  reconcileUpdateOrderAction,
  type ReconcileEditInput,
} from "@/app/admin/reconciliation/actions";

type CountryOpt = { value: string; label: string };

const COUNTRY_OPTIONS: CountryOpt[] = [
  { value: "TR", label: "טורקיה" },
  { value: "CN", label: "סין" },
  { value: "AE", label: "איחוד האמירויות" },
  { value: "JO", label: "ירדן" },
];

const STATUS_CLS: Record<ReconSeverity, string> = {
  MATCHED: "matched",
  DIFF_SMALL: "small",
  DIFF_MEDIUM: "medium",
  DIFF_SEVERE: "severe",
  MISSING_IN_SYSTEM: "missing-system",
  MISSING_IN_EXTERNAL: "missing-file",
};

function statusLabel(s: ReconSeverity): string {
  return RECON_STATUS_STYLE[s].label;
}
function statusEmoji(s: ReconSeverity): string {
  return RECON_STATUS_STYLE[s].emoji;
}

function sumAmounts(items: { amount: number | null }[]): number {
  return items.reduce((s, x) => s + (x.amount ?? 0), 0);
}

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 16 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  if (!out.includes("AH-125")) out.push("AH-125");
  return out;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rowKey(r: ReconResultRow, i: number): string {
  return `${r.orderId ?? r.systemOrderNumber ?? r.externalOrderNumber ?? "row"}:${r.externalCustomerCode ?? r.systemCustomerCode ?? ""}:${i}`;
}

export function ReconciliationClient({ canEdit }: { canEdit: boolean }) {
  const { openWindow, stack } = useAdminWindows();
  const weekOptions = useMemo(buildWeekOptions, []);
  const [country, setCountry] = useState("TR");
  const [week, setWeek] = useState(weekOptions.includes("AH-125") ? "AH-125" : weekOptions[0]);

  const [wegoOrders, setWegoOrders] = useState<SystemOrderForRecon[] | null>(null);
  const [wegoLoading, setWegoLoading] = useState(false);
  const [wegoError, setWegoError] = useState<string | null>(null);

  const [extRows, setExtRows] = useState<ExternalReconRow[] | null>(null);
  const [extFileName, setExtFileName] = useState<string | null>(null);
  const [extWeekDetected, setExtWeekDetected] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [editRow, setEditRow] = useState<ReconResultRow | null>(null);
  const [detailRow, setDetailRow] = useState<ReconResultRow | null>(null);
  const [exporting, setExporting] = useState<null | "pdf" | "excel">(null);

  // עימוד — תצוגה בלבד, אינו משפיע על ההתאמה/החישובים
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // בדיקת שבוע — חוסם התאמה אם השבוע בקובץ שונה מהנבחר
  const weekMismatch = extWeekDetected != null && extWeekDetected !== week;

  // סיכומי מקור — ספירה + סך סכומים
  const wegoCount = wegoOrders?.length ?? 0;
  const wegoSum = useMemo(() => (wegoOrders ? sumAmounts(wegoOrders) : 0), [wegoOrders]);
  const extCount = extRows?.length ?? 0;
  const extSum = useMemo(() => (extRows ? sumAmounts(extRows) : 0), [extRows]);
  const diffSum = Math.round((wegoSum - extSum) * 100) / 100;
  const countDiff = wegoCount - extCount;

  // התאמה מקומית — מחושבת מחדש בכל שינוי (כולל לאחר תיקון שורה) ללא רענון שרת
  const recon = useMemo(() => {
    if (!wegoOrders || !extRows || weekMismatch) return null;
    return reconcile(wegoOrders, extRows);
  }, [wegoOrders, extRows, weekMismatch]);

  // עימוד תצוגה — חיתוך השורות להצגה בלבד (KPI/סיכומים עדיין על כלל הרשומות)
  const totalRows = recon?.rows.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageStart = totalRows === 0 ? 0 : (curPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalRows);
  const pagedRows = useMemo(
    () => (recon ? recon.rows.slice(pageStart, pageEnd) : []),
    [recon, pageStart, pageEnd],
  );

  const kpis = recon?.kpis ?? null;
  const allMatched =
    kpis != null &&
    kpis.diffSmall === 0 &&
    kpis.diffMedium === 0 &&
    kpis.diffSevere === 0 &&
    kpis.missingSystem === 0 &&
    kpis.missingExternal === 0 &&
    (kpis.matched > 0);

  async function onLoadWego() {
    setWegoLoading(true);
    setWegoError(null);
    try {
      const res = await loadWegoOrdersAction(week, country);
      if (!res.ok) {
        setWegoError(res.error);
        setWegoOrders(null);
        return;
      }
      setWegoOrders(res.orders);
    } catch {
      setWegoError("שגיאה בשליפת נתוני WEGO");
    } finally {
      setWegoLoading(false);
    }
  }

  // פתיחת ההזמנה במסך קליטה מלא (חלון orderCapture במצב עריכה) — טוען את כל הנתונים
  const fullEditorWinIdRef = useRef<string | null>(null);
  function openFullEditor(row: ReconResultRow) {
    if (!row.orderId) return;
    const id = openWindow({
      type: "orderCapture",
      props: { mode: "edit", orderId: row.orderId, orderNumber: row.systemOrderNumber },
    });
    fullEditorWinIdRef.current = id;
    setEditRow(null);
    setDetailRow(null);
  }

  // כאשר חלון הקליטה המלא נסגר — רענון נתוני WEGO בלבד (ללא רענון מסך / איבוד מיקום).
  // ההתאמה וה-KPI מחושבים מחדש מקומית דרך useMemo.
  useEffect(() => {
    const openedId = fullEditorWinIdRef.current;
    if (!openedId) return;
    const stillOpen = stack.some((w) => w.id === openedId);
    if (!stillOpen) {
      fullEditorWinIdRef.current = null;
      void onLoadWego();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setFileLoading(true);
    setFileError(null);
    setExtRows(null);
    setExtWeekDetected(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/controls/reconciliation", { method: "POST", body: fd, credentials: "same-origin" });
      const data = (await res.json()) as
        | { ok: true; rows: ExternalReconRow[]; weekDetected: string | null; fileName: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setFileError(data.error);
        return;
      }
      setExtRows(data.rows);
      setExtWeekDetected(data.weekDetected);
      setExtFileName(data.fileName);
    } catch {
      setFileError("שגיאה בקריאת הקובץ");
    } finally {
      setFileLoading(false);
    }
  }

  function clearFile() {
    setExtRows(null);
    setExtFileName(null);
    setExtWeekDetected(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // עדכון שורה בלבד לאחר תיקון — מחליף את ההזמנה ב-state, ההתאמה מחושבת מחדש מקומית
  function applyOrderUpdate(updated: SystemOrderForRecon) {
    setWegoOrders((prev) =>
      (prev ?? []).map((o) => (o.orderId === updated.orderId ? updated : o)),
    );
  }

  async function onExport(format: "pdf" | "excel") {
    if (!recon) return;
    setExporting(format);
    try {
      const res = await fetch("/api/controls/reconciliation/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          week,
          format,
          rows: recon.rows,
          kpis: recon.kpis,
          summary: { wegoCount, wegoSum, extCount, extSum, diffSum, countDiff },
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === "excel") {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Reconciliation_${week}.xlsx`;
        a.click();
      } else {
        window.open(url, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="adm-recon" dir="rtl">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">
          <Scale size={18} aria-hidden /> התאמת מערכות
        </h1>
      </div>

      {/* שלב 1 — בחירת מקור הנתונים */}
      <div className="adm-recon-sources">
        <section className="adm-recon-src">
          <h2 className="adm-recon-src__title">
            <Database size={16} aria-hidden /> שליפה מתוך WEGO
          </h2>
          <div className="adm-recon-src__row">
            <label className="adm-orders-filter-field">
              <span className="adm-orders-filter-label">מדינה</span>
              <select
                value={country}
                onChange={(e) => { setCountry(e.target.value); setWegoOrders(null); }}
                className="adm-orders-week-sel adm-orders-sel-arrow"
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="adm-orders-filter-field">
              <span className="adm-orders-filter-label">שבוע עבודה</span>
              <select
                value={week}
                onChange={(e) => { setWeek(e.target.value); setWegoOrders(null); }}
                className="adm-orders-week-sel adm-orders-sel-arrow"
              >
                {weekOptions.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </label>
            <button type="button" className="adm-btn adm-btn--primary" disabled={wegoLoading} onClick={() => void onLoadWego()}>
              {wegoLoading ? "שולף…" : "שלוף נתונים"}
            </button>
          </div>
          {wegoError ? <p className="adm-orders-inline-err" role="alert">{wegoError}</p> : null}
          {wegoOrders ? (
            <div className="adm-recon-src__stats">
              <span>שבוע: <strong>{week}</strong></span>
              <span>הזמנות: <strong>{wegoCount}</strong></span>
              <span>סך סכומים: <strong dir="ltr">{fmtUsd(wegoSum)}</strong></span>
            </div>
          ) : null}
        </section>

        <section className="adm-recon-src">
          <h2 className="adm-recon-src__title">
            <FileSpreadsheet size={16} aria-hidden /> העלאת קובץ Excel
          </h2>
          <div className="adm-recon-src__row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onPickFile}
              className="adm-recon-file__input"
            />
            <button type="button" className="adm-btn adm-btn--ghost" disabled={fileLoading} onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={15} aria-hidden /> {fileLoading ? "קורא…" : extFileName ? "החלף קובץ" : "בחר קובץ"}
            </button>
            <span className="adm-recon-file__name">{extFileName ?? "לא נבחר קובץ"}</span>
            {extFileName ? (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearFile}>
                <X size={13} aria-hidden /> נקה
              </button>
            ) : null}
          </div>
          {fileError ? <p className="adm-orders-inline-err" role="alert">{fileError}</p> : null}
          {extRows ? (
            <div className="adm-recon-src__stats">
              <span>שבוע בקובץ: <strong>{extWeekDetected ?? "—"}</strong></span>
              <span>רשומות: <strong>{extCount}</strong></span>
              <span>סך סכומים: <strong dir="ltr">{fmtUsd(extSum)}</strong></span>
            </div>
          ) : null}
        </section>
      </div>

      {/* שלב 2 — בדיקת שבוע (חוסם) */}
      {weekMismatch ? (
        <div className="adm-recon-weekerr" role="alert">
          <div className="adm-recon-weekerr__icon"><AlertTriangle size={28} aria-hidden /></div>
          <div className="adm-recon-weekerr__body">
            <h3>שבוע העבודה שנבחר אינו תואם לשבוע שנמצא בקובץ</h3>
            <div className="adm-recon-weekerr__cmp">
              <span>WEGO: <strong>{week}</strong></span>
              <span>Excel: <strong>{extWeekDetected}</strong></span>
            </div>
            <p className="adm-recon-weekerr__prompt">
              נמצאו נתונים לשבוע <strong>{extWeekDetected}</strong>. האם ברצונך לעבור לשבוע זה?
            </p>
            <div className="adm-recon-weekerr__btns">
              <button type="button" className="adm-btn adm-btn--primary" onClick={() => setWeek(extWeekDetected ?? week)}>
                <ArrowRight size={14} aria-hidden /> עבור ל-{extWeekDetected}
              </button>
              <button type="button" className="adm-btn adm-btn--ghost" onClick={clearFile}>
                הישאר ב-{week}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* שלב 3-4 — סיכום עליון: WEGO / Excel / הפרש כולל */}
      {recon ? (
        <div className="adm-recon-summary">
          <div className="adm-recon-sumcard adm-recon-sumcard--wego">
            <span className="adm-recon-sumcard__t">WEGO</span>
            <div className="adm-recon-sumcard__row"><span>מספר הזמנות</span><strong>{wegoCount}</strong></div>
            <div className="adm-recon-sumcard__row"><span>סך סכומים</span><strong dir="ltr">{fmtUsd(wegoSum)}</strong></div>
          </div>
          <div className="adm-recon-sumcard adm-recon-sumcard--excel">
            <span className="adm-recon-sumcard__t">Excel</span>
            <div className="adm-recon-sumcard__row"><span>מספר רשומות</span><strong>{extCount}</strong></div>
            <div className="adm-recon-sumcard__row"><span>סך סכומים</span><strong dir="ltr">{fmtUsd(extSum)}</strong></div>
          </div>
          <div className={`adm-recon-sumcard adm-recon-sumcard--diff ${Math.abs(diffSum) <= RECON_THRESHOLDS.epsilon && countDiff === 0 ? "is-ok" : "is-warn"}`}>
            <span className="adm-recon-sumcard__t">הפרש כולל</span>
            <div className="adm-recon-sumcard__row"><span>הפרש כספי</span><strong dir="ltr">{fmtUsd(diffSum)}</strong></div>
            <div className="adm-recon-sumcard__row">
              <span>הפרש במספר</span>
              <strong>
                {countDiff === 0
                  ? "תואם"
                  : countDiff > 0
                    ? `${countDiff} חסרות בקובץ`
                    : `${Math.abs(countDiff)} חסרות ב-WEGO`}
              </strong>
            </div>
          </div>
        </div>
      ) : null}

      {/* שלב 6 — KPI */}
      {recon ? (
        <div className="adm-recon-kpi-row">
          <KpiCard label="סה״כ רשומות (קובץ)" value={kpis!.externalTotal} tone="total" />
          <KpiCard label="תואם" value={kpis!.matched} tone="matched" dot="🟢" />
          <KpiCard label="הפרשים קטנים" value={kpis!.diffSmall} tone="small" dot="🟡" />
          <KpiCard label="חריגות" value={kpis!.diffMedium} tone="medium" dot="🟠" />
          <KpiCard label="הפרשים חמורים" value={kpis!.diffSevere} tone="severe" dot="🔴" />
          <KpiCard label="לא נמצאו" value={kpis!.missingSystem + kpis!.missingExternal} tone="missing" dot="⚫" />
        </div>
      ) : null}

      {/* שלב 8 — השלמה */}
      {allMatched ? (
        <div className="adm-recon-done" role="status">
          <CheckCircle2 size={22} aria-hidden /> כל ההזמנות תואמות — 100% ✔
        </div>
      ) : null}

      {/* שלב 3-5 — טבלת התאמה */}
      {!weekMismatch ? (
        <div className="adm-recon-tablecard">
          <div className="adm-recon-tablecard__head">
            <h2>
              טבלת התאמה — {week}
              <span className="adm-recon-thresholds">
                (תואם 0$ · הפרש קטן ≤{RECON_THRESHOLDS.small}$ · חריגה ≤{RECON_THRESHOLDS.medium}$ · חמור &gt;{RECON_THRESHOLDS.medium}$)
              </span>
            </h2>
            {recon && recon.rows.length > 0 ? (
              <div className="adm-recon-exports">
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={exporting != null} onClick={() => void onExport("pdf")}>
                  <FileText size={13} aria-hidden /> {exporting === "pdf" ? "מייצא…" : "ייצוא PDF"}
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={exporting != null} onClick={() => void onExport("excel")}>
                  <FileDown size={13} aria-hidden /> {exporting === "excel" ? "מייצא…" : "ייצוא Excel"}
                </button>
              </div>
            ) : null}
          </div>
          {!recon ? (
            wegoOrders || extRows ? (
              <div className="adm-recon-previews">
                {wegoOrders ? <WegoPreviewTable rows={wegoOrders} week={week} /> : null}
                {extRows ? <ExtPreviewTable rows={extRows} weekDetected={extWeekDetected} /> : null}
                <p className="adm-recon-previews__hint">
                  טען את שני המקורות (WEGO + Excel) לאותו שבוע כדי להתחיל התאמה אוטומטית.
                </p>
              </div>
            ) : (
              <div className="adm-table-excel-wrap">
                <p className="adm-table-empty" style={{ padding: "28px 12px", textAlign: "center" }}>
                  טען נתונים מ-WEGO והעלה קובץ Excel כדי להתחיל התאמה.
                </p>
              </div>
            )
          ) : (
          <>
          <div className="adm-recon-tablebar">
            <span className="adm-recon-tablebar__count">
              {totalRows === 0 ? "אין רשומות" : `מציג ${pageStart + 1}–${pageEnd} מתוך ${totalRows} רשומות`}
            </span>
            <label className="adm-recon-tablebar__size">
              <span>שורות לעמוד</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="adm-orders-sel-arrow"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          <div className="adm-table-excel-wrap adm-recon-tablescroll">
            <table className="adm-table-excel adm-recon-table">
              <thead>
                <tr>
                  <th>סטטוס</th>
                  <th>מס׳ הזמנה (WEGO)</th>
                  <th>External ID</th>
                  <th>קוד לקוח</th>
                  <th>שם לקוח</th>
                  <th>סכום WEGO</th>
                  <th>סכום Excel</th>
                  <th>הפרש</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {recon.rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="adm-table-empty">לא נמצאו רשומות להתאמה עבור שבוע {week}.</td>
                  </tr>
                ) : (
                  pagedRows.map((r, i) => {
                    const cls = STATUS_CLS[r.status];
                    const codeMismatch =
                      r.systemCustomerCode && r.externalCustomerCode &&
                      r.systemCustomerCode.trim().toLowerCase() !== r.externalCustomerCode.trim().toLowerCase();
                    return (
                      <tr
                        key={rowKey(r, i)}
                        className={`adm-table-excel-row adm-recon-row--${cls} adm-recon-row--click`}
                        onClick={() => setDetailRow(r)}
                      >
                        <td>
                          <span className={`adm-recon-tag adm-recon-tag--${cls}`}>
                            <span aria-hidden>{statusEmoji(r.status)}</span> {statusLabel(r.status)}
                          </span>
                        </td>
                        <td dir="ltr" className="adm-table-excel-num">{r.systemOrderNumber ?? "—"}</td>
                        <td dir="ltr" className="adm-table-excel-num">{r.externalOrderNumber ?? r.systemExternalId ?? "—"}</td>
                        <td dir="ltr" className="adm-table-excel-num">
                          {r.systemCustomerCode ?? r.externalCustomerCode ?? "—"}
                          {codeMismatch ? <span className="adm-recon-flag" title={`קובץ: ${r.externalCustomerCode}`}>≠</span> : null}
                        </td>
                        <td>
                          {r.customerName ?? r.externalCustomerName ?? "—"}
                          {r.nameMismatch ? <span className="adm-recon-flag" title={`קובץ: ${r.externalCustomerName}`}>≠</span> : null}
                        </td>
                        <td dir="ltr" className="adm-table-excel-num">{fmtUsd(r.systemAmount)}</td>
                        <td dir="ltr" className="adm-table-excel-num">{fmtUsd(r.externalAmount)}</td>
                        <td dir="ltr" className="adm-table-excel-num">{r.diff == null ? "—" : fmtUsd(r.diff)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {r.orderId && canEdit ? (
                            <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => setEditRow(r)}>
                              <Pencil size={13} aria-hidden /> ערוך
                            </button>
                          ) : (
                            <span className="adm-recon-noedit">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="adm-recon-pager">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--xs"
                disabled={curPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹ הקודם
              </button>
              <span className="adm-recon-pager__info">עמוד {curPage} מתוך {totalPages}</span>
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--xs"
                disabled={curPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                הבא ›
              </button>
            </div>
          ) : null}
          </>
          )}
        </div>
      ) : null}

      {editRow ? (
        <EditDrawer
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={(updated) => { applyOrderUpdate(updated); setEditRow(null); }}
          onOpenFullScreen={() => openFullEditor(editRow)}
        />
      ) : null}

      {detailRow ? (
        <DetailModal
          row={detailRow}
          canEdit={canEdit}
          onClose={() => setDetailRow(null)}
          onEdit={() => { setEditRow(detailRow); setDetailRow(null); }}
        />
      ) : null}
    </div>
  );
}

function DetailModal({
  row,
  canEdit,
  onClose,
  onEdit,
}: {
  row: ReconResultRow;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const st = RECON_STATUS_STYLE[row.status];
  return (
    <div className="adm-recon-modal-backdrop" onClick={onClose}>
      <div className="adm-recon-modal" dir="rtl" role="dialog" aria-label="פירוט התאמה" onClick={(e) => e.stopPropagation()}>
        <div className="adm-recon-modal__head">
          <h3>פירוט התאמה</h3>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="סגור"><X size={18} /></button>
        </div>
        <div className="adm-recon-modal__body">
          <div className="adm-recon-modal__sides">
            <div className="adm-recon-modal__side">
              <h4><Database size={14} aria-hidden /> WEGO</h4>
              <DetailField label="מספר הזמנה" value={row.systemOrderNumber} ltr />
              <DetailField label="קוד לקוח" value={row.systemCustomerCode} ltr />
              <DetailField label="שם לקוח" value={row.customerName} />
              <DetailField label="סכום" value={fmtUsd(row.systemAmount)} ltr />
            </div>
            <div className="adm-recon-modal__side">
              <h4><FileSpreadsheet size={14} aria-hidden /> Excel</h4>
              <DetailField label="External ID" value={row.externalOrderNumber} ltr />
              <DetailField label="Customer Code" value={row.externalCustomerCode} ltr />
              <DetailField label="Customer Name" value={row.externalCustomerName} />
              <DetailField label="Amount" value={fmtUsd(row.externalAmount)} ltr />
            </div>
          </div>
          <div className="adm-recon-modal__status">
            <span>סטטוס ההתאמה:</span>
            <span className="adm-recon-tag" style={{ background: st.bg, color: st.fg }}>
              <span aria-hidden>{st.emoji}</span> {st.label}
            </span>
            {row.diff != null ? <span className="adm-recon-modal__diff" dir="ltr">הפרש: {fmtUsd(row.diff)}</span> : null}
          </div>
        </div>
        <div className="adm-recon-modal__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>סגור</button>
          {row.orderId && canEdit ? (
            <button type="button" className="adm-btn adm-btn--primary" onClick={onEdit}>
              <Pencil size={14} aria-hidden /> ערוך הזמנה
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="adm-recon-modal__field">
      <span>{label}</span>
      <strong dir={ltr ? "ltr" : undefined}>{value ?? "—"}</strong>
    </div>
  );
}

function WegoPreviewTable({ rows, week }: { rows: SystemOrderForRecon[]; week: string }) {
  return (
    <div className="adm-recon-preview">
      <h3 className="adm-recon-preview__title">
        <Database size={14} aria-hidden /> נתוני WEGO — {week} ({rows.length})
      </h3>
      <div className="adm-table-excel-wrap">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>מספר הזמנה</th>
              <th>External ID</th>
              <th>קוד לקוח</th>
              <th>שם לקוח</th>
              <th>סכום</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.orderId ?? o.orderNumber} className="adm-table-excel-row">
                <td dir="ltr" className="adm-table-excel-num">{o.orderNumber ?? "—"}</td>
                <td dir="ltr" className="adm-table-excel-num">{o.externalOrderId ?? "—"}</td>
                <td dir="ltr" className="adm-table-excel-num">{o.customerCode ?? "—"}</td>
                <td>{o.customerName ?? "—"}</td>
                <td dir="ltr" className="adm-table-excel-num">{fmtUsd(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExtPreviewTable({ rows, weekDetected }: { rows: ExternalReconRow[]; weekDetected: string | null }) {
  return (
    <div className="adm-recon-preview">
      <h3 className="adm-recon-preview__title">
        <FileSpreadsheet size={14} aria-hidden /> נתוני Excel{weekDetected ? ` — ${weekDetected}` : ""} ({rows.length})
      </h3>
      <div className="adm-table-excel-wrap">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>External ID</th>
              <th>Customer Code</th>
              <th>Customer Name</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.externalId ?? r.customerCode ?? "row"}-${i}`} className="adm-table-excel-row">
                <td dir="ltr" className="adm-table-excel-num">{r.externalId ?? "—"}</td>
                <td dir="ltr" className="adm-table-excel-num">{r.customerCode ?? "—"}</td>
                <td>{r.customerName ?? "—"}</td>
                <td dir="ltr" className="adm-table-excel-num">{fmtUsd(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone, dot }: { label: string; value: number; tone: string; dot?: string }) {
  return (
    <div className={`adm-recon-kpi adm-recon-kpi--${tone}`}>
      <span className="adm-recon-kpi__head">{dot ? <span aria-hidden>{dot}</span> : null} {label}</span>
      <strong className="adm-recon-kpi__count">{value}</strong>
    </div>
  );
}

function EditDrawer({
  row,
  onClose,
  onSaved,
  onOpenFullScreen,
}: {
  row: ReconResultRow;
  onClose: () => void;
  onSaved: (updated: SystemOrderForRecon) => void;
  onOpenFullScreen: () => void;
}) {
  const [orderNumber, setOrderNumber] = useState(row.systemOrderNumber ?? "");
  const [customerCode, setCustomerCode] = useState(row.systemCustomerCode ?? "");
  const [customerName, setCustomerName] = useState(row.customerName ?? "");
  const [amount, setAmount] = useState(row.systemAmount != null ? String(row.systemAmount) : "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestExt = row.externalAmount;

  async function onSave() {
    if (!row.orderId) return;
    setSaving(true);
    setError(null);
    const amtNum = amount.trim() === "" ? null : Number(amount.replace(",", "."));
    const input: ReconcileEditInput = {
      orderId: row.orderId,
      amount: amtNum != null && Number.isFinite(amtNum) ? amtNum : null,
      customerCode: customerCode.trim() || null,
      customerName: customerName.trim() || null,
      orderNumber: orderNumber.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const res = await reconcileUpdateOrderAction(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved(res.order);
    } catch {
      setError("שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="adm-recon-drawer-backdrop" onClick={onClose} />
      <aside className="adm-recon-drawer" dir="rtl" role="dialog" aria-label="עריכת הזמנה">
        <div className="adm-recon-drawer__head">
          <h3><Pencil size={16} aria-hidden /> עריכה מהירה</h3>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="סגור"><X size={18} /></button>
        </div>
        {row.orderId ? (
          <div className="adm-recon-drawer__modes">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--block" onClick={onOpenFullScreen}>
              <ExternalLink size={14} aria-hidden /> פתח במסך קליטת הזמנה
            </button>
            <span className="adm-recon-drawer__modes-hint">עריכה מלאה: פריטים, תשלומים, מסמכים וכל השדות</span>
          </div>
        ) : null}
        <div className="adm-recon-drawer__body">
          {suggestExt != null ? (
            <div className="adm-recon-drawer__hint">
              סכום בקובץ Excel: <strong dir="ltr">{fmtUsd(suggestExt)}</strong>
              {row.systemAmount != null && row.diff != null && Math.abs(row.diff) > RECON_THRESHOLDS.epsilon ? (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => setAmount(String(suggestExt))}>
                  <Download size={12} aria-hidden /> השווה לקובץ
                </button>
              ) : null}
            </div>
          ) : null}

          <label className="adm-recon-drawer__field">
            <span>מספר הזמנה</span>
            <input dir="ltr" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </label>
          <label className="adm-recon-drawer__field">
            <span>קוד לקוח</span>
            <input dir="ltr" value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} />
          </label>
          <label className="adm-recon-drawer__field">
            <span>שם לקוח</span>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label className="adm-recon-drawer__field">
            <span>סכום ($)</span>
            <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="adm-recon-drawer__field">
            <span>הערות</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>

          {error ? <p className="adm-orders-inline-err" role="alert">{error}</p> : null}
          <p className="adm-recon-drawer__audit">כל שינוי מתועד ביומן הפעולות (Audit) עם ערך קודם/חדש ומבצע השינוי.</p>
        </div>
        <div className="adm-recon-drawer__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? "שומר…" : "שמור והתאם מחדש"}
          </button>
        </div>
      </aside>
    </>
  );
}
