"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";
import type { ExcelShipmentPreviewRow, CreateBatchInput } from "@/app/admin/shipments/types";
import { createShipmentBatchAction } from "@/app/admin/shipments/actions";
import {
  analyzeShipmentWorkbook,
  type ShipmentImportAnalysis,
  type ShipmentCurrency,
} from "@/lib/shipment-import-detector";

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
};

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

export function ShipmentImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "preview" | "header" | "saving">("upload");
  const [preview, setPreview] = useState<ExcelShipmentPreviewRow[]>([]);
  const [analysis, setAnalysis] = useState<ShipmentImportAnalysis | null>(null);
  const [form, setForm] = useState<BatchHeaderForm>(EMPTY_FORM);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError("קובץ לא נתמך. יש להעלות קובץ Excel (.xlsx / .xls) או CSV.");
      return;
    }
    setFileName(file.name);
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
          setError(
            detected.diagnostics.find((item) => item.level === "error")?.message ??
              "לא נמצאה טבלת משלוחים בקובץ.",
          );
          return;
        }
        if (detected.rows.length === 0) {
          setAnalysis(detected);
          setError("שורת כותרת זוהתה, אך לא נמצאו אחריה שורות נתונים.");
          return;
        }
        const parsed: ExcelShipmentPreviewRow[] = detected.rows;
        setAnalysis(detected);
        setPreview(parsed);
        setForm({
          ...EMPTY_FORM,
          sourceShipmentNumber: detected.batchMetadata.sourceShipmentNumber ?? "",
          containerNumber: detected.batchMetadata.containerNumber ?? "",
          totalBoxes: detected.batchMetadata.totalBoxes?.toString() ?? "",
          totalWeight: detected.batchMetadata.totalWeight?.toString() ?? "",
          shippingDate: detected.batchMetadata.shippingDate ?? "",
          arrivalDate: detected.batchMetadata.arrivalDate ?? "",
          releaseDate: detected.batchMetadata.releaseDate ?? "",
          warehouseReceiptDate: detected.batchMetadata.warehouseReceiptDate ?? "",
          distributionStartDate: detected.batchMetadata.distributionStartDate ?? "",
        });
        setStep("preview");
      } catch (err) {
        setError("שגיאה בקריאת הקובץ: " + String(err));
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

  async function handleSave() {
    const validRows = preview.filter((r) => r.valid);
    if (validRows.length === 0) {
      setError("אין שורות תקינות לשמירה");
      return;
    }
    setStep("saving");
    setError(null);

    const input: CreateBatchInput = {
      sourceShipmentNumber: form.sourceShipmentNumber || undefined,
      containerNumber: form.containerNumber || undefined,
      totalBoxes: form.totalBoxes ? parseInt(form.totalBoxes) : undefined,
      totalWeight: form.totalWeight ? parseFloat(form.totalWeight) : undefined,
      shippingDate: form.shippingDate || undefined,
      arrivalDate: form.arrivalDate || undefined,
      releaseDate: form.releaseDate || undefined,
      warehouseReceiptDate: form.warehouseReceiptDate || undefined,
      distributionStartDate: form.distributionStartDate || undefined,
      notes: form.notes || undefined,
      rows: preview,
    };

    const res = await createShipmentBatchAction(input);
    if (!res.ok) {
      setError(res.error);
      setStep("header");
      return;
    }
    router.push(`/admin/shipments/${res.batchId}`);
  }

  const validCount = preview.filter((r) => r.valid).length;
  const invalidCount = preview.length - validCount;
  const missingFields = new Set(analysis?.missingFields.map((item) => item.field) ?? []);
  const missingText = (field: string) =>
    missingFields.has(field as never) ? "לא קיימת בקובץ" : "—";

  // ─── Step: Upload ──────────────────────────────────────────────────────────

  if (step === "upload") {
    return (
      <div className="shp-page">
        <div className="shp-header">
          <FileSpreadsheet size={22} style={{ color: "#2563eb" }} />
          <h1>ייבוא משלוח</h1>
        </div>

        {error && <div className="shp-alert shp-alert--error">{error}</div>}

        <div
          className={`shp-import-zone ${dragActive ? "shp-import-zone--active" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <div className="shp-import-zone__icon">
            <Upload size={40} />
          </div>
          <div className="shp-import-zone__text">גרור קובץ Excel לכאן או לחץ לבחירה</div>
          <div className="shp-import-zone__sub">קבצים נתמכים: .xlsx, .xls, .csv</div>
        </div>

        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleFileInput} />

        <div className="shp-alert shp-alert--info" style={{ maxWidth: 500 }}>
          <AlertCircle size={16} />
          <div>
            <strong>עמודות נתמכות:</strong> שם לקוח, טלפון, כתובת, עיר, קרטונים, משקל, סכום הזמנה, הערות.
            <br />
            המערכת מזהה אוטומטית גיליון, שורת כותרת, מבנה, שפה ומטבע.
          </div>
        </div>
      </div>
    );
  }

  // ─── Step: Preview ─────────────────────────────────────────────────────────

  if (step === "preview") {
    return (
      <div className="shp-page">
        <div className="shp-header">
          <FileSpreadsheet size={22} style={{ color: "#2563eb" }} />
          <h1>תצוגה מקדימה — {fileName}</h1>
          <div className="shp-header-actions">
            <button className="shp-btn shp-btn--secondary" onClick={() => { setStep("upload"); setPreview([]); setAnalysis(null); }}>
              בחר קובץ אחר
            </button>
            <button className="shp-btn shp-btn--primary" onClick={() => setStep("header")} disabled={validCount === 0}>
              המשך →
            </button>
          </div>
        </div>

        <div className="shp-preview-header">
          <div className="shp-preview-stats">
            סה״כ: <strong>{preview.length}</strong> שורות •{" "}
            <span style={{ color: "#15803d" }}><strong>{validCount}</strong> תקינות</span>
            {invalidCount > 0 && (
              <> • <span style={{ color: "#dc2626" }}><strong>{invalidCount}</strong> שגויות</span></>
            )}
          </div>
        </div>

        {error && <div className="shp-alert shp-alert--error">{error}</div>}

        {analysis && (
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
                    {row.valid
                      ? <CheckCircle size={15} style={{ color: "#15803d" }} />
                      : <span title={row.error ?? ""}><XCircle size={15} style={{ color: "#dc2626" }} /></span>
                    }
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
                    {formatDetectedMoney(
                      row.orderAmount,
                      row.orderCurrency,
                      row.orderAmountRaw,
                    )}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "#64748b" }}>{row.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ─── Step: Header form ─────────────────────────────────────────────────────

  if (step === "header" || step === "saving") {
    const isSaving = step === "saving";
    return (
      <div className="shp-page">
        <div className="shp-header">
          <FileSpreadsheet size={22} style={{ color: "#2563eb" }} />
          <h1>פרטי משלוח</h1>
          <button
            className="shp-btn shp-btn--secondary"
            onClick={() => setStep("preview")}
            disabled={isSaving}
          >
            ← חזרה לתצוגה מקדימה
          </button>
        </div>

        <div className="shp-alert shp-alert--info" style={{ maxWidth: 600, marginBottom: 20 }}>
          <AlertCircle size={16} />
          יש למלא את פרטי המשלוח הכלליים לפני שמירת {validCount} הרשומות.
        </div>

        {error && <div className="shp-alert shp-alert--error">{error}</div>}

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "20px 24px", maxWidth: 800, marginBottom: 24 }}>
          <div className="shp-form-grid">
            <div className="shp-form-field">
              <label>מספר משלוח מקור</label>
              <input
                type="text"
                placeholder="כפי שהתקבל בקובץ הספק"
                value={form.sourceShipmentNumber}
                onChange={(e) => setForm((f) => ({ ...f, sourceShipmentNumber: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>מספר קונטיינר</label>
              <input
                type="text"
                placeholder="לדוגמה: MSCU1234567"
                value={form.containerNumber}
                onChange={(e) => setForm((f) => ({ ...f, containerNumber: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>מספר קרטונים כולל</label>
              <input
                type="number"
                min={0}
                value={form.totalBoxes}
                onChange={(e) => setForm((f) => ({ ...f, totalBoxes: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>משקל כולל (ק"ג)</label>
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
              <label>תאריך שליחה</label>
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
              <label>תאריך שחרור</label>
              <input
                type="date"
                value={form.releaseDate}
                onChange={(e) => setForm((f) => ({ ...f, releaseDate: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>תאריך קבלה במחסן</label>
              <input
                type="date"
                value={form.warehouseReceiptDate}
                onChange={(e) => setForm((f) => ({ ...f, warehouseReceiptDate: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field">
              <label>תאריך יציאה לחלוקה</label>
              <input
                type="date"
                value={form.distributionStartDate}
                onChange={(e) => setForm((f) => ({ ...f, distributionStartDate: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="shp-form-field" style={{ gridColumn: "1 / -1" }}>
              <label>הערות כלליות</label>
              <textarea
                placeholder="הערות על המשלוח..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="shp-btn shp-btn--success" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <span className="shp-spinner" /> : null}
            {isSaving ? "שומר..." : `שמור ${validCount} משלוחים`}
          </button>
          <button className="shp-btn shp-btn--secondary" onClick={() => setStep("preview")} disabled={isSaving}>
            ביטול
          </button>
        </div>
      </div>
    );
  }

  return null;
}
