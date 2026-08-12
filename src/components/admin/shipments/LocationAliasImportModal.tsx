"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  Filter,
  Search,
  Upload,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import type {
  LocationAliasImportPreview,
  LocationAliasImportResult,
  LocationAliasImportRow,
  LocationAliasImportNewArea,
} from "@/app/admin/shipments/location-service";
import {
  LOCATION_ALIAS_IMPORT_ERROR_CODES,
  locationAliasImportErrorLabel,
} from "@/lib/location-import-errors";
import {
  commitLocationAliasRowsAction,
  previewLocationAliasImportAction,
} from "@/app/admin/shipments/location-actions";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";

type Props = {
  onClose: () => void;
  onDone?: (result: LocationAliasImportResult) => void;
};

type ImportTab = "all" | "create" | "update" | "failed" | "warning" | "unchanged";
type KpiKey = ImportTab | "newAreas" | "total" | "valid" | null;

function actionLabel(row: LocationAliasImportRow): string {
  if (row.action === "create") return "הוספה";
  if (row.action === "update") return "עדכון";
  if (row.action === "noop") return "ללא שינוי";
  return "—";
}

function statusLabel(row: LocationAliasImportRow): string {
  if (!row.valid || row.status === "failed") return "❌ נכשל";
  if (row.status === "warning") return "⚠️ אזהרה";
  if (row.action === "noop") return "○ ללא שינוי";
  if (row.action === "update") return "✓ יעודכן";
  if (row.action === "create") return "✓ ייווצר";
  return "✓ תקין";
}

function reasonText(row: LocationAliasImportRow): string {
  if (row.error) return row.error;
  if (row.warningMessage) return row.warningMessage;
  if (row.action === "noop") return "אין שינוי ביחס למצב הקיים";
  if (row.changes?.areaName) {
    return `אזור: ${row.changes.areaName.before} → ${row.changes.areaName.after}`;
  }
  if (row.changes?.displayName) {
    return `שם: ${row.changes.displayName.before} → ${row.changes.displayName.after}`;
  }
  if (row.action === "create") return "+ התאמה חדשה";
  return "—";
}

function tabMatches(row: LocationAliasImportRow, tab: ImportTab): boolean {
  if (tab === "all") return true;
  if (tab === "failed") return !row.valid || row.status === "failed";
  if (tab === "warning") return row.status === "warning";
  if (tab === "unchanged") return row.action === "noop" && row.valid;
  if (tab === "create") return row.action === "create" && row.valid;
  if (tab === "update") return row.action === "update" && row.valid;
  return true;
}

