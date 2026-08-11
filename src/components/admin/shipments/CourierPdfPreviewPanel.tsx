"use client";

import { useMemo, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import type { CourierPdfPreviewRow } from "@/lib/shipment-courier-pdf-types";

export type CourierPdfRowOverride = {
  customerName?: string;
  locality?: string;
};

type Props = {
  rows: CourierPdfPreviewRow[];
  overrides: Record<string, CourierPdfRowOverride>;
  onOverridesChange: (next: Record<string, CourierPdfRowOverride>) => void;
  onSaveManualName: (entry: {
    context: "customer" | "locality";
    originalName: string;
    arabicName: string;
    recordId: string;
    field: "customerName" | "locality";
  }) => Promise<void>;
  busy?: boolean;
};

type EditState = {
  recordId: string;
  field: "customerName" | "locality";
  value: string;
};

export function CourierPdfPreviewPanel({
  rows,
  overrides,
  onOverridesChange,
  onSaveManualName,
  busy = false,
}: Props) {
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const displayRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        customerName: overrides[row.recordId]?.customerName ?? row.customerName,
        locality: overrides[row.recordId]?.locality ?? row.locality,
      })),
    [rows, overrides],
  );

  async function commitEdit() {
    if (!edit) return;
    const row = rows.find((r) => r.recordId === edit.recordId);
    if (!row) return;

    setSaving(true);
    try {
      const originalName =
        edit.field === "customerName" ? row.originalCustomerName : row.originalLocality;
      await onSaveManualName({
        context: edit.field === "customerName" ? "customer" : "locality",
        originalName,
        arabicName: edit.value.trim(),
        recordId: edit.recordId,
        field: edit.field,
      });
      onOverridesChange({
        ...overrides,
        [edit.recordId]: {
          ...overrides[edit.recordId],
          [edit.field]: edit.value.trim(),
        },
      });
      setEdit(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          textAlign: "center",
          fontSize: 18,
          fontWeight: 700,
          color: "#1e3a5f",
          fontFamily: '"Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif',
        }}
      >
        كشف تسليم الشحنات
      </div>
      <div style={{ overflow: "auto", border: "1px solid #cbd5e1", borderRadius: 8 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            direction: "rtl",
            fontFamily: '"Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif',
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#1e3a5f", color: "#fff" }}>
              {["كود", "عدد", "اسم الزبون", "البلد", "مبلغ", "تحصيل", "هاتف", "شحنة"].map(
                (h) => (
                  <th key={h} style={{ padding: "6px 4px", border: "1px solid #64748b" }}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const editingCustomer =
                edit?.recordId === row.recordId && edit.field === "customerName";
              const editingLocality =
                edit?.recordId === row.recordId && edit.field === "locality";

              return (
                <tr key={row.recordId}>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", direction: "ltr" }}>
                    {row.code}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", direction: "ltr" }}>
                    {row.boxes}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", textAlign: "right" }}>
                    {editingCustomer ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          value={edit.value}
                          disabled={busy || saving}
                          onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                          style={{ flex: 1, minWidth: 0 }}
                          dir="rtl"
                        />
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm"
                          disabled={busy || saving}
                          onClick={() => void commitEdit()}
                          title="שמור"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm shp-btn--secondary"
                          disabled={busy || saving}
                          onClick={() => setEdit(null)}
                          title="ביטול"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 2 }}>
                        <span>{row.customerName}</span>
                        {row.customerNeedsReview && !overrides[row.recordId]?.customerName ? (
                          <span style={{ fontSize: 10, color: "#b45309" }}>
                            מקור: {row.originalCustomerName}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm shp-btn--secondary"
                          disabled={busy || saving}
                          onClick={() =>
                            setEdit({
                              recordId: row.recordId,
                              field: "customerName",
                              value: row.customerName,
                            })
                          }
                          title="עריכת שם בערבית"
                        >
                          <Pencil size={12} /> עריכה
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", textAlign: "right" }}>
                    {editingLocality ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          value={edit.value}
                          disabled={busy || saving}
                          onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                          style={{ flex: 1, minWidth: 0 }}
                          dir="rtl"
                        />
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm"
                          disabled={busy || saving}
                          onClick={() => void commitEdit()}
                          title="שמור"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm shp-btn--secondary"
                          disabled={busy || saving}
                          onClick={() => setEdit(null)}
                          title="ביטול"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 2 }}>
                        <span>{row.locality}</span>
                        {row.localityNeedsReview && !overrides[row.recordId]?.locality ? (
                          <span style={{ fontSize: 10, color: "#b45309" }}>
                            מקור: {row.originalLocality}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm shp-btn--secondary"
                          disabled={busy || saving}
                          onClick={() =>
                            setEdit({
                              recordId: row.recordId,
                              field: "locality",
                              value: row.locality,
                            })
                          }
                          title="עריכת יישוב בערבית"
                        >
                          <Pencil size={12} /> עריכה
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", direction: "ltr" }}>
                    {row.fee}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", direction: "ltr" }}>
                    {row.collect}
                  </td>
                  <td
                    style={{
                      padding: 4,
                      border: "1px solid #cbd5e1",
                      direction: "ltr",
                      whiteSpace: "pre-line",
                    }}
                  >
                    {row.phone}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #cbd5e1", direction: "ltr" }}>
                    {row.shipment}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
        התצוגה מציגה את התוצאה הסופית בערבית. ניתן לתקן שמות לקוחות ויישובים לפני הפקת PDF — התיקון
        נשמר לשימוש עתידי.
      </p>
    </div>
  );
}
