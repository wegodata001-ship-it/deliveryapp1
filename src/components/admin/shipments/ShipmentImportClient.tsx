"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle,
  XCircle,
  AlertCircle,
  Trash2,
  RefreshCw,
} from "lucide-react";
import * as XLSX from "xlsx";
import type {
  CreateBatchInput,
  ExcelShipmentPreviewRow,
  ShipmentCourierDto,
  ShipmentZoneDto,
} from "@/app/admin/shipments/types";
import { createShipmentBatchAction } from "@/app/admin/shipments/actions";
import {
  analyzeShipmentWorkbook,
  type ShipmentImportAnalysis,
  type ShipmentCurrency,
} from "@/lib/shipment-import-detector";
import { getAhWeekByDate } from "@/lib/weeks/ah-week";

type BatchHeaderForm = {
  sourceShipmentNumber: string;
  containerNumber: string;
  totalBoxes: string;
  totalWeight: string;
  shippingDate: string;
  arrivalDate: string;
  releaseDate: string;
  warehouseReceiptDate: string;
  distributionStartDate: string;
  notes: string;
  defaultZoneId: string;
  defaultCourierId: string;
};

const EMPTY_FORM: BatchHeaderForm = {
  sourceShipmentNumber: "",
  containerNumber: "",
  totalBoxes: "",
  totalWeight: "",
  shippingDate: "",
  arrivalDate: "",
  releaseDate: "",
  warehouseReceiptDate: "",
  distributionStartDate: "",
  notes: "",
  defaultZoneId: "",
  defaultCourierId: "",
};