function downloadErrorReport(rows: LocationAliasImportRow[], fileName: string | null) {
  const problems = rows.filter((r) => !r.valid || r.status === "failed" || r.status === "warning");
  const data = problems.map((r) => ({
    "מספר שורה": r.rowIndex,
    "מקום מקורי": r.originalName,
    "מקום מעודכן": r.displayName,
    אזור: r.areaName ?? "",
    "סיבת כישלון / אזהרה": reasonText(r),
    "Error Code": r.errorCode ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "שגיאות");
  XLSX.writeFile(wb, `location-import-errors-${fileName ?? "report"}.xlsx`);
}

function NewAreasPanel({ areas }: { areas: LocationAliasImportNewArea[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="loc-import-new-areas">
      {areas.map((area) => (
        <div key={area.name} className="loc-import-new-areas__item">
          <strong>{area.name}</strong>
          <span>מופיע ב־{area.rowCount} שורות</span>
          <span className={area.willCreate ? "loc-import-tag loc-import-tag--green" : "loc-import-tag loc-import-tag--orange"}>
            {area.willCreate
              ? "ייווצר אזור חלוקה חדש בעת האישור"
              : "נדרש ליצור את האזור לפני הייבוא"}
          </span>
        </div>
      ))}
    </div>
  );
}

function RowDetailPanel({ row }: { row: LocationAliasImportRow }) {
  return (
    <div className="loc-import-detail">
      <div className="loc-import-detail__grid">
        <div>
          <span className="loc-import-detail__label">שורת Excel</span>
          <strong>{row.rowIndex}</strong>
        </div>
        <div>
          <span className="loc-import-detail__label">פעולה</span>
          <strong>{actionLabel(row)}</strong>
        </div>
        <div>
          <span className="loc-import-detail__label">סטטוס</span>
          <strong>{statusLabel(row)}</strong>
        </div>
      </div>
      <div className="loc-import-detail__cols">
        <div>
          <span className="loc-import-detail__label">מקום מקורי</span>
          <p dir="auto">{row.originalName || "—"}</p>
        </div>
        <div>
          <span className="loc-import-detail__label">מקום מעודכן</span>
          <p dir="auto">{row.displayName || "—"}</p>
        </div>
        <div>
          <span className="loc-import-detail__label">אזור מהקובץ</span>
          <p>{row.areaName || "—"}</p>
        </div>
      </div>
      {(row.error || row.warningMessage) && (
        <div className="loc-import-detail__problem">
          <span className="loc-import-detail__label">בעיה</span>
          <p>{row.error || row.warningMessage}</p>
          {row.errorCode && (
            <p className="loc-import-detail__code">
              {row.errorCode} — {locationAliasImportErrorLabel(row.errorCode)}
            </p>
          )}
        </div>
      )}
      {row.changes && (
        <div className="loc-import-detail__changes">
          {row.changes.areaName && (
            <p>
              אזור קודם: <strong>{row.changes.areaName.before}</strong> → אזור חדש:{" "}
              <strong className="loc-import-highlight">{row.changes.areaName.after}</strong>
            </p>
          )}
          {row.changes.displayName && (
            <p>
              שם מעודכן קודם: <strong>{row.changes.displayName.before}</strong> → שם חדש:{" "}
              <strong className="loc-import-highlight">{row.changes.displayName.after}</strong>
            </p>
          )}
          {row.changes.originalName && (
            <p>
              שם מקורי קודם: <strong>{row.changes.originalName.before}</strong> → שם חדש:{" "}
              <strong className="loc-import-highlight">{row.changes.originalName.after}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function LocationAliasImportModal({ onClose, onDone }: Props) {
  const { workCountry } = useShipmentCountry();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocationAliasImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<LocationAliasImportResult | null>(null);
  const [tab, setTab] = useState<ImportTab>("all");
  const [kpiFilter, setKpiFilter] = useState<KpiKey>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [showNewAreas, setShowNewAreas] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [errorFilter, setErrorFilter] = useState<string>("all");
  const [selectedRow, setSelectedRow] = useState<LocationAliasImportRow | null>(null);

  const displayRows = commitResult
    ? preview?.rows.map((row) => {
        const failed = commitResult.errors.find((e) => e.rowIndex === row.rowIndex);
        if (!failed) return row;
        return {
          ...row,
          valid: false,
          status: "failed" as const,
          action: "fail" as const,
          error: failed.error,
          errorCode: failed.errorCode,
        };
      }) ?? []
    : preview?.rows ?? [];

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of displayRows) {
      if (row.areaName) set.add(row.areaName);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [displayRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayRows.filter((row) => {
      if (problemsOnly && row.valid && row.status !== "warning") return false;
      if (kpiFilter === "newAreas") {
        if (!row.areaName || !preview?.newAreas.some((a) => a.name === row.areaName)) return false;
      } else if (kpiFilter === "valid") {
        if (!row.valid) return false;
      } else if (kpiFilter && kpiFilter !== "total") {
        if (!tabMatches(row, kpiFilter)) return false;
      } else if (!kpiFilter && !tabMatches(row, tab)) {
        return false;
      }
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (actionFilter !== "all" && row.action !== actionFilter) return false;
      if (areaFilter !== "all" && row.areaName !== areaFilter) return false;
      if (errorFilter !== "all" && row.errorCode !== errorFilter) return false;
      if (!q) return true;
      return (
        String(row.rowIndex).includes(q) ||
        row.originalName.toLowerCase().includes(q) ||
        row.displayName.toLowerCase().includes(q) ||
        (row.areaName?.toLowerCase().includes(q) ?? false) ||
        reasonText(row).toLowerCase().includes(q)
      );
    });
  }, [
    displayRows,
    tab,
    kpiFilter,
    problemsOnly,
    search,
    statusFilter,
    actionFilter,
    areaFilter,
    errorFilter,
    preview?.newAreas,
  ]);

  const counts = preview?.counts;
  const problemCount = (counts?.failed ?? 0) + (counts?.warnings ?? 0);

  async function onImportFile(file: File) {
    setBusy(true);
    setMsg(null);
    setPreview(null);
    setCommitResult(null);
    setTab("all");
    setKpiFilter(null);
    setProblemsOnly(false);
    setShowNewAreas(false);
    setSelectedRow(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const res = await previewLocationAliasImportAction(workCountry, grid);
      if (res.ok) setPreview(res.preview);
      else setMsg(res.error);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!preview) return;
    if (preview.mappingError) {
      setMsg(preview.mappingError);
      return;
    }
    const rows = preview.rows.filter((r) => r.valid);
    if (rows.length === 0) {
      setMsg("אין שורות תקינות — בדקו כותרות: מקום מסירה | אזור חלוקה | מקום מסירה מעודכן");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await commitLocationAliasRowsAction(workCountry, rows, preview.totalRows, { fileName });
      if (res.ok) {
        setCommitResult(res.result);
        onDone?.(res.result);
      } else {
        setMsg(res.error);
      }
    } catch (e) {
      setMsg(`הייבוא נכשל: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function selectKpi(next: KpiKey) {
    setKpiFilter((prev) => (prev === next ? null : next));
    if (next === "newAreas") {
      setShowNewAreas(true);
      return;
    }
    setShowNewAreas(false);
    if (
      next === "create" ||
      next === "update" ||
      next === "failed" ||
      next === "warning" ||
      next === "unchanged" ||
      next === "all"
    ) {
      setTab(next);
    }
  }

  return (
    <div className="shp-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="shp-modal shp-modal--loc-import"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header loc-import-header">
          <div>
            <strong>ייבוא התאמות יישובים</strong>
            {fileName && <span className="loc-import-header__file">{fileName}</span>}
            {commitResult && (
              <span className="loc-import-header__done">
                ייבוא הושלם · מזהה {commitResult.audit.importId.slice(0, 8)}
              </span>
            )}
          </div>
          <button type="button" className="shp-icon-btn" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </div>

        <div className="shp-modal__body loc-import-body">
          {!preview && (
            <>
              <p className="loc-import-intro">
                סדר עמודות: <strong>מקום מסירה מקורי</strong> · <strong>אזור חלוקה</strong> ·{" "}
                <strong>מקום מסירה מעודכן</strong>. הטקסט המקורי מה־Excel מוצג כפי שהגיע — כולל
                ערבית, עברית ואנגלית.
              </p>
              <label className="shp-btn shp-btn--primary loc-import-upload">
                <Upload size={14} />
                בחר קובץ Excel
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          )}

          {msg && <div className="shp-alert shp-alert--error">{msg}</div>}
          {preview?.mappingError && (
            <div className="shp-alert shp-alert--error">{preview.mappingError}</div>
          )}

          {preview && !preview.mappingError && counts && (
            <>
              <div className="loc-import-kpis">
                <button type="button" className={`loc-import-kpi ${kpiFilter === "total" ? "is-active" : ""}`} onClick={() => selectKpi("total")}>
                  <span>סה״כ שורות</span>
                  <strong>{counts.total}</strong>
                </button>
                <button type="button" className={`loc-import-kpi ${kpiFilter === "valid" ? "is-active" : ""}`} onClick={() => selectKpi("valid")}>
                  <span>תקינות</span>
                  <strong>{counts.valid}</strong>
                </button>
                <button type="button" className={`loc-import-kpi loc-import-kpi--green ${kpiFilter === "create" ? "is-active" : ""}`} onClick={() => selectKpi("create")}>
                  <span>נוספו</span>
                  <strong>{counts.wouldCreate}</strong>
                </button>
                <button type="button" className={`loc-import-kpi loc-import-kpi--blue ${kpiFilter === "update" ? "is-active" : ""}`} onClick={() => selectKpi("update")}>
                  <span>עודכנו</span>
                  <strong>{counts.wouldUpdate}</strong>
                </button>
                <button type="button" className={`loc-import-kpi loc-import-kpi--red ${kpiFilter === "failed" ? "is-active" : ""}`} onClick={() => selectKpi("failed")}>
                  <span>נכשלו</span>
                  <strong>{counts.failed}</strong>
                </button>
                <button type="button" className={`loc-import-kpi loc-import-kpi--orange ${kpiFilter === "warning" ? "is-active" : ""}`} onClick={() => selectKpi("warning")}>
                  <span>אזהרות</span>
                  <strong>{counts.warnings}</strong>
                </button>
                <button type="button" className={`loc-import-kpi loc-import-kpi--gray ${kpiFilter === "unchanged" ? "is-active" : ""}`} onClick={() => selectKpi("unchanged")}>
                  <span>ללא שינוי</span>
                  <strong>{counts.unchanged}</strong>
                </button>
                <button type="button" className={`loc-import-kpi loc-import-kpi--purple ${kpiFilter === "newAreas" ? "is-active" : ""}`} onClick={() => selectKpi("newAreas")}>
                  <span>אזורים חדשים</span>
                  <strong>{counts.newAreas}</strong>
                </button>
              </div>

              {showNewAreas && preview.newAreas.length > 0 && (
                <NewAreasPanel areas={preview.newAreas} />
              )}

              {!commitResult && (
                <div className="loc-import-confirm-summary">
                  <p>אם תאשרי את הייבוא:</p>
                  <ul>
                    <li>{counts.wouldCreate} התאמות חדשות יתווספו</li>
                    <li>{counts.wouldUpdate} התאמות קיימות יעודכנו</li>
                    <li>{counts.failed} שורות לא ייובאו</li>
                    {counts.newAreas > 0 && <li>{counts.newAreas} אזורים חדשים זוהו בקובץ</li>}
                  </ul>
                </div>
              )}

              {commitResult && (
                <div className="shp-alert">
                  ייבוא הושלם: {commitResult.createdAliases} נוספו · {commitResult.updatedAliases} עודכנו ·{" "}
                  {commitResult.failed} נכשלו · {commitResult.createdAreas} אזורים חדשים
                </div>
              )}

              <div className="loc-import-tabs">
                {(
                  [
                    ["all", "הכל", counts.total],
                    ["create", "נוספו", counts.wouldCreate],
                    ["update", "עודכנו", counts.wouldUpdate],
                    ["failed", "נכשלו", counts.failed],
                    ["warning", "אזהרות", counts.warnings],
                    ["unchanged", "ללא שינוי", counts.unchanged],
                  ] as const
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    className={`loc-import-tab ${tab === key && !kpiFilter ? "is-active" : ""}`}
                    onClick={() => {
                      setTab(key);
                      setKpiFilter(null);
                      setShowNewAreas(false);
                    }}
                  >
                    {label} <span>{n}</span>
                  </button>
                ))}
              </div>

              <div className="loc-import-toolbar">
                <label className="loc-import-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="חיפוש מקום / אזור / שורת Excel"
                  />
                </label>
                <label className="loc-import-filter">
                  <Filter size={13} />
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">כל הסטטוסים</option>
                    <option value="ok">תקין</option>
                    <option value="failed">נכשל</option>
                    <option value="warning">אזהרה</option>
                    <option value="unchanged">ללא שינוי</option>
                  </select>
                </label>
                <label className="loc-import-filter">
                  <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                    <option value="all">כל הפעולות</option>
                    <option value="create">הוספה</option>
                    <option value="update">עדכון</option>
                    <option value="noop">ללא שינוי</option>
                    <option value="fail">כישלון</option>
                  </select>
                </label>
                <label className="loc-import-filter">
                  <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
                    <option value="all">כל האזורים</option>
                    {areaOptions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="loc-import-filter">
                  <select value={errorFilter} onChange={(e) => setErrorFilter(e.target.value)}>
                    <option value="all">כל סוגי השגיאה</option>
                    {LOCATION_ALIAS_IMPORT_ERROR_CODES.map((code) => (
                      <option key={code} value={code}>
                        {locationAliasImportErrorLabel(code)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={`shp-btn ${problemsOnly ? "shp-btn--primary" : ""}`}
                  onClick={() => setProblemsOnly((v) => !v)}
                >
                  <AlertTriangle size={14} />
                  הצג רק בעיות ({problemCount})
                </button>
                <button
                  type="button"
                  className="shp-btn"
                  disabled={problemCount === 0}
                  onClick={() => downloadErrorReport(displayRows, fileName)}
                >
                  <Download size={14} />
                  הורד דוח שגיאות
                </button>
                <span className="loc-import-toolbar__count">
                  מציג {filteredRows.length} / {displayRows.length}
                </span>
              </div>

              {selectedRow && <RowDetailPanel row={selectedRow} />}

              <div className="loc-import-table-wrap">
                <table className="shp-table shp-table--daily loc-import-table">
                  <thead>
                    <tr>
                      <th>שורת Excel</th>
                      <th>מקום מסירה מקורי</th>
                      <th>מקום מסירה מעודכן</th>
                      <th>אזור חלוקה</th>
                      <th>פעולה</th>
                      <th>סטטוס</th>
                      <th>סיבה / בעיה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={[
                          !row.valid ? "loc-import-row--failed" : "",
                          row.status === "warning" ? "loc-import-row--warning" : "",
                          row.action === "noop" ? "loc-import-row--unchanged" : "",
                          selectedRow?.rowIndex === row.rowIndex ? "is-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => setSelectedRow((prev) => (prev?.rowIndex === row.rowIndex ? null : row))}
                      >
                        <td>{row.rowIndex}</td>
                        <td dir="auto" className="loc-import-cell-raw">
                          {row.originalName || "—"}
                        </td>
                        <td dir="auto" className="loc-import-cell-raw">
                          {row.displayName || "—"}
                        </td>
                        <td>{row.areaName || "—"}</td>
                        <td>{actionLabel(row)}</td>
                        <td>{statusLabel(row)}</td>
                        <td className="loc-import-reason" title={reasonText(row)}>
                          {reasonText(row)}
                          {(row.error || row.warningMessage) && (
                            <button
                              type="button"
                              className="loc-import-reason__more"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRow(row);
                              }}
                            >
                              הצג פרטים
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredRows.length === 0 && (
                  <div className="loc-import-empty">אין שורות להצגה לפי הסינון הנוכחי</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="shp-modal__footer loc-import-footer">
          <button type="button" className="shp-btn" onClick={onClose} disabled={busy}>
            {commitResult ? "סגור" : "ביטול"}
          </button>
          {preview && !preview.mappingError && !commitResult && (
            <>
              <button
                type="button"
                className="shp-btn"
                disabled={problemCount === 0}
                onClick={() => downloadErrorReport(displayRows, fileName)}
              >
                <Download size={14} />
                הורד שגיאות
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                disabled={busy || preview.validRows === 0}
                onClick={() => void commitImport()}
              >
                {busy ? "מייבא..." : `אשר ייבוא — ${preview.validRows} שורות`}
              </button>
            </>
          )}
          {commitResult && problemCount > 0 && (
            <button
              type="button"
              className="shp-btn"
              onClick={() => downloadErrorReport(displayRows, fileName)}
            >
              <Download size={14} />
              הורד דוח שגיאות
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
