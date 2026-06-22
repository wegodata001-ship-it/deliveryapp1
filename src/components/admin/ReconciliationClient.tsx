"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileX2,
  PackageX,
  Paperclip,
  Scale,
} from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";

type MatchType = "TURKEY" | "CHINA" | "SUPPLIERS" | "OTHER";

type ReconStatus = "MATCHED" | "AMOUNT_DIFF" | "MISSING_IN_SYSTEM" | "MISSING_IN_EXTERNAL";

type ReconRow = {
  customerName: string | null;
  systemCustomerCode: string | null;
  externalCustomerCode: string | null;
  systemOrderNumber: string | null;
  externalOrderNumber: string | null;
  systemAmount: number | null;
  externalAmount: number | null;
  diff: number | null;
  status: ReconStatus;
};

type ReconKpis = {
  systemTotal: number;
  externalTotal: number;
  matched: number;
  mismatched: number;
  missingSystem: number;
  missingExternal: number;
};

type ReconResult = { kpis: ReconKpis; rows: ReconRow[]; fileName: string };

const MATCH_TYPE_OPTIONS: { value: MatchType; label: string }[] = [
  { value: "TURKEY", label: "טורקיה" },
  { value: "CHINA", label: "סין" },
  { value: "SUPPLIERS", label: "ספקים" },
  { value: "OTHER", label: "אחר" },
];

const STATUS_LABEL: Record<ReconStatus, string> = {
  MATCHED: "תואם",
  AMOUNT_DIFF: "פער סכום",
  MISSING_IN_SYSTEM: "חסר במערכת",
  MISSING_IN_EXTERNAL: "חסר בקובץ",
};

