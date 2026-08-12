"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, X } from "lucide-react";
import type { ShipmentRecordDto, ShipmentZoneDto } from "@/app/admin/shipments/types";
import type { DeliveryLocationDto } from "@/app/admin/shipments/location-service";
import {
  createDeliveryLocationAction,
  fixShipmentLocationAction,
  listDeliveryLocationsAction,
} from "@/app/admin/shipments/location-actions";
import { DistributionAreaPicker } from "@/components/admin/shipments/DistributionAreaPicker";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";
import {
  getEffectiveDeliveryPlaceFromRecord,
  shipmentOriginalDeliveryPlace,
} from "@/lib/shipment-delivery-place";

type FixLocationSavedPayload = {
  updatedRecordIds: string[];
  displayName: string;
  deliveryLocationId: string;
  zoneId: string | null;
  zoneName: string | null;
};

type Props = {
  record: ShipmentRecordDto;
  zones: ShipmentZoneDto[];
  onClose: () => void;
  onSaved: (payload: FixLocationSavedPayload) => void;
};

export function FixLocationModal({ record, zones, onClose, onSaved }: Props) {
  const { workCountry } = useShipmentCountry();
  const originalName = shipmentOriginalDeliveryPlace(record) || "—";
  const effectiveName = getEffectiveDeliveryPlaceFromRecord(record);
  const [locations, setLocations] = useState<DeliveryLocationDto[]>([]);
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState(record.deliveryLocationId ?? "");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [areaId, setAreaId] = useState(record.zoneId ?? "");
  const [saveAlias, setSaveAlias] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listDeliveryLocationsAction(workCountry, { includeInactive: false }).then((res) => {
      if (res.ok) setLocations(res.locations);
    });
  }, [workCountry]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(
      (l) =>
        l.displayName.toLowerCase().includes(q) ||
        l.aliases.some((a) => a.originalName.toLowerCase().includes(q)) ||
        (l.distributionAreaName ?? "").toLowerCase().includes(q),
    );
  }, [locations, search]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    let deliveryLocationId: string | null = locationId || null;
    let displayName: string | null = null;

    if (createNew) {
      const name = newDisplayName.trim();
      if (!name) {
        setError("יש להזין שם יישוב חדש");
        setBusy(false);
        return;
      }
      const created = await createDeliveryLocationAction(workCountry, {
        displayName: name,
        distributionAreaId: areaId || null,
      });
      if (!created.ok) {
        setError(created.error);
        setBusy(false);
        return;
      }
      deliveryLocationId = created.location.id;
      displayName = created.location.displayName;
    } else if (!deliveryLocationId) {
      setError("יש לבחור יישוב מעודכן");
      setBusy(false);
      return;
    }

    const res = await fixShipmentLocationAction(workCountry, {
      recordId: record.id,
      deliveryLocationId,
      newDisplayName: displayName,
      distributionAreaId: areaId || null,
      saveAsPermanentAlias: saveAlias,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const savedDisplayName =
      displayName ??
      locations.find((l) => l.id === deliveryLocationId)?.displayName ??
      newDisplayName.trim();
    if (!savedDisplayName) {
      setError("לא נמצא שם יישוב לשמירה");
      return;
    }

    const zoneName = zones.find((z) => z.id === (areaId || null))?.name ?? null;

    onSaved({
      updatedRecordIds: res.updatedRecordIds,
      displayName: savedDisplayName,
      deliveryLocationId,
      zoneId: areaId || null,
      zoneName,
    });
    onClose();
  }

  return (
    <div className="shp-modal-backdrop" onClick={onClose}>
      <div
        className="shp-modal"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MapPin size={18} />
            <strong>תיקון יישוב ואזור חלוקה</strong>
          </div>
          <button type="button" className="shp-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>מקום מקורי מהייבוא</div>
            <div style={{ fontWeight: 600 }} dir="auto">
              {originalName}
            </div>
          </div>

          {effectiveName && effectiveName !== originalName ? (
            <div>
              <div style={{ fontSize: 12, color: "#64748b" }}>מקום מסירה נוכחי</div>
              <div style={{ fontWeight: 600 }}>{effectiveName}</div>
            </div>
          ) : null}

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={createNew}
              onChange={(e) => setCreateNew(e.target.checked)}
            />
            הוסף יישוב חדש
          </label>

          {createNew ? (
            <div className="shp-form-field">
              <label>שם יישוב מעודכן</label>
              <input
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="לדוגמה: אבו סנאן"
              />
            </div>
          ) : (
            <>
              <div className="shp-form-field">
                <label>חיפוש יישוב</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="עברית / ערבית / אנגלית"
                />
              </div>
              <div className="shp-form-field">
                <label>מקום מסירה</label>
                <select
                  value={locationId}
                  onChange={(e) => {
                    setLocationId(e.target.value);
                    const loc = locations.find((l) => l.id === e.target.value);
                    if (loc?.distributionAreaId) setAreaId(loc.distributionAreaId);
                  }}
                >
                  <option value="">בחר יישוב...</option>
                  {filtered.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.displayName}
                      {l.distributionAreaName ? ` — ${l.distributionAreaName}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="shp-form-field">
            <label>אזור חלוקה</label>
            <DistributionAreaPicker
              zones={zones}
              value={areaId}
              onChange={setAreaId}
              disabled={busy}
              emptyLabel="ללא אזור"
            />
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={saveAlias}
              onChange={(e) => setSaveAlias(e.target.checked)}
            />
            שמור התאמה זו גם לייבואים הבאים
          </label>

          {error && <div className="shp-alert shp-alert--error">{error}</div>}
        </div>

        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}
