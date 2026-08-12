"use client";

import { useRef, useState } from "react";
import { Eye, FileSpreadsheet, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import type {
  DeliveryFeeImportBreakdown,
  DeliveryFeeImportPreview,
  DeliveryFeeImportPreviewRow,
  DeliveryFeeImportResult,
} from "@/lib/shipment-delivery-fee-import";
import {
  deliveryFeeImportReportRowsForExport,
  deliveryFeeImportReportStatusLabel,
} from "@/lib/shipment-delivery-fee-import";
import {
  commitDeliveryFeeImportAction,
  previewDeliveryFeeImportAction,
} from "@/app/admin/shipments/actions";
import { ShipmentDeliveryFeeImportDetailModal } from "@/components/admin/shipments/ShipmentDeliveryFeeImportDetailModal";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";

type Props = {
  batchId: string;
  shipmentLabel: string;
  onClose: () => void;
  onDone?: () => void;
};

type Step = "upload" | "preview" | "result";

function fmtIls(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0 });
}

function fmtFeeChange(before: number | null | undefined, after: number | null | undefined) {
  return `${fmtIls(before ?? 0)} → ${fmtIls(after ?? 0)}`;
}

function statusBadge(status: string) {
  if (status === "will_update") return "✅";
  if (status === "no_match") return "⚠️";
  if (status === "duplicate") return "⚠️";
  return "⚠️";
}

function exportResultExcel(rows: DeliveryFeeImportResult["rows"], shipmentLabel: string) {
  const data = deliveryFeeImportReportRowsForExport(rows);
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "דוח עדכון");
  XLSX.writeFile(wb, `delivery-fee-update-${shipmentLabel.replace(/[^\w-]+/g, "_")}.xlsx`);
}

