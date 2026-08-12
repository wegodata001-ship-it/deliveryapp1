"use client";

import { useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import type {
  ShipmentCourierDto,
  ShipmentPaymentStatus,
  ShipmentRecordDto,
  ShipmentZoneDto,
} from "@/app/admin/shipments/types";
import { SHIPMENT_PAYMENT_STATUS_LABELS } from "@/app/admin/shipments/types";
import { openPdfPreview } from "@/lib/pdf-preview";
import type { CourierPdfPreviewRow } from "@/lib/shipment-courier-pdf-types";
import {
  CourierPdfPreviewPanel,
  type CourierPdfRowOverride,
} from "@/components/admin/shipments/CourierPdfPreviewPanel";
import { getEffectiveDeliveryPlaceFromRecord } from "@/lib/shipment-delivery-place";

const MAX_COURIERS = 2;

type Props = {
  /** בסיס לרשימה — בדרך־כלל המשלוחים אחרי מסנני המסך */
  filteredRecords: ShipmentRecordDto[];
  selectedIds: Set<string>;
  couriers: ShipmentCourierDto[];
  zones?: ShipmentZoneDto[];
  batchId?: string | null;
  onSelectAllFiltered: () => void;
  onClose: () => void;
  onSuccess?: (message: string) => void;
};

type ModalFilters = {
  search: string;
  zoneId: string;
  paymentStatus: "" | ShipmentPaymentStatus;
  /** רק משלוחים שמשויכים לשליחים שנבחרו */
  onlySelectedCouriers: boolean;
  /** אם true — מתחילים מהמסומנים בטבלה; אחרת מכל המסוננים במסך */
  useTableSelection: boolean;
};

const EMPTY_FILTERS: ModalFilters = {
  search: "",
  zoneId: "",
  paymentStatus: "",
  onlySelectedCouriers: true,
  useTableSelection: true,
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CourierPdfModal({
  filteredRecords,
  selectedIds,
  couriers,
  zones = [],
  batchId,
  onSelectAllFiltered,
  onClose,
  onSuccess,
}: Props) {
  const [courierIds, setCourierIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<ModalFilters>(() => ({
    ...EMPTY_FILTERS,
    useTableSelection: selectedIds.size > 0,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"configure" | "preview">("configure");
  const [previewCourierId, setPreviewCourierId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<CourierPdfPreviewRow[]>([]);
  const [rowOverrides, setRowOverrides] = useState<Record<string, CourierPdfRowOverride>>({});

  const activeCouriers = useMemo(
    () => couriers.filter((c) => c.isActive),
    [couriers],
  );
  const activeZones = useMemo(
    () => zones.filter((z) => z.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [zones],
  );

  const basePool = useMemo(() => {
    if (filters.useTableSelection && selectedIds.size > 0) {
      return filteredRecords.filter((r) => selectedIds.has(r.id));
    }
    return filteredRecords;
  }, [filteredRecords, selectedIds, filters.useTableSelection]);

  const modalFiltered = useMemo(() => {
    const q = filters.search.trim().toLocaleLowerCase();
    return basePool.filter((r) => {
      if (filters.zoneId && r.zoneId !== filters.zoneId) return false;
      if (filters.paymentStatus && r.paymentStatus !== filters.paymentStatus) return false;
      if (filters.onlySelectedCouriers && courierIds.length > 0) {
        if (!r.courierId || !courierIds.includes(r.courierId)) return false;
      }
      if (q) {
        const hay = [
          r.customerCode,
          r.customerName,
          r.customerPhone,
          r.customerPhone2,
          getEffectiveDeliveryPlaceFromRecord(r),
          r.address,
          r.zoneName,
          r.courierName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [basePool, filters, courierIds]);

  const byCourier = useMemo(() => {
    const map = new Map<string, ShipmentRecordDto[]>();
    for (const id of courierIds) map.set(id, []);
    for (const r of modalFiltered) {
      if (r.courierId && map.has(r.courierId)) {
        map.get(r.courierId)!.push(r);
      }
    }
    // אם נבחר שליח אחד ואין סינון לפי שיוך — כל הרשימה אליו
    if (
      courierIds.length === 1 &&
      !filters.onlySelectedCouriers
    ) {
      map.set(courierIds[0]!, [...modalFiltered]);
    }
    return map;
  }, [modalFiltered, courierIds, filters.onlySelectedCouriers]);

  const selectedCouriers = useMemo(
    () => activeCouriers.filter((c) => courierIds.includes(c.id)),
    [activeCouriers, courierIds],
  );

  const totalForExport = useMemo(() => {
    let n = 0;
    for (const rows of byCourier.values()) n += rows.length;
    return n;
  }, [byCourier]);

  const canExport =
    !busy &&
    courierIds.length >= 1 &&
    courierIds.length <= MAX_COURIERS &&
    totalForExport > 0;

  function toggleCourier(id: string) {
    setCourierIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COURIERS) {
        // מחליף את השני (שומר את הראשון)
        return [prev[0]!, id];
      }
      return [...prev, id];
    });
  }

  async function exportOne(
    courier: ShipmentCourierDto,
    records: ShipmentRecordDto[],
    mode: "preview" | "download",
    overrides: Record<string, CourierPdfRowOverride> = rowOverrides,
  ): Promise<string> {
    const res = await fetch("/api/admin/shipments/courier-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courierId: courier.id,
        recordIds: records.map((r) => r.id),
        batchId: batchId ?? null,
        disposition: mode === "download" ? "attachment" : "inline",
        overrides: records.map((r) => ({
          recordId: r.id,
          customerName: overrides[r.id]?.customerName,
          locality: overrides[r.id]?.locality,
        })),
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || `הפקת PDF לשליח ${courier.name} נכשלה`);
    }

    const blob = await res.blob();
    const filename =
      res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ||
      `kashf-taslim-${courier.name}.pdf`;

    if (mode === "preview") {
      openPdfPreview({ blob, filename, mime: blob.type || "application/pdf" });
    } else {
      downloadBlob(blob, filename);
    }
    return filename;
  }

  async function loadArabicPreview(courierId: string) {
    setError(null);
    const courier = selectedCouriers.find((c) => c.id === courierId);
    const records = byCourier.get(courierId) ?? [];
    if (!courier || records.length === 0) {
      setError("אין משלוחים לתצוגה מקדימה.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/shipments/courier-pdf/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds: records.map((r) => r.id) }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        rows?: CourierPdfPreviewRow[];
      } | null;
      if (!res.ok || !payload?.ok || !payload.rows) {
        throw new Error(payload?.error || "טעינת תצוגה מקדימה נכשלה");
      }
      setPreviewCourierId(courierId);
      setPreviewRows(payload.rows);
      setRowOverrides({});
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveManualArabicName(entry: {
    context: "customer" | "locality";
    originalName: string;
    arabicName: string;
  }) {
    const res = await fetch("/api/admin/shipments/courier-pdf/save-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: [
          {
            context: entry.context,
            originalName: entry.originalName,
            arabicName: entry.arabicName,
          },
        ],
      }),
    });
    const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error || "שמירת תיקון ערבי נכשלה");
    }
  }

  async function runExport(mode: "preview" | "download", courierId?: string | null) {
    setError(null);
    if (courierIds.length === 0) {
      setError("יש לבחור שליח אחד או שניים.");
      return;
    }
    if (totalForExport === 0) {
      setError("אין משלוחים להפקה לפי המסננים שנבחרו.");
      return;
    }

    const empty = selectedCouriers.filter((c) => (byCourier.get(c.id)?.length ?? 0) === 0);
    if (empty.length > 0 && filters.onlySelectedCouriers) {
      setError(
        `אין משלוחים משויכים לשליח: ${empty.map((c) => c.name).join(", ")}. בטל את סינון השליח או שייך משלוחים.`,
      );
      return;
    }

    setBusy(true);
    try {
      const names: string[] = [];
      let count = 0;
      const couriersToExport =
        courierId != null
          ? selectedCouriers.filter((c) => c.id === courierId)
          : selectedCouriers;
      for (const courier of couriersToExport) {
        const rows = byCourier.get(courier.id) ?? [];
        if (rows.length === 0) continue;
        await exportOne(courier, rows, mode, rowOverrides);
        names.push(`${courier.name} (${rows.length})`);
        count += rows.length;
      }
      onSuccess?.(
        mode === "preview"
          ? `תצוגה מקדימה — ${names.join(" · ")}`
          : `PDF הופק — ${count} משלוחים: ${names.join(" · ")}`,
      );
      if (mode === "download") onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tableSelectedCount = selectedIds.size;
  const filteredCount = filteredRecords.length;
  const previewCourier = previewCourierId
    ? selectedCouriers.find((c) => c.id === previewCourierId) ?? null
    : null;

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
        aria-labelledby="courier-pdf-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: step === "preview" ? 1100 : 820,
          width: step === "preview" ? "min(1100px, 98vw)" : "min(820px, 96vw)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header className="shp-modal__head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={18} color="#dc2626" />
          <strong id="courier-pdf-title" style={{ flex: 1 }}>
            {step === "preview" ? "תצוגה מקדימה — كشف تسليم الشحنات" : "הפקת PDF לשליח"}
          </strong>
          <button
            type="button"
            className="shp-modal__header-close"
            onClick={onClose}
            disabled={busy}
            title="סגור"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div
          className="shp-modal__body"
          style={{ display: "grid", gap: 14, overflow: "auto", flex: 1 }}
        >
          {step === "preview" ? (
            <>
              {previewCourier ? (
                <div style={{ fontSize: 13, color: "#475569" }}>
                  שליח: <strong>{previewCourier.name}</strong> · {previewRows.length} משלוחים
                </div>
              ) : null}
              <CourierPdfPreviewPanel
                rows={previewRows}
                overrides={rowOverrides}
                onOverridesChange={setRowOverrides}
                onSaveManualName={async (entry) => {
                  await saveManualArabicName(entry);
                }}
                busy={busy}
              />
            </>
          ) : (
            <>
          <div
            className="shp-alert"
            style={{
              background: totalForExport === 0 ? "#fef2f2" : "#eff6ff",
              color: totalForExport === 0 ? "#991b1b" : "#1e40af",
              margin: 0,
            }}
          >
            {totalForExport === 0
              ? "אין משלוחים להפקה — עדכן מסננים או בחר שליח."
              : `יופקו ${courierIds.length || "—"} קבצים · ${totalForExport} משלוחים בסך הכל`}
          </div>

          {/* היקף בסיס */}
          <fieldset
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
              margin: 0,
            }}
          >
            <legend style={{ padding: "0 6px", fontSize: 12, color: "#64748b" }}>היקף משלוחים</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="radio"
                  name="courier-pdf-scope"
                  checked={filters.useTableSelection}
                  disabled={busy || tableSelectedCount === 0}
                  onChange={() => setFilters((f) => ({ ...f, useTableSelection: true }))}
                />
                מסומנים בטבלה ({tableSelectedCount})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="radio"
                  name="courier-pdf-scope"
                  checked={!filters.useTableSelection}
                  disabled={busy}
                  onChange={() => setFilters((f) => ({ ...f, useTableSelection: false }))}
                />
                כל המסוננים במסך ({filteredCount})
              </label>
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                disabled={busy || filteredCount === 0}
                onClick={() => onSelectAllFiltered()}
              >
                סמן הכל במסך
              </button>
            </div>
          </fieldset>

          {/* מסננים */}
          <fieldset
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
              margin: 0,
            }}
          >
            <legend style={{ padding: "0 6px", fontSize: 12, color: "#64748b" }}>מסננים להפקה</legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              <div className="shp-form-field" style={{ margin: 0 }}>
                <label htmlFor="courier-pdf-search">חיפוש</label>
                <input
                  id="courier-pdf-search"
                  value={filters.search}
                  disabled={busy}
                  placeholder="שם / קוד / יישוב / טלפון…"
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                />
              </div>
              <div className="shp-form-field" style={{ margin: 0 }}>
                <label htmlFor="courier-pdf-zone">אזור חלוקה</label>
                <select
                  id="courier-pdf-zone"
                  value={filters.zoneId}
                  disabled={busy}
                  onChange={(e) => setFilters((f) => ({ ...f, zoneId: e.target.value }))}
                >
                  <option value="">הכל</option>
                  {activeZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="shp-form-field" style={{ margin: 0 }}>
                <label htmlFor="courier-pdf-pay">סטטוס תשלום</label>
                <select
                  id="courier-pdf-pay"
                  value={filters.paymentStatus}
                  disabled={busy}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      paymentStatus: e.target.value as ModalFilters["paymentStatus"],
                    }))
                  }
                >
                  <option value="">הכל</option>
                  {(Object.keys(SHIPMENT_PAYMENT_STATUS_LABELS) as ShipmentPaymentStatus[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {SHIPMENT_PAYMENT_STATUS_LABELS[k]}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                marginTop: 10,
                color: "#334155",
              }}
            >
              <input
                type="checkbox"
                checked={filters.onlySelectedCouriers}
                disabled={busy}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, onlySelectedCouriers: e.target.checked }))
                }
              />
              הצג רק משלוחים שמשויכים לשליחים שנבחרו
            </label>
            <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
              אחרי מסננים: <strong>{modalFiltered.length}</strong> משלוחים
              {filters.search || filters.zoneId || filters.paymentStatus
                ? " (מסונן)"
                : ""}
            </div>
          </fieldset>

          {/* בחירת שליחים — עד 2 */}
          <fieldset
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
              margin: 0,
            }}
          >
            <legend style={{ padding: "0 6px", fontSize: 12, color: "#64748b" }}>
              בחירת שליחים (עד {MAX_COURIERS})
            </legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 8,
              }}
            >
              {activeCouriers.length === 0 ? (
                <span style={{ fontSize: 13, color: "#94a3b8" }}>אין שליחים פעילים</span>
              ) : (
                activeCouriers.map((c) => {
                  const checked = courierIds.includes(c.id);
                  const count = byCourier.get(c.id)?.length ?? 0;
                  const disabledAdd = !checked && courierIds.length >= MAX_COURIERS;
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: checked ? "1px solid #dc2626" : "1px solid #e2e8f0",
                        background: checked ? "#fef2f2" : "#fff",
                        cursor: disabledAdd ? "not-allowed" : "pointer",
                        opacity: disabledAdd ? 0.55 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy || disabledAdd}
                        onChange={() => toggleCourier(c.id)}
                      />
                      <span style={{ flex: 1 }}>{c.name}</span>
                      {checked ? (
                        <span style={{ fontSize: 11, color: "#64748b" }}>{count}</span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>
            {selectedCouriers.length > 0 ? (
              <ul style={{ margin: "10px 0 0", paddingInlineStart: 18, fontSize: 12, color: "#475569" }}>
                {selectedCouriers.map((c) => (
                  <li key={c.id}>
                    PDF ל־<strong>{c.name}</strong>: {byCourier.get(c.id)?.length ?? 0} משלוחים
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>
                בחר שליח אחד או שניים — יופק קובץ נפרד לכל שליח.
              </p>
            )}
          </fieldset>

          {error && (
            <div className="shp-alert shp-alert--error" style={{ margin: 0 }}>
              {error}
            </div>
          )}
            </>
          )}
        </div>

        <footer
          className="shp-modal__foot"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" }}
        >
          {step === "preview" ? (
            <>
              <button
                type="button"
                className="shp-btn shp-btn--secondary"
                disabled={busy}
                onClick={() => {
                  setStep("configure");
                  setPreviewRows([]);
                  setPreviewCourierId(null);
                }}
              >
                חזרה
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--secondary"
                disabled={busy || !previewCourierId}
                onClick={() => void runExport("preview", previewCourierId)}
              >
                תצוגת PDF
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                disabled={busy || !previewCourierId}
                onClick={() => void runExport("download", previewCourierId)}
              >
                {busy ? "מפיק…" : "הורד PDF"}
              </button>
            </>
          ) : (
            <>
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={!canExport || courierIds.length !== 1}
            onClick={() => void loadArabicPreview(courierIds[0]!)}
            title={courierIds.length !== 1 ? "תצוגה מקדימה זמינה לשליח אחד בכל פעם" : undefined}
          >
            תצוגה מקדימה בערבית
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={!canExport}
            onClick={() => void runExport("preview")}
          >
            תצוגת PDF
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={!canExport}
            onClick={() => void runExport("download")}
          >
            {busy
              ? "מפיק…"
              : courierIds.length > 1
                ? `הפקת ${courierIds.length} קבצי PDF`
                : "הפקת PDF"}
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={busy}
            onClick={onClose}
          >
            ביטול
          </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
