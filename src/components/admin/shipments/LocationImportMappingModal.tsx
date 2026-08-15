"use client";

import { useMemo, useState } from "react";
import { Check, MapPinned, Pencil, RotateCcw, Search, X } from "lucide-react";
import type { ShipmentZoneDto } from "@/app/admin/shipments/types";
import {
  countImportMappingStats,
  isImportMappingManuallyEdited,
  type ShipmentImportLocationMapping,
} from "@/lib/shipment-import-preview-utils";

type Props = {
  mappings: ShipmentImportLocationMapping[];
  zones: ShipmentZoneDto[];
  onMappingsChange: (mappings: ShipmentImportLocationMapping[]) => void;
  onApply: () => void;
  onKeepOriginal: () => void;
};

type RowFilter = "all" | "edited";

function zoneNameForId(zones: ShipmentZoneDto[], zoneId: string | null): string | null {
  if (!zoneId) return null;
  return zones.find((z) => z.id === zoneId)?.name ?? null;
}

export function LocationImportMappingModal({
  mappings,
  zones,
  onMappingsChange,
  onApply,
  onKeepOriginal,
}: Props) {
  const [search, setSearch] = useState("");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftPlace, setDraftPlace] = useState("");
  const [draftZoneId, setDraftZoneId] = useState<string>("");

  const activeZones = useMemo(
    () =>
      zones
        .filter((z) => z.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [zones],
  );

  const stats = useMemo(() => countImportMappingStats(mappings), [mappings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mappings.filter((m) => {
      if (rowFilter === "edited" && !isImportMappingManuallyEdited(m)) return false;
      if (!q) return true;
      const hay = [m.originalPlace, m.updatedPlace, m.zoneName ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [mappings, rowFilter, search]);

  const showZoneColumn = mappings.some((m) => m.zoneName || m.zoneId);

  function startEdit(m: ShipmentImportLocationMapping) {
    setEditingKey(m.originalPlace);
    setDraftPlace(m.updatedPlace);
    setDraftZoneId(m.zoneId ?? "");
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraftPlace("");
    setDraftZoneId("");
  }

  function confirmEdit(originalPlace: string) {
    const trimmed = draftPlace.trim();
    if (!trimmed) return;
    const next = mappings.map((m) => {
      if (m.originalPlace !== originalPlace) return m;
      const suggestedPlace = m.suggestedUpdatedPlace ?? m.updatedPlace;
      const suggestedId = m.suggestedDeliveryLocationId ?? m.deliveryLocationId;
      const placeUnchanged = trimmed === suggestedPlace.trim();
      const zoneId = draftZoneId || null;
      return {
        ...m,
        updatedPlace: trimmed,
        zoneId,
        zoneName: zoneNameForId(activeZones, zoneId),
        deliveryLocationId: placeUnchanged ? suggestedId : null,
      };
    });
    onMappingsChange(next);
    cancelEdit();
  }

  function restoreRow(m: ShipmentImportLocationMapping) {
    onMappingsChange(
      mappings.map((row) =>
        row.originalPlace === m.originalPlace
          ? {
              ...row,
              updatedPlace: row.suggestedUpdatedPlace ?? row.updatedPlace,
              zoneId: row.suggestedZoneId ?? row.zoneId,
              zoneName: row.suggestedZoneName ?? row.zoneName,
              deliveryLocationId: row.suggestedDeliveryLocationId ?? row.deliveryLocationId,
            }
          : row,
      ),
    );
    if (editingKey === m.originalPlace) cancelEdit();
  }

  return (
    <div className="shp-modal-backdrop shp-modal-backdrop--import-loc" role="presentation">
      <div
        className="shp-modal shp-modal--import-loc-review"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-loc-review-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shp-modal__head import-loc-review__head">
          <div className="import-loc-review__title-row">
            <MapPinned size={20} color="#2563eb" aria-hidden />
            <div>
              <strong id="import-loc-review-title">נמצאו מקומות מעודכנים</strong>
              <p className="import-loc-review__subtitle">
                בדקו את ההתאמות לפני שמירת המשלוח. ניתן לערוך מקום ואזור חלוקה עבור המשלוח הנוכחי
                בלבד.
              </p>
            </div>
          </div>
          <button type="button" className="shp-modal__header-close" onClick={onKeepOriginal} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="import-loc-review__body">
          <p className="import-loc-review__intro">
            נמצאו <strong>{stats.total}</strong> מקומות שניתן לעדכן לפי טבלת ההתאמות. ניתן לערוך את
            ההתאמות למשלוח הנוכחי בלבד — ללא שינוי בטבלת ההתאמות הראשית.
          </p>

          <div className="import-loc-review__summary">
            <span>
              <strong>{stats.total}</strong> התאמות נמצאו
            </span>
            <span>
              <strong>{stats.manuallyEdited}</strong> נערכו ידנית
            </span>
            <span>
              <strong>{stats.unchanged}</strong> ללא שינוי
            </span>
          </div>

          <div className="import-loc-review__toolbar">
            <label className="import-loc-review__search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש מקום…"
                aria-label="חיפוש מקום"
              />
            </label>
            <div className="import-loc-review__filters" role="tablist" aria-label="סינון התאמות">
              <button
                type="button"
                role="tab"
                aria-selected={rowFilter === "all"}
                className={rowFilter === "all" ? "is-active" : undefined}
                onClick={() => setRowFilter("all")}
              >
                הכל
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rowFilter === "edited"}
                className={rowFilter === "edited" ? "is-active" : undefined}
                onClick={() => setRowFilter("edited")}
              >
                נערכו ידנית
              </button>
            </div>
          </div>

          <div className="import-loc-review__table-wrap">
            <table className="shp-table import-loc-review__table">
              <thead>
                <tr>
                  <th>מקום מקורי</th>
                  <th>מקום מעודכן</th>
                  {showZoneColumn ? <th>אזור חלוקה</th> : null}
                  <th>פעולה</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const edited = isImportMappingManuallyEdited(m);
                  const isEditing = editingKey === m.originalPlace;
                  return (
                    <tr
                      key={m.originalPlace}
                      className={edited ? "import-loc-review__row--edited" : undefined}
                    >
                      <td className="import-loc-review__cell-original">{m.originalPlace}</td>
                      <td>
                        {isEditing ? (
                          <input
                            className="import-loc-review__inline-input"
                            value={draftPlace}
                            onChange={(e) => setDraftPlace(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          <div className="import-loc-review__place">
                            <span className="import-loc-review__place-name">{m.updatedPlace}</span>
                            {edited ? (
                              <span className="import-loc-review__edited-tag">✎ נערך למשלוח זה</span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      {showZoneColumn ? (
                        <td>
                          {isEditing ? (
                            <select
                              className="import-loc-review__inline-select"
                              value={draftZoneId}
                              onChange={(e) => setDraftZoneId(e.target.value)}
                            >
                              <option value="">ללא אזור</option>
                              {activeZones.map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            m.zoneName || "—"
                          )}
                        </td>
                      ) : null}
                      <td className="import-loc-review__actions">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="import-loc-review__icon-btn import-loc-review__icon-btn--ok"
                              onClick={() => confirmEdit(m.originalPlace)}
                              aria-label="אישור"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              type="button"
                              className="import-loc-review__icon-btn"
                              onClick={cancelEdit}
                              aria-label="ביטול"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="import-loc-review__edit-btn"
                              onClick={() => startEdit(m)}
                            >
                              <Pencil size={14} />
                              עריכה
                            </button>
                            {edited ? (
                              <button
                                type="button"
                                className="import-loc-review__restore-btn"
                                onClick={() => restoreRow(m)}
                              >
                                <RotateCcw size={13} />
                                שחזר התאמה
                              </button>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtered.length === 0 ? (
              <div className="import-loc-review__empty">לא נמצאו התאמות לפי החיפוש / הסינון.</div>
            ) : null}
          </div>

          <div className="import-loc-review__cards">
            {filtered.map((m) => {
              const edited = isImportMappingManuallyEdited(m);
              const isEditing = editingKey === m.originalPlace;
              return (
                <article
                  key={`card-${m.originalPlace}`}
                  className={`import-loc-review__card${edited ? " import-loc-review__card--edited" : ""}`}
                >
                  <div className="import-loc-review__card-label">מקום מקורי</div>
                  <div className="import-loc-review__card-value">{m.originalPlace}</div>

                  <div className="import-loc-review__card-label">מקום מעודכן</div>
                  {isEditing ? (
                    <input
                      className="import-loc-review__inline-input"
                      value={draftPlace}
                      onChange={(e) => setDraftPlace(e.target.value)}
                    />
                  ) : (
                    <div className="import-loc-review__place">
                      <span>{m.updatedPlace}</span>
                      {edited ? (
                        <span className="import-loc-review__edited-tag">✎ נערך למשלוח זה</span>
                      ) : null}
                    </div>
                  )}

                  {showZoneColumn ? (
                    <>
                      <div className="import-loc-review__card-label">אזור חלוקה</div>
                      {isEditing ? (
                        <select
                          className="import-loc-review__inline-select"
                          value={draftZoneId}
                          onChange={(e) => setDraftZoneId(e.target.value)}
                        >
                          <option value="">ללא אזור</option>
                          {activeZones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div>{m.zoneName || "—"}</div>
                      )}
                    </>
                  ) : null}

                  <div className="import-loc-review__card-actions">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="shp-btn shp-btn--primary shp-btn--sm"
                          onClick={() => confirmEdit(m.originalPlace)}
                        >
                          אישור
                        </button>
                        <button type="button" className="shp-btn shp-btn--secondary shp-btn--sm" onClick={cancelEdit}>
                          ביטול
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="import-loc-review__edit-btn" onClick={() => startEdit(m)}>
                          <Pencil size={14} />
                          עריכה
                        </button>
                        {edited ? (
                          <button type="button" className="import-loc-review__restore-btn" onClick={() => restoreRow(m)}>
                            <RotateCcw size={13} />
                            שחזר
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="shp-modal__foot import-loc-review__foot">
          <button type="button" className="shp-btn shp-btn--secondary" onClick={onKeepOriginal}>
            השאר את המקומות המקוריים
          </button>
          <button type="button" className="shp-btn shp-btn--primary" onClick={onApply}>
            החלף למקומות המעודכנים
          </button>
        </footer>
      </div>
    </div>
  );
}
