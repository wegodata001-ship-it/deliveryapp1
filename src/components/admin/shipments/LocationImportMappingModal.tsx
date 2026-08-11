"use client";

import { MapPinned, X } from "lucide-react";
import type { ShipmentImportLocationMapping } from "@/lib/shipment-import-preview-utils";

type Props = {
  mappings: ShipmentImportLocationMapping[];
  onApply: () => void;
  onKeepOriginal: () => void;
};

export function LocationImportMappingModal({ mappings, onApply, onKeepOriginal }: Props) {
  return (
    <div className="shp-modal-backdrop" role="presentation" style={{ zIndex: 70 }}>
      <div
        className="shp-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 560, width: "min(560px, 96vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shp-modal__head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MapPinned size={18} color="#2563eb" />
          <strong style={{ flex: 1 }}>נמצאו מקומות מעודכנים</strong>
          <button type="button" className="shp-modal__header-close" onClick={onKeepOriginal} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#475569" }}>
            נמצאו <strong>{mappings.length}</strong> מקומות שניתן לעדכן לפי טבלת ההתאמות.
            הערכים המקוריים מה־Excel יישמרו לצורכי ביקורת.
          </p>

          <div className="shp-table-wrap" style={{ maxHeight: "40vh" }}>
            <table className="shp-table">
              <thead>
                <tr>
                  <th>מקום מקורי (Excel)</th>
                  <th>מקום מעודכן</th>
                  {mappings.some((m) => m.zoneName) ? <th>אזור חלוקה</th> : null}
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.originalPlace}>
                    <td>{m.originalPlace}</td>
                    <td style={{ fontWeight: 600 }}>{m.updatedPlace}</td>
                    {mappings.some((x) => x.zoneName) ? (
                      <td>{m.zoneName || "—"}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="shp-modal__foot" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="shp-btn shp-btn--primary" onClick={onApply}>
            החלף למקומות המעודכנים
          </button>
          <button type="button" className="shp-btn shp-btn--secondary" onClick={onKeepOriginal}>
            השאר את המקומות המקוריים
          </button>
        </footer>
      </div>
    </div>
  );
}
