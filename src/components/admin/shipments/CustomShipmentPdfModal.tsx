"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import type { ShipmentRecordDto } from "@/app/admin/shipments/types";
import { openPdfPreview } from "@/lib/pdf-preview";
import {
  buildCustomPdfRows,
  buildCustomPdfSummary,
  CUSTOM_PDF_COLUMNS,
  DEFAULT_CUSTOM_PDF_OPTIONS,
  type CustomPdfColumnKey,
  type CustomPdfOptions,
} from "@/lib/shipment-custom-pdf";

type Props = {
  filteredRecords: ShipmentRecordDto[];
  selectedIds: Set<string>;
  /** כשמסונן לפי אמצעי תשלום — סכומי הגבייה ב-PDF לפי פירוט האמצעי */
  paymentMethodFilter?: string | string[] | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
};

export function CustomShipmentPdfModal({
  filteredRecords,
  selectedIds,
  paymentMethodFilter = null,
  onClose,
  onSuccess,
}: Props) {
  const [selectedKeys, setSelectedKeys] = useState<CustomPdfColumnKey[]>(() =>
    CUSTOM_PDF_COLUMNS.filter((c) => c.defaultSelected).map((c) => c.key),
  );
  const [options, setOptions] = useState<CustomPdfOptions>({ ...DEFAULT_CUSTOM_PDF_OPTIONS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceRecords = useMemo(() => {
    if (selectedIds.size > 0) {
      return filteredRecords.filter((r) => selectedIds.has(r.id));
    }
    return filteredRecords;
  }, [filteredRecords, selectedIds]);

  const scopeLabel =
    selectedIds.size > 0
      ? `יופקו ${sourceRecords.length} משלוחים מסומנים`
      : `יופקו ${sourceRecords.length} משלוחים מסוננים במסך`;

  function toggleColumn(key: CustomPdfColumnKey) {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // שומר על סדר הטבלה
      const order = CUSTOM_PDF_COLUMNS.map((c) => c.key);
      const next = [...prev, key];
      return next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    });
  }

  function selectAllColumns() {
    setSelectedKeys(CUSTOM_PDF_COLUMNS.map((c) => c.key));
  }

  function selectDefaultColumns() {
    setSelectedKeys(CUSTOM_PDF_COLUMNS.filter((c) => c.defaultSelected).map((c) => c.key));
  }

  function patchOptions(patch: Partial<CustomPdfOptions>) {
    setOptions((o) => ({ ...o, ...patch }));
  }

  async function runExport(mode: "preview" | "download") {
    setError(null);
    if (selectedKeys.length === 0) {
      setError("יש לבחור לפחות עמודה אחת.");
      return;
    }
    if (sourceRecords.length === 0) {
      setError("אין משלוחים להפקה.");
      return;
    }

    const columns = selectedKeys.map((key) => {
      const def = CUSTOM_PDF_COLUMNS.find((c) => c.key === key)!;
      return { key, label: def.label };
    });
    const pdfOpts = { paymentMethodFilter };
    const rows = buildCustomPdfRows(sourceRecords, selectedKeys, pdfOpts);
    const summary = options.showSummary
      ? buildCustomPdfSummary(sourceRecords, pdfOpts)
      : [];

    setBusy(true);
    try {
      const res = await fetch("/api/admin/shipments/custom-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns,
          rows,
          options,
          summary,
          disposition: mode === "download" ? "attachment" : "inline",
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "הפקת PDF נכשלה");
      }

      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ||
        "shipments-custom.pdf";

      if (mode === "preview") {
        openPdfPreview({ blob, filename, mime: blob.type || "application/pdf" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      onSuccess?.(
        mode === "preview"
          ? `תצוגה מקדימה — PDF מותאם (${sourceRecords.length} שורות)`
          : `PDF מותאם הופק — ${sourceRecords.length} שורות`,
      );
      if (mode === "download") onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canExport = !busy && selectedKeys.length > 0 && sourceRecords.length > 0;

  return (
    <div
      className="shp-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="shp-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-pdf-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 760,
          width: "min(760px, 96vw)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header className="shp-modal__head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileSpreadsheet size={18} color="#2563eb" />
          <strong id="custom-pdf-title" style={{ flex: 1 }}>
            PDF מותאם אישית
          </strong>
          <button
            type="button"
            className="shp-modal__header-close"
            onClick={onClose}
            disabled={busy}
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div
          className="shp-modal__body"
          style={{ display: "grid", gap: 14, overflow: "auto", flex: 1 }}
        >
          <div
            className="shp-alert"
            style={{
              margin: 0,
              background: sourceRecords.length === 0 ? "#fef2f2" : "#eff6ff",
              color: sourceRecords.length === 0 ? "#991b1b" : "#1e40af",
            }}
          >
            {sourceRecords.length === 0 ? "אין משלוחים להפקה." : scopeLabel}
            {selectedIds.size === 0 ? " (לא סומנו שורות — לפי המסננים במסך)" : ""}
          </div>

          <fieldset
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
              margin: 0,
            }}
          >
            <legend style={{ padding: "0 6px", fontSize: 12, color: "#64748b" }}>
              בחירת עמודות ({selectedKeys.length}/{CUSTOM_PDF_COLUMNS.length})
            </legend>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                disabled={busy}
                onClick={selectAllColumns}
              >
                בחר הכל
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                disabled={busy}
                onClick={selectDefaultColumns}
              >
                ברירת מחדל
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                disabled={busy}
                onClick={() => setSelectedKeys([])}
              >
                נקה
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 8,
              }}
            >
              {CUSTOM_PDF_COLUMNS.map((col) => {
                const checked = selectedKeys.includes(col.key);
                return (
                  <label
                    key={col.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      padding: "7px 9px",
                      borderRadius: 8,
                      border: checked ? "1px solid #2563eb" : "1px solid #e2e8f0",
                      background: checked ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
              margin: 0,
            }}
          >
            <legend style={{ padding: "0 6px", fontSize: 12, color: "#64748b" }}>
              אפשרויות דוח
            </legend>
            <div className="shp-form-field" style={{ margin: "0 0 10px" }}>
              <label htmlFor="custom-pdf-title-input">כותרת לדוח</label>
              <input
                id="custom-pdf-title-input"
                value={options.title}
                disabled={busy || !options.showTitle}
                onChange={(e) => patchOptions({ title: e.target.value })}
                placeholder="דוח משלוחים"
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 8,
              }}
            >
              {(
                [
                  ["showTitle", "כותרת לדוח"],
                  ["showGeneratedAt", "תאריך הפקה"],
                  ["showPageNumbers", "מספר עמוד"],
                  ["showLogo", "לוגו החברה"],
                  ["showSummary", "סיכום בסוף הדוח"],
                  ["rtl", "כיוון RTL"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    checked={options[key]}
                    disabled={busy}
                    onChange={(e) => patchOptions({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                fontSize: 13,
              }}
            >
              <span style={{ color: "#64748b" }}>גודל דף: A4</span>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="custom-pdf-orient"
                  checked={options.landscape}
                  disabled={busy}
                  onChange={() => patchOptions({ landscape: true })}
                />
                מצב לרוחב (Landscape)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="custom-pdf-orient"
                  checked={!options.landscape}
                  disabled={busy}
                  onChange={() => patchOptions({ landscape: false })}
                />
                מצב לאורך (Portrait)
              </label>
            </div>
          </fieldset>

          {error ? (
            <div className="shp-alert shp-alert--error" style={{ margin: 0 }}>
              {error}
            </div>
          ) : null}
        </div>

        <footer
          className="shp-modal__foot"
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        >
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={!canExport}
            onClick={() => void runExport("preview")}
          >
            תצוגה מקדימה
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={!canExport}
            onClick={() => void runExport("download")}
          >
            {busy ? "מפיק…" : "הפק PDF"}
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={busy}
            onClick={onClose}
          >
            ביטול
          </button>
        </footer>
      </div>
    </div>
  );
}
