"use client";

import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload, Trash2, RefreshCw, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";
import type { ExcelShipmentPreviewRow, ShipmentCourierDto, ShipmentZoneDto } from "@/app/admin/shipments/types";
import { importRowsIntoBatchAction } from "@/app/admin/shipments/actions";
import { analyzeShipmentWorkbook } from "@/lib/shipment-import-detector";

type Props = {
  open: boolean;
  batchId: string;
  zones: ShipmentZoneDto[];
  couriers: ShipmentCourierDto[];
  onClose: () => void;
  onImported: () => void;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ShipmentBatchImportModal({
  open,
  batchId,
  zones,
  couriers,
  onClose,
  onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [preview, setPreview] = useState<ExcelShipmentPreviewRow[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [courierId, setCourierId] = useState("");
  const [saving, setSaving] = useState(false);

  const activeZones = useMemo(() => zones.filter((z) => z.isActive), [zones]);
  const activeCouriers = useMemo(() => couriers.filter((c) => c.isActive), [couriers]);
  const validCount = preview.filter((r) => r.valid).length;
  const uniqueCustomers = useMemo(() => {
    const keys = new Set<string>();
    for (const r of preview) {
      const k = (r.customerCode || r.customerName || "").trim();
      if (k) keys.add(k);
    }
    return keys.size;
  }, [preview]);

  if (!open) return null;

  function clearFile() {
    setPreview([]);
    setFileName(null);
    setFileSize(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError("קובץ לא נתמך. יש להעלות Excel או CSV.");
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
        if (!detected.rows.length) {
          setPreview([]);
          setError("לא נמצאו שורות לייבוא בקובץ.");
          return;
        }
        setPreview(detected.rows);
      } catch (err) {
        setError("שגיאה בקריאת הקובץ: " + String(err));
        setPreview([]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (validCount === 0) {
      setError("אין שורות תקינות לייבוא.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await importRowsIntoBatchAction({
      batchId,
      rows: preview,
      defaultZoneId: zoneId || undefined,
      defaultCourierId: courierId || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onImported();
    onClose();
  }

  return (
    <div className="msh-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="msh-modal"
        style={{ maxWidth: 640 }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="msh-modal__head">
          <h2>ייבוא קובץ Excel למשלוח</h2>
          <button type="button" className="shp-btn" onClick={onClose}>
            סגור
          </button>
        </div>
        <div className="msh-form">
          {error && (
            <div className="shp-alert shp-alert--error" style={{ marginBottom: 12 }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {!fileName ? (
            <div
              className={`shp-import-zone ${dragActive ? "shp-import-zone--active" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processFile(file);
              }}
            >
              <div className="shp-import-zone__icon">
                <Upload size={36} />
              </div>
              <div className="shp-import-zone__text">📄 העלאת קובץ Excel</div>
              <div className="shp-import-zone__sub">או גרירה ושחרור</div>
            </div>
          ) : (
            <div className="shp-file-card">
              <div className="shp-file-card__icon">
                <FileSpreadsheet size={24} />
              </div>
              <div className="shp-file-card__meta">
                <div className="shp-file-card__name">{fileName}</div>
                <div className="shp-file-card__stats">
                  {fileSize != null ? <span>{formatFileSize(fileSize)}</span> : null}
                  <span>{preview.length} שורות</span>
                  <span>{uniqueCustomers} לקוחות</span>
                  <span className="shp-file-card__ok">{validCount} תקינות</span>
                </div>
              </div>
              <div className="shp-file-card__actions">
                <button
                  type="button"
                  className="shp-btn shp-btn--secondary shp-btn--sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <RefreshCw size={14} />
                  החלף
                </button>
                <button type="button" className="shp-btn shp-btn--danger shp-btn--sm" onClick={clearFile}>
                  <Trash2 size={14} />
                  מחק
                </button>
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
            }}
          />

          <div className="shp-form-grid" style={{ marginTop: 12 }}>
            <div className="shp-form-field">
              <label>אזור ברירת מחדל</label>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={saving}>
                <option value="">ללא</option>
                {activeZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="shp-form-field">
              <label>שליח ברירת מחדל</label>
              <select value={courierId} onChange={(e) => setCourierId(e.target.value)} disabled={saving}>
                <option value="">ללא</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="msh-modal__foot">
          <button type="button" className="shp-btn" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--success"
            onClick={() => void handleImport()}
            disabled={saving || validCount === 0}
          >
            {saving ? "מייבא…" : `ייבא ${validCount || ""} שורות`}
          </button>
        </div>
      </div>
    </div>
  );
}