function ImportReportTable({ rows }: { rows: DeliveryFeeImportResult["rows"] }) {
  return (
    <div className="shp-table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
      <table className="shp-table shp-table--compact">
        <thead>
          <tr>
            <th>קוד לקוח</th>
            <th>שם לקוח</th>
            <th>קרטונים במערכת</th>
            <th>קרטונים בקובץ</th>
            <th>לפני</th>
            <th>אחרי</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.customerCode}-${row.excelRow ?? i}`}>
              <td dir="ltr">{row.customerCode}</td>
              <td>{row.customerName ?? "—"}</td>
              <td dir="ltr">{row.systemBoxes ?? "—"}</td>
              <td dir="ltr">{row.fileBoxes ?? "—"}</td>
              <td dir="ltr">{fmtIls(row.feeBeforeIls)}</td>
              <td dir="ltr">{fmtIls(row.feeAfterIls)}</td>
              <td>{deliveryFeeImportReportStatusLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShipmentDeliveryFeeImportModal({ batchId, shipmentLabel, onClose, onDone }: Props) {
  const { workCountry } = useShipmentCountry();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeliveryFeeImportPreview | null>(null);
  const [result, setResult] = useState<DeliveryFeeImportResult | null>(null);
  const [detailBreakdown, setDetailBreakdown] = useState<DeliveryFeeImportBreakdown | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  async function onImportFile(file: File) {
    setBusy(true);
    setMsg(null);
    setPreview(null);
    setResult(null);
    setReportOpen(false);
    setStep("upload");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const res = await previewDeliveryFeeImportAction(workCountry, batchId, grid);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setPreview(res.preview);
      setStep("preview");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!preview) return;
    if (preview.updates.length === 0) {
      setMsg("אין רשומות לעדכון — בדקו התאמות בקובץ");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await commitDeliveryFeeImportAction(workCountry, batchId, preview);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setResult(res.result);
      setReportOpen(false);
      setStep("result");
      onDone?.();
    } catch (e) {
      setMsg(`הייבוא נכשל: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function openDetail(row: DeliveryFeeImportPreviewRow) {
    setDetailBreakdown(row.breakdown);
  }

  return (
    <>
      <div className="shp-modal-backdrop" onClick={busy ? undefined : onClose}>
        <div
          className="shp-modal"
          style={{ maxWidth: 1040, width: "96vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shp-modal__header">
            <strong>הוסף תמחור דמי משלוח</strong>
            <button type="button" className="shp-icon-btn" onClick={onClose} disabled={busy}>
              <X size={16} />
            </button>
          </div>

          <div className="shp-modal__body" style={{ overflow: "auto", display: "grid", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              משלוח: <strong dir="ltr">{shipmentLabel}</strong> · התאמה לפי קוד לקוח + סך קרטונים
            </p>

            {step === "upload" && (
              <div
                style={{
                  border: "2px dashed #cbd5e1",
                  borderRadius: 12,
                  padding: 24,
                  textAlign: "center",
                  background: "#f8fafc",
                }}
              >
                <Upload size={28} style={{ color: "#64748b", marginBottom: 8 }} />
                <p style={{ margin: "0 0 12px", fontWeight: 600 }}>בחרו קובץ Excel</p>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
                  כותרות בקובץ (ערבית): عدد · كود · اجور الشحن
                </p>
                <button
                  type="button"
                  className="shp-btn shp-btn--primary shp-btn--sm"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  <FileSpreadsheet size={14} />
                  טעינת קובץ
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {step === "preview" && preview && (
              <>
                <div className="shp-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                  <div className="shp-stat-card">
                    <div className="shp-stat-card__value">{preview.totalFileRows}</div>
                    <div className="shp-stat-card__label">רשומות בקובץ</div>
                  </div>
                  <div className="shp-stat-card">
                    <div className="shp-stat-card__value">{preview.matchedCustomers}</div>
                    <div className="shp-stat-card__label">נמצאה התאמה</div>
                  </div>
                  <div className="shp-stat-card">
                    <div className="shp-stat-card__value">{preview.willUpdateCount}</div>
                    <div className="shp-stat-card__label">יעודכנו</div>
                  </div>
                  <div className="shp-stat-card">
                    <div className="shp-stat-card__value">{preview.noMatchCount}</div>
                    <div className="shp-stat-card__label">ללא התאמה</div>
                  </div>
                  <div className="shp-stat-card">
                    <div className="shp-stat-card__value">{preview.duplicateCount}</div>
                    <div className="shp-stat-card__label">כפילויות</div>
                  </div>
                  <div className="shp-stat-card">
                    <div className="shp-stat-card__value">{preview.errorCount}</div>
                    <div className="shp-stat-card__label">שגיאות</div>
                  </div>
                </div>

                <div className="shp-table-wrap" style={{ maxHeight: 400, overflow: "auto" }}>
                  <table className="shp-table shp-table--compact">
                    <thead>
                      <tr>
                        <th>סטטוס</th>
                        <th>קוד</th>
                        <th>שם</th>
                        <th>קרטונים קובץ</th>
                        <th>קרטונים מערכת</th>
                        <th>עדכון דמי משלוח</th>
                        <th>פירוט דמי משלוח</th>
                        <th>הודעה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={`${row.customerCode}-${row.excelRow ?? i}`}>
                          <td>{statusBadge(row.status)}</td>
                          <td dir="ltr">{row.customerCode}</td>
                          <td>{row.customerName ?? "—"}</td>
                          <td dir="ltr">{row.fileBoxes ?? "—"}</td>
                          <td dir="ltr">{row.systemBoxes ?? "—"}</td>
                          <td dir="ltr" style={{ fontWeight: 600 }}>
                            {row.status === "will_update"
                              ? fmtFeeChange(row.feeBeforeIls, row.feeAfterIls)
                              : fmtIls(row.fileFeeIls)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="shp-btn shp-btn--secondary shp-btn--sm"
                              onClick={() => openDetail(row)}
                            >
                              <Eye size={13} />
                              הצג פירוט
                            </button>
                          </td>
                          <td style={{ fontSize: 12 }}>{row.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="shp-btn shp-btn--secondary shp-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setStep("upload");
                      setPreview(null);
                    }}
                  >
                    קובץ אחר
                  </button>
                  <button
                    type="button"
                    className="shp-btn shp-btn--primary shp-btn--sm"
                    disabled={busy || preview.willUpdateCount === 0}
                    onClick={() => void commitImport()}
                  >
                    אישור ועדכון ({preview.willUpdateCount})
                  </button>
                </div>
              </>
            )}

            {step === "result" && result && (
              <>
                <div className="shp-alert shp-alert--success">העדכון הושלם בהצלחה</div>
                <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 15, lineHeight: 1.8 }}>
                  <li>{result.totalFileRows} רשומות נקראו מהקובץ</li>
                  <li>{result.updatedCount} לקוחות עודכנו</li>
                  <li>{result.noMatchCount} לא נמצאה התאמה</li>
                  <li>{result.duplicateCount} התאמה כפולה</li>
                  <li>{result.errorCount} שגיאות</li>
                </ul>

                {reportOpen ? <ImportReportTable rows={result.rows} /> : null}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="shp-btn shp-btn--secondary shp-btn--sm"
                    onClick={() => setReportOpen((v) => !v)}
                  >
                    <Eye size={14} />
                    {reportOpen ? "הסתר דוח עדכון" : "הצג דוח עדכון"}
                  </button>
                  <button
                    type="button"
                    className="shp-btn shp-btn--secondary shp-btn--sm"
                    onClick={() => exportResultExcel(result.rows, shipmentLabel)}
                  >
                    <FileSpreadsheet size={14} />
                    ייצוא דוח Excel
                  </button>
                  <button type="button" className="shp-btn shp-btn--primary shp-btn--sm" onClick={onClose}>
                    סגירה
                  </button>
                </div>
              </>
            )}

            {msg && <div className="shp-alert shp-alert--error">{msg}</div>}
          </div>
        </div>
      </div>

      {detailBreakdown ? (
        <ShipmentDeliveryFeeImportDetailModal
          breakdown={detailBreakdown}
          onClose={() => setDetailBreakdown(null)}
        />
      ) : null}
    </>
  );
}

export default ShipmentDeliveryFeeImportModal;
