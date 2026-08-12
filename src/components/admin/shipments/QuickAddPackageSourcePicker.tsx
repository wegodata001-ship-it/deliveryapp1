"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { ShipmentRecordDto } from "@/app/admin/shipments/types";
import { getEffectiveDeliveryPlaceFromRecord } from "@/lib/shipment-delivery-place";

type Props = {
  records: ShipmentRecordDto[];
  batchLabel: string;
  onClose: () => void;
  onSelect: (record: ShipmentRecordDto) => void;
};

export function QuickAddPackageSourcePicker({ records, batchLabel, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const hay = [
        r.customerCode,
        r.customerName,
        r.customerPhone,
        r.customerPhone2,
        getEffectiveDeliveryPlaceFromRecord(r),
        r.address,
        r.batchNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, query]);

  return (
    <div className="shp-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="shp-modal shp-modal--quick-add-pick"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shp-modal__head">
          <div>
            <h3>לאיזה לקוח להוסיף חבילה?</h3>
            <p className="shp-modal__sub">משלוח {batchLabel}</p>
          </div>
          <button type="button" className="shp-btn shp-btn--ghost shp-btn--sm" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </header>

        <div className="shp-modal__body">
          <label className="shp-quick-add-pick__search">
            <Search size={15} aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לפי קוד, שם, טלפון או מקום מסירה"
            />
          </label>

          <div className="shp-quick-add-pick__list">
            {filtered.length === 0 ? (
              <p className="shp-muted">לא נמצאו שורות</p>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="shp-quick-add-pick__row"
                  onClick={() => onSelect(r)}
                >
                  <span className="shp-quick-add-pick__name">{r.customerName || "ללא שם"}</span>
                  <span className="shp-quick-add-pick__meta" dir="ltr">
                    {[r.customerCode, r.customerPhone, getEffectiveDeliveryPlaceFromRecord(r)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