const STATUS_CLASS: Record<ReconStatus, string> = {
  MATCHED: "adm-recon-tag adm-recon-tag--matched",
  AMOUNT_DIFF: "adm-recon-tag adm-recon-tag--diff",
  MISSING_IN_SYSTEM: "adm-recon-tag adm-recon-tag--missing-system",
  MISSING_IN_EXTERNAL: "adm-recon-tag adm-recon-tag--missing-file",
};

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 12 && n >= 1; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  if (!out.includes("AH-127")) out.push("AH-127");
  return out;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ReconciliationClient() {
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState(weekOptions.includes("AH-127") ? "AH-127" : weekOptions[0]);
  const [matchType, setMatchType] = useState<MatchType>("TURKEY");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const kpis = result?.kpis;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError(null);
  }

  async function onReconcile() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("week", week);
      fd.append("matchType", matchType);
      const res = await fetch("/api/controls/reconciliation", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = (await res.json()) as
        | { ok: true; kpis: ReconKpis; rows: ReconRow[]; fileName: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setResult({ kpis: data.kpis, rows: data.rows, fileName: data.fileName });
    } catch {
      setError("שגיאה בתקשורת עם השרת");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adm-recon" dir="rtl">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">
          <Scale size={18} aria-hidden /> התאמת מערכות
        </h1>
      </div>

      <p className="adm-recon-hint">
        בחר שבוע עבודה וסוג התאמה, חבר קובץ Excel חיצוני ולחץ &quot;בצע התאמת מערכות&quot;. ההשוואה
        מתבצעת לפי <strong>קוד לקוח + סכום</strong> (תאריך משמש כשובר-שוויון). מספרי ההזמנה מוצגים
        משני הצדדים לצורך בדיקה אך אינם משמשים להתאמה. הנתונים אינם נשמרים — תצוגה בלבד.
      </p>

      <div className="adm-recon-controls">
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">שבוע עבודה</span>
          <select
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setResult(null);
            }}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">סוג התאמה</span>
          <select
            value={matchType}
            onChange={(e) => {
              setMatchType(e.target.value as MatchType);
              setResult(null);
            }}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            {MATCH_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">קובץ Excel חיצוני</span>
          <div className="adm-recon-file">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onPickFile}
              className="adm-recon-file__input"
            />
            <button
              type="button"
              className="adm-btn adm-btn--ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={15} aria-hidden /> {file ? "החלף קובץ" : "בחר קובץ"}
            </button>
            <span className="adm-recon-file__name">{file ? file.name : "לא נבחר קובץ"}</span>
          </div>
        </label>

        <button
          type="button"
          className="adm-btn adm-btn--primary"
          disabled={!file || loading}
          onClick={() => void onReconcile()}
          title={!file ? "יש לחבר קובץ Excel תחילה" : undefined}
        >
          {loading ? "מבצע התאמה…" : "בצע התאמת מערכות"}
        </button>
      </div>

      {error ? (
        <p className="adm-orders-inline-err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="adm-recon-kpi-row">
        <div className="adm-recon-kpi adm-recon-kpi--total">
          <span className="adm-recon-kpi__head">
            <Database size={15} aria-hidden /> סה״כ רשומות במערכת
          </span>
          <strong className="adm-recon-kpi__count">{kpis?.systemTotal ?? 0}</strong>
        </div>
        <div className="adm-recon-kpi adm-recon-kpi--total">
          <span className="adm-recon-kpi__head">
            <FileSpreadsheet size={15} aria-hidden /> סה״כ רשומות בקובץ חיצוני
          </span>
          <strong className="adm-recon-kpi__count">{kpis?.externalTotal ?? 0}</strong>
        </div>
        <div className="adm-recon-kpi adm-recon-kpi--matched">
          <span className="adm-recon-kpi__head">
            <CheckCircle2 size={15} aria-hidden /> התאמות מלאות
          </span>
          <strong className="adm-recon-kpi__count">{kpis?.matched ?? 0}</strong>
        </div>
        <div className="adm-recon-kpi adm-recon-kpi--diff">
          <span className="adm-recon-kpi__head">
            <AlertTriangle size={15} aria-hidden /> אי התאמות
          </span>
          <strong className="adm-recon-kpi__count">{kpis?.mismatched ?? 0}</strong>
        </div>
        <div className="adm-recon-kpi adm-recon-kpi--missing-system">
          <span className="adm-recon-kpi__head">
            <PackageX size={15} aria-hidden /> חסרים במערכת
          </span>
          <strong className="adm-recon-kpi__count">{kpis?.missingSystem ?? 0}</strong>
        </div>
        <div className="adm-recon-kpi adm-recon-kpi--missing-file">
          <span className="adm-recon-kpi__head">
            <FileX2 size={15} aria-hidden /> חסרים בקובץ חיצוני
          </span>
          <strong className="adm-recon-kpi__count">{kpis?.missingExternal ?? 0}</strong>
        </div>
      </div>

      <div className="adm-table-excel-wrap">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>קוד לקוח (מערכת)</th>
              <th>קוד לקוח (קובץ)</th>
              <th>מספר הזמנה (מערכת)</th>
              <th>מספר הזמנה (קובץ)</th>
              <th>סכום מערכת</th>
              <th>סכום חיצוני</th>
              <th>הפרש</th>
              <th>סטטוס התאמה</th>
            </tr>
          </thead>
          <tbody>
            {!result ? (
              <tr>
                <td colSpan={8} className="adm-table-empty">
                  אין נתונים להצגה. חבר קובץ Excel ולחץ &quot;בצע התאמת מערכות&quot;.
                </td>
              </tr>
            ) : result.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="adm-table-empty">
                  לא נמצאו רשומות להתאמה עבור שבוע {week}.
                </td>
              </tr>
            ) : (
              result.rows.map((r, i) => (
                <tr
                  key={`${r.systemOrderNumber ?? r.externalOrderNumber ?? r.externalCustomerCode ?? "row"}:${i}`}
                  className="adm-table-excel-row"
                >
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.systemCustomerCode ?? "—"}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.externalCustomerCode ?? "—"}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.systemOrderNumber ?? "—"}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.externalOrderNumber ?? "—"}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {fmtUsd(r.systemAmount)}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {fmtUsd(r.externalAmount)}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">
                    {r.diff == null ? "—" : fmtUsd(r.diff)}
                  </td>
                  <td>
                    <span className={STATUS_CLASS[r.status]}>{STATUS_LABEL[r.status]}</span>
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
