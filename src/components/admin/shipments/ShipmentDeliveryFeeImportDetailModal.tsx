"use client";

import { X } from "lucide-react";
import type { DeliveryFeeImportBreakdown } from "@/lib/shipment-delivery-fee-import";

function fmtIls(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0 });
}

function fmtFeeChange(before: number | null | undefined, after: number | null | undefined) {
  const b = before ?? 0;
  const a = after ?? 0;
  if (a == null && b == null) return "—";
  return `${fmtIls(b)} → ${fmtIls(a)}`;
}

type Props = {
  breakdown: DeliveryFeeImportBreakdown;
  onClose: () => void;
};

export function ShipmentDeliveryFeeImportDetailModal({ breakdown, onClose }: Props) {
  const multiLines = breakdown.systemLines.length > 1;

  return (
    <div
      className="shp-modal-backdrop"
      style={{ zIndex: 1300 }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="shp-modal"
        style={{ maxWidth: 440, width: "92vw" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="fee-import-detail-title"
      >
        <div className="shp-modal__header">
          <strong id="fee-import-detail-title">פירוט דמי משלוח</strong>
          <button type="button" className="shp-icon-btn" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 12, fontSize: 14 }}>
          <div>
            <div style={{ color: "#64748b", fontSize: 12 }}>לקוח</div>
            <strong dir="ltr">{breakdown.customerCode}</strong>
          </div>
          {breakdown.customerName ? (
            <div>
              <div style={{ color: "#64748b", fontSize: 12 }}>שם</div>
              <span>{breakdown.customerName}</span>
            </div>
          ) : null}

          {multiLines ? (
            <div>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>קרטונים במערכת</div>
              <ul style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 4 }}>
                {breakdown.systemLines.map((line) => (
                  <li key={line.label}>{line.label}</li>
                ))}
              </ul>
              <div style={{ marginTop: 8, fontWeight: 700 }}>
                סה&quot;כ קרטונים: {breakdown.systemTotalBoxes ?? "—"}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ color: "#64748b", fontSize: 12 }}>מספר קרטונים במערכת</div>
              <strong>{breakdown.systemTotalBoxes ?? "—"}</strong>
              {breakdown.systemLines[0] ? (
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  {breakdown.systemLines[0].label}
                </div>
              ) : null}
            </div>
          )}

          <div>
            <div style={{ color: "#64748b", fontSize: 12 }}>מספר קרטונים בקובץ</div>
            <strong>{breakdown.fileBoxes ?? "—"}</strong>
          </div>

          <div>
            <div style={{ color: "#64748b", fontSize: 12 }}>דמי משלוח מהקובץ</div>
            <strong dir="ltr">{fmtIls(breakdown.fileFeeIls)}</strong>
          </div>

          {(breakdown.feeBeforeIls != null || breakdown.feeAfterIls != null) && (
            <div>
              <div style={{ color: "#64748b", fontSize: 12 }}>עדכון דמי משלוח</div>
              <strong dir="ltr">{fmtFeeChange(breakdown.feeBeforeIls, breakdown.feeAfterIls)}</strong>
            </div>
          )}

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: breakdown.matchOk ? "#f0fdf4" : "#fffbeb",
              border: `1px solid ${breakdown.matchOk ? "#bbf7d0" : "#fde68a"}`,
            }}
          >
            <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>התאמה</div>
            <span style={{ fontWeight: 700 }}>{breakdown.matchLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShipmentDeliveryFeeImportDetailModal;
