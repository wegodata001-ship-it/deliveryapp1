"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload, CheckCircle, XCircle, AlertCircle } from "lucide-react";
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

  const [step, setStep] = useState<"header" | "upload" | "preview" | "saving">("header");
  const [preview, setPreview] = useState<ExcelShipmentPreviewRow[]>([]);
  const [analysis, setAnalysis] = useState<ShipmentImportAnalysis | null>(null);
  const [form, setForm] = useState<BatchHeaderForm>(EMPTY_FORM);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const activeZones = useMemo(() => initialZones.filter((z) => z.isActive), [initialZones]);
  const activeCouriers = useMemo(
    () => initialCouriers.filter((c) => c.isActive),
    [initialCouriers],
  );
  const computedWeek = useMemo(
    () => weekFromFormDates(form.shippingDate, form.arrivalDate),
    [form.shippingDate, form.arrivalDate],
  );

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

  async function handleSave(allowEmptyPackages = false) {
    const validRows = preview.filter((r) => r.valid);
    if (!allowEmptyPackages && validRows.length === 0 && preview.length > 0) {
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
      defaultZoneId: form.defaultZoneId || undefined,
      defaultCourierId: form.defaultCourierId || undefined,
      rows: preview,
    };

    const res = await createShipmentBatchAction(input);
    if (!res.ok) {
      setError(res.error);
      setStep(preview.length > 0 ? "preview" : "header");
      return;
    }
    router.push(`/admin/shipments/${res.batchId}`);
  }

  const validCount = preview.filter((r) => r.valid).length;
  const invalidCount = preview.length - validCount;
  const missingFields = new Set(analysis?.missingFields.map((item) => item.field) ?? []);
  const missingText = (field: string) =>
    missingFields.has(field as never) ? "לא קיימת בקובץ" : "—";

  // ─── Step: Header first ────────────────────────────────────────────────────

  if (step === "header" || (step === "saving" && preview.length === 0)) {
    const isSaving = step === "saving";
    return (
      <div className="shp-page">
        <div className="shp-header">
          <FileSpreadsheet size={22} style={{ color: "#2563eb" }} />
          <h1>יצירת משלוח חדש — פרטי משלוח</h1>
        </div>

        <div className="shp-alert shp-alert--info" style={{ maxWidth: 700, marginBottom: 20 }}>
          <AlertCircle size={16} />
          מלאו קודם את פרטי המשלוח הראשיים, ואז הוסיפו חבילות מקובץ Excel (או שמרו משלוח ריק והוסיפו בהמשך).
        </div>

        {error && <div className="shp-alert shp-alert--error">{error}</div>}

        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "20px 24px",
            maxWidth: 800,
            marginBottom: 24,
          }}
        >
          <div className="shp-form-grid">
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
              <label>מספר קרטונים</label>
              <input
                type="number"
                min={0}
                value={form.totalBoxes}
                onChange={(e) => setForm((f) => ({ ...f, totalBoxes: e.target.value }))}
                disabled={isSaving}
              />
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
            <div className="shp-form-field" style={{ gridColumn: "1 / -1" }}>
              <label>הערות</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="shp-btn shp-btn--primary"
            onClick={() => setStep("upload")}
            disabled={isSaving}
          >
            המשך להוספת חבילות (Excel)
          </button>
          <button
            className="shp-btn shp-btn--success"
            onClick={() => void handleSave(true)}
            disabled={isSaving}
          >
            {isSaving ? "שומר..." : "שמור משלוח והמשך לעריכה"}
          </button>
          <button className="shp-btn shp-btn--secondary" onClick={() => router.push("/admin/shipments")} disabled={isSaving}>
            ביטול
          </button>
        </div>
      </div>
    );
  }

  // ─── Step: Upload ──────────────────────────────────────────────────────────

  if (step === "upload") {
    return (
      <div className="shp-page">
        <div className="shp-header">
          <FileSpreadsheet size={22} style={{ color: "#2563eb" }} />
          <h1>הוספת חבילות למשלוח</h1>
          <button className="shp-btn shp-btn--secondary" onClick={() => setStep("header")}>
            ← חזרה לפרטי משלוח
          </button>
        </div>

        {error && <div className="shp-alert shp-alert--error">{error}</div>}

        <div
          className={`shp-import-zone ${dragActive ? "shp-import-zone--active" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
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
            <button className="shp-btn shp-btn--secondary" onClick={() => setStep("header")}>
              ← פרטי משלוח
            </button>
            <button className="shp-btn shp-btn--success" onClick={() => void handleSave(false)} disabled={validCount === 0}>
              שמור משלוח + {validCount} חבילות
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

  if (step === "saving") {
    return (
      <div className="shp-page">
        <div className="shp-alert shp-alert--info">שומר משלוח…</div>
      </div>
    );
  }

  return null;
}
