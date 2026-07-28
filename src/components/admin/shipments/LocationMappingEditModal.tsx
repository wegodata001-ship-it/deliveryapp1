"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPinned, Plus, Search, X } from "lucide-react";
import type { ShipmentZoneDto } from "@/app/admin/shipments/types";
import type { AliasMappingRow, DeliveryLocationDto } from "@/app/admin/shipments/location-service";
import {
  createAliasMappingAction,
  createZoneForLocationsAction,
  updateAliasMappingAction,
} from "@/app/admin/shipments/location-actions";
import { looksLikeDistributionArea } from "@/lib/distribution-area-name";

type Props = {
  mode: "edit" | "create";
  mapping?: AliasMappingRow | null;
  locations: DeliveryLocationDto[];
  zones: ShipmentZoneDto[];
  onClose: () => void;
  onSaved: (row: AliasMappingRow) => void;
  onZonesChange: (zones: ShipmentZoneDto[]) => void;
};

export function LocationMappingEditModal({
  mode,
  mapping,
  locations,
  zones,
  onClose,
  onSaved,
  onZonesChange,
}: Props) {
  const [originalName, setOriginalName] = useState(mapping?.originalName ?? "");
  const [displayName, setDisplayName] = useState(mapping?.displayName ?? "");
  const [locationId, setLocationId] = useState<string | null>(mapping?.locationId ?? null);
  const [areaId, setAreaId] = useState(mapping?.distributionAreaId ?? "");
  const [locQuery, setLocQuery] = useState("");
  const [showLocList, setShowLocList] = useState(false);
  const [createZoneOpen, setCreateZoneOpen] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => locInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const activeZones = useMemo(
    () =>
      zones
        .filter((z) => z.isActive && looksLikeDistributionArea(z.name))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [zones],
  );

  const filteredLocations = useMemo(() => {
    const q = locQuery.trim().toLowerCase();
    const base = locations.filter((l) => l.isActive && !looksLikeDistributionArea(l.displayName));
    if (!q) return base.slice(0, 40);
    return base
      .filter(
        (l) =>
          l.displayName.toLowerCase().includes(q) ||
          l.aliases.some((a) => a.originalName.toLowerCase().includes(q)),
      )
      .slice(0, 40);
  }, [locations, locQuery]);

  function pickLocation(loc: DeliveryLocationDto) {
    setLocationId(loc.id);
    setDisplayName(loc.displayName);
    setLocQuery("");
    setShowLocList(false);
    if (loc.distributionAreaId) setAreaId(loc.distributionAreaId);
  }

  function onDisplayNameChange(value: string) {
    setDisplayName(value);
    setLocationId(null);
    setLocQuery(value);
    setShowLocList(true);
  }

  async function handleCreateZone() {
    const name = newZoneName.trim();
    if (!name) return;
    if (!looksLikeDistributionArea(name)) {
      setError("שם אזור לא תקין — למשל: צפון 16, דרום 1, מרכז 11");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createZoneForLocationsAction(name);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onZonesChange(
      [...zones.filter((z) => z.id !== res.zone.id), res.zone].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    );
    setAreaId(res.zone.id);
    setNewZoneName("");
    setCreateZoneOpen(false);
  }

  async function handleSave() {
    const updated = displayName.trim();
    if (!updated) {
      setError("מקום מסירה מעודכן חובה");
      return;
    }
    if (looksLikeDistributionArea(updated)) {
      setError("מקום מסירה מעודכן לא יכול להיות אזור חלוקה");
      return;
    }
    setBusy(true);
    setError(null);

    if (mode === "create") {
      const original = originalName.trim();
      if (!original) {
        setError("מקום מסירה מקורי חובה");
        setBusy(false);
        return;
      }
      const res = await createAliasMappingAction({
        originalName: original,
        displayName: updated,
        distributionAreaId: areaId || null,
      });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved(res.row);
      onClose();
      return;
    }

    if (!mapping) {
      setError("אין התאמה לעריכה");
      setBusy(false);
      return;
    }

    const res = await updateAliasMappingAction({
      aliasId: mapping.aliasId,
      displayName: updated,
      deliveryLocationId: locationId,
      distributionAreaId: areaId || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.row);
    onClose();
  }

  return (
    <div
      className="shp-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="shp-modal loc-mapping-modal"
        style={{ maxWidth: 720, width: "96vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MapPinned size={18} />
            <strong>{mode === "create" ? "יישוב חדש" : "עריכת יישוב ואזור חלוקה"}</strong>
          </div>
          <button type="button" className="shp-icon-btn" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="shp-modal__body" style={{ display: "grid", gap: 16 }}>
          <label className="loc-mapping-field">
            <span>מקום מסירה מקורי</span>
            {mode === "edit" ? (
              <input value={mapping?.originalName ?? ""} readOnly className="loc-mapping-readonly" />
            ) : (
              <input
                value={originalName}
                onChange={(e) => setOriginalName(e.target.value)}
                placeholder="כפי שמופיע בקובץ הייבוא"
                disabled={busy}
              />
            )}
            {mode === "edit" && (
              <em className="loc-mapping-hint">קריאה בלבד — הערך כפי שהגיע מקובץ הייבוא</em>
            )}
          </label>

          <label className="loc-mapping-field">
            <span>מקום מסירה מעודכן</span>
            <div className="loc-mapping-combo">
              <Search size={14} className="loc-mapping-combo__icon" />
              <input
                ref={locInputRef}
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                onFocus={() => {
                  setLocQuery(displayName);
                  setShowLocList(true);
                }}
                onBlur={() => window.setTimeout(() => setShowLocList(false), 150)}
                placeholder="בחרו יישוב קיים או הקלידו שם חדש"
                disabled={busy}
              />
              {showLocList && filteredLocations.length > 0 && (
                <ul className="loc-mapping-combo__list">
                  {filteredLocations.map((loc) => (
                    <li key={loc.id}>
                      <button type="button" onMouseDown={() => pickLocation(loc)}>
                        <strong>{loc.displayName}</strong>
                        {loc.distributionAreaName && (
                          <span>{loc.distributionAreaName}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <em className="loc-mapping-hint">אפשר לבחור מהרשימה או להקליד שם יישוב חדש</em>
          </label>

          <div className="loc-mapping-field">
            <div className="loc-mapping-zone-row">
              <span>אזור חלוקה</span>
              <button
                type="button"
                className="shp-btn shp-btn--sm"
                disabled={busy}
                onClick={() => {
                  setCreateZoneOpen(true);
                  setError(null);
                }}
              >
                <Plus size={12} />
                אזור חדש
              </button>
            </div>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              disabled={busy}
            >
              <option value="">ללא אזור חלוקה</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="shp-alert shp-alert--error">{error}</div>}
        </div>

        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            {busy ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>

      {createZoneOpen && (
        <div
          className="shp-modal-backdrop"
          style={{ zIndex: 60 }}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setCreateZoneOpen(false);
          }}
        >
          <div
            className="shp-modal"
            style={{ maxWidth: 420, width: "92vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shp-modal__header">
              <strong>אזור חלוקה חדש</strong>
              <button
                type="button"
                className="shp-icon-btn"
                disabled={busy}
                onClick={() => setCreateZoneOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="shp-modal__body" style={{ display: "grid", gap: 10 }}>
              <label className="loc-mapping-field">
                <span>שם אזור</span>
                <input
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="למשל: צפון 16"
                  disabled={busy}
                  onKeyDown={(e) => e.key === "Enter" && void handleCreateZone()}
                  autoFocus
                />
              </label>
            </div>
            <div className="shp-modal__footer">
              <button
                type="button"
                className="shp-btn"
                disabled={busy}
                onClick={() => setCreateZoneOpen(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                disabled={busy || !newZoneName.trim()}
                onClick={() => void handleCreateZone()}
              >
                {busy ? "יוצר..." : "צור ובחר"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