function weekFromFormDates(shippingDate: string, arrivalDate: string): string | null {
  const ymd = (shippingDate || arrivalDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return getAhWeekByDate(new Date(Date.UTC(y, m - 1, d, 12))).code;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CURRENCY_SYMBOLS: Record<ShipmentCurrency, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  TRY: "₺",
  GBP: "£",
  UNKNOWN: "",
};

function formatDetectedMoney(
  amount: number | null,
  currency: ShipmentCurrency | null,
  raw: string | null,
): string {
  if (amount == null) return raw || "—";
  const symbol = currency ? CURRENCY_SYMBOLS[currency] : "";
  const code = currency === "UNKNOWN" ? " (מטבע לא זוהה)" : "";
  return `${symbol}${amount.toLocaleString("he-IL", { maximumFractionDigits: 4 })}${code}`;
}

type Props = {
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
};

export function ShipmentImportClient({ initialZones, initialCouriers }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<ExcelShipmentPreviewRow[]>([]);
  const [analysis, setAnalysis] = useState<ShipmentImportAnalysis | null>(null);
  const [form, setForm] = useState<BatchHeaderForm>(EMPTY_FORM);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [saving, setSaving] = useState<"idle" | "header" | "import">("idle");

  const activeZones = useMemo(() => initialZones.filter((z) => z.isActive), [initialZones]);
  const activeCouriers = useMemo(
    () => initialCouriers.filter((c) => c.isActive),
    [initialCouriers],
  );
  const computedWeek = useMemo(
    () => weekFromFormDates(form.shippingDate, form.arrivalDate),
    [form.shippingDate, form.arrivalDate],
  );

  const validCount = preview.filter((r) => r.valid).length;
  const invalidCount = preview.length - validCount;
  const uniqueCustomers = useMemo(() => {
    const keys = new Set<string>();
    for (const r of preview) {
      const k = (r.customerCode || r.customerName || "").trim();
      if (k) keys.add(k);
    }
    return keys.size;
  }, [preview]);
  const missingFields = new Set(analysis?.missingFields.map((item) => item.field) ?? []);
  const missingText = (field: string) =>
    missingFields.has(field as never) ? "לא קיימת בקובץ" : "—";
  const hasFile = Boolean(fileName && preview.length > 0);
  const isSaving = saving !== "idle";

  function clearFile() {
    setPreview([]);
    setAnalysis(null);
    setFileName(null);
    setFileSize(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError("קובץ לא נתמך. יש להעלות קובץ Excel (.xlsx / .xls) או CSV.");
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const sheets = wb.SheetNames.map((name) => ({
          name,
          grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
            header: 1,
            defval: null,
            raw: false,
            blankrows: true,
          }),
        }));
        const detected = analyzeShipmentWorkbook(sheets);
        if (detected.headerRowIndex == null) {
          setAnalysis(detected);
          setPreview([]);
          setError(
            detected.diagnostics.find((item) => item.level === "error")?.message ??
              "לא נמצאה טבלת משלוחים בקובץ.",
          );
          return;
        }
        if (detected.rows.length === 0) {
          setAnalysis(detected);
          setPreview([]);
          setError("שורת כותרת זוהתה, אך לא נמצאו אחריה שורות נתונים.");
          return;
        }
        setAnalysis(detected);
        setPreview(detected.rows);
        setForm((prev) => ({
          ...prev,
          sourceShipmentNumber:
            prev.sourceShipmentNumber || detected.batchMetadata.sourceShipmentNumber || "",
          containerNumber: prev.containerNumber || detected.batchMetadata.containerNumber || "",
          totalBoxes: prev.totalBoxes || detected.batchMetadata.totalBoxes?.toString() || "",
          totalWeight: prev.totalWeight || detected.batchMetadata.totalWeight?.toString() || "",
          shippingDate: prev.shippingDate || detected.batchMetadata.shippingDate || "",
          arrivalDate: prev.arrivalDate || detected.batchMetadata.arrivalDate || "",
          releaseDate: prev.releaseDate || detected.batchMetadata.releaseDate || "",
          warehouseReceiptDate:
            prev.warehouseReceiptDate || detected.batchMetadata.warehouseReceiptDate || "",
          distributionStartDate:
            prev.distributionStartDate || detected.batchMetadata.distributionStartDate || "",
        }));
      } catch (err) {
        setError("שגיאה בקריאת הקובץ: " + String(err));
        setPreview([]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function buildInput(includeRows: boolean): CreateBatchInput {
    return {
      sourceShipmentNumber: form.sourceShipmentNumber || undefined,
      containerNumber: form.containerNumber || undefined,
      totalBoxes: form.totalBoxes ? parseInt(form.totalBoxes, 10) : undefined,
      totalWeight: form.totalWeight ? parseFloat(form.totalWeight) : undefined,
      shippingDate: form.shippingDate || undefined,
      arrivalDate: form.arrivalDate || undefined,
      releaseDate: form.releaseDate || undefined,
      warehouseReceiptDate: form.warehouseReceiptDate || undefined,
      distributionStartDate: form.distributionStartDate || undefined,
      notes: form.notes || undefined,
      defaultZoneId: form.defaultZoneId || undefined,
      defaultCourierId: form.defaultCourierId || undefined,
      rows: includeRows ? preview : [],
    };
  }

  async function handleSave(mode: "header" | "import") {
    if (mode === "import") {
      if (!hasFile) {
        setError("יש להעלות קובץ Excel לפני שמירה עם ייבוא.");
        return;
      }
      if (validCount === 0) {
        setError("אין שורות תקינות לייבוא מהקובץ.");
        return;
      }
    }

    setSaving(mode);
    setError(null);
    const res = await createShipmentBatchAction(buildInput(mode === "import"));
    if (!res.ok) {
      setError(res.error);
      setSaving("idle");
      return;
    }
    router.push(`/admin/shipments/${res.batchId}`);
  }

  return (
    <div className="shp-page shp-page--wide shp-create-page">
      <div className="shp-header">
        <FileSpreadsheet size={22} style={{ color: "#2563eb" }} />
        <div>
          <h1>יצירת משלוח חדש</h1>
          <p className="shp-create-subtitle">
            מלאו את פרטי המשלוח והעלו קובץ Excel באותו מסך — ללא מעבר בין שלבים.
          </p>
        </div>
      </div>

      {error && (
        <div className="shp-alert shp-alert--error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="shp-create-split">
        {/* Right (RTL first) — shipment details */}
        <section className="shp-create-panel">
          <h2 className="shp-create-panel__title">פרטי המשלוח</h2>
          <div className="shp-form-grid shp-create-form">
            <div className="shp-form-field">
              <label>מספר משלוח</label>
              <input
                type="text"
                placeholder="כפי שהתקבל מהספק"
                value={form.sourceShipmentNumber}
                onChange={(e) => setForm((f) => ({ ...f, sourceShipmentNumber: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>מספר קונטיינר</label>
              <input
                type="text"
                value={form.containerNumber}
                onChange={(e) => setForm((f) => ({ ...f, containerNumber: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>תאריך יציאה</label>
              <input
                type="date"
                value={form.shippingDate}
                onChange={(e) => setForm((f) => ({ ...f, shippingDate: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>תאריך הגעה</label>
              <input
                type="date"
                value={form.arrivalDate}
                onChange={(e) => setForm((f) => ({ ...f, arrivalDate: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>שבוע</label>
              <input type="text" value={computedWeek ?? "—"} disabled readOnly />
              <span className="shp-muted" style={{ fontSize: "0.75rem" }}>
                מחושב מתאריך יציאה / הגעה
              </span>
            </div>
            <div className="shp-form-field">
              <label>אזור</label>
              <select
                value={form.defaultZoneId}
                onChange={(e) => setForm((f) => ({ ...f, defaultZoneId: e.target.value }))}
                disabled={isSaving}
              >
                <option value="">ללא</option>
                {activeZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="shp-form-field">
              <label>שליח</label>
              <select
                value={form.defaultCourierId}
                onChange={(e) => setForm((f) => ({ ...f, defaultCourierId: e.target.value }))}
                disabled={isSaving}
              >
                <option value="">ללא</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="shp-form-field">
              <label>משקל (ק״ג)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.totalWeight}
                onChange={(e) => setForm((f) => ({ ...f, totalWeight: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>מספר קרטונים</label>
              <input
                type="number"
                min={0}
                value={form.totalBoxes}
                onChange={(e) => setForm((f) => ({ ...f, totalBoxes: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field shp-form-field--full">
              <label>הערות</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={isSaving}
                rows={3}
              />
            </div>
          </div>
        </section>

        {/* Left — Excel */}
        <section className="shp-create-panel shp-create-panel--file">
          <h2 className="shp-create-panel__title">קובץ Excel</h2>

          {!fileName ? (
            <div
              className={`shp-import-zone shp-import-zone--tall ${dragActive ? "shp-import-zone--active" : ""}`}
              onClick={() => !isSaving && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isSaving) setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
            >
              <div className="shp-import-zone__icon">
                <Upload size={44} />
              </div>
              <div className="shp-import-zone__text">📄 העלאת קובץ Excel</div>
              <div className="shp-import-zone__sub">או גרירה ושחרור (Drag & Drop)</div>
              <div className="shp-import-zone__sub">נתמכים: .xlsx · .xls · .csv</div>
            </div>
          ) : (
            <div className="shp-file-card">
              <div className="shp-file-card__icon">
                <FileSpreadsheet size={28} />
              </div>
              <div className="shp-file-card__meta">
                <div className="shp-file-card__name" title={fileName}>
                  {fileName}
                </div>
                <div className="shp-file-card__stats">
                  {fileSize != null ? <span>גודל: {formatFileSize(fileSize)}</span> : null}
                  <span>שורות: {preview.length || "—"}</span>
                  <span>לקוחות: {uniqueCustomers || "—"}</span>
                  {validCount > 0 && (
                    <span className="shp-file-card__ok">{validCount} תקינות</span>
                  )}
                  {invalidCount > 0 && (
                    <span className="shp-file-card__bad">{invalidCount} שגויות</span>
                  )}
                </div>
              </div>
              <div className="shp-file-card__actions">
                <button
                  type="button"
                  className="shp-btn shp-btn--secondary shp-btn--sm"
                  disabled={isSaving}
                  onClick={() => fileRef.current?.click()}
                >
                  <RefreshCw size={14} />
                  החלף קובץ
                </button>
                <button
                  type="button"
                  className="shp-btn shp-btn--danger shp-btn--sm"
                  disabled={isSaving}
                  onClick={clearFile}
                >
                  <Trash2 size={14} />
                  מחק קובץ
                </button>
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={handleFileInput}
            disabled={isSaving}
          />

          <p className="shp-create-hint">
            אין קובץ? אפשר לשמור את המשלוח בלבד ולהעלות את האקסל מאוחר יותר ממסך עריכת המשלוח.
          </p>
        </section>
      </div>

      {analysis && fileName && (
        <div className="shp-import-analysis">
          <div className="shp-import-analysis__title">תוצאות זיהוי המבנה</div>
          <div className="shp-import-analysis__summary">
            גיליון: <strong>{analysis.selectedSheet}</strong>
            {" · "}שורת כותרת: <strong>{(analysis.headerRowIndex ?? 0) + 1}</strong>
            {" · "}תחילת נתונים: <strong>{(analysis.dataStartRowIndex ?? 0) + 1}</strong>
          </div>
          <div className="shp-import-analysis__columns">
            {analysis.columnMappings.map((mapping) => (
              <span key={mapping.field} className="shp-import-column shp-import-column--found">
                ✓ {mapping.labelHe} ← {mapping.sourceHeader}
              </span>
            ))}
            {analysis.missingFields.map((missing) => (
              <span key={missing.field} className="shp-import-column shp-import-column--missing">
                ! {missing.message}
              </span>
            ))}
          </div>
          {analysis.diagnostics.map((diagnostic, index) => (
            <div
              key={`${diagnostic.code}-${index}`}
              className={`shp-import-diagnostic shp-import-diagnostic--${diagnostic.level}`}
            >
              {diagnostic.message}
            </div>
          ))}
        </div>
      )}

      {preview.length > 0 && (
        <div className="shp-create-preview">
          <div className="shp-preview-header">
            <div className="shp-preview-stats">
              תצוגה מקדימה · סה״כ: <strong>{preview.length}</strong> שורות ·{" "}
              <span style={{ color: "#15803d" }}>
                <strong>{validCount}</strong> תקינות
              </span>
              {invalidCount > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span style={{ color: "#dc2626" }}>
                    <strong>{invalidCount}</strong> שגויות
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="shp-table-wrap">
            <table className="shp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>סטטוס</th>
                  <th>קוד לקוח</th>
                  <th>לקוח</th>
                  <th>טלפון</th>
                  <th>כתובת</th>
                  <th>עיר</th>
                  <th>קרטונים</th>
                  <th>פרטי קרטונים</th>
                  <th>משקל</th>
                  <th>סכום הזמנה</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.rowIndex} className={row.valid ? "" : "shp-row--invalid"}>
                    <td style={{ color: "#64748b" }}>{row.rowIndex}</td>
                    <td>
                      {row.valid ? (
                        <CheckCircle size={15} style={{ color: "#15803d" }} />
                      ) : (
                        <span title={row.error ?? ""}>
                          <XCircle size={15} style={{ color: "#dc2626" }} />
                        </span>
                      )}
                    </td>
                    <td>{row.customerCode || missingText("customerCode")}</td>
                    <td>{row.customerName || missingText("customerName")}</td>
                    <td>{row.customerPhone || missingText("customerPhone")}</td>
                    <td>{row.address || missingText("address")}</td>
                    <td>{row.city || missingText("city")}</td>
                    <td>{row.boxes ?? missingText("boxes")}</td>
                    <td>{row.cartonDetails || missingText("cartonDetails")}</td>
                    <td>{row.weight != null ? `${row.weight}` : "—"}</td>
                    <td>
                      {formatDetectedMoney(row.orderAmount, row.orderCurrency, row.orderAmountRaw)}
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "#64748b" }}>{row.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="shp-create-footer">
        <button
          type="button"
          className="shp-btn shp-btn--success"
          onClick={() => void handleSave("import")}
          disabled={isSaving || !hasFile || validCount === 0}
          title={!hasFile ? "העלו קובץ Excel תחילה" : undefined}
        >
          {saving === "import" ? "שומר ומייבא…" : `שמור משלוח וייבא קובץ${validCount ? ` (${validCount})` : ""}`}
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--primary"
          onClick={() => void handleSave("header")}
          disabled={isSaving}
        >
          {saving === "header" ? "שומר…" : "שמור משלוח בלבד"}
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary"
          onClick={() => router.push("/admin/shipments")}
          disabled={isSaving}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
