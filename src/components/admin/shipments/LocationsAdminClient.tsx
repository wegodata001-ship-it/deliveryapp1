"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Download,
  MapPinned,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import type { ShipmentZoneDto } from "@/app/admin/shipments/types";
import type {
  AliasMappingRow,
  DeliveryLocationDto,
  LocationAliasImportResult,
} from "@/app/admin/shipments/location-service";
import {
  createZoneForLocationsAction,
  deleteLocationAliasAction,
  deleteZoneForLocationsAction,
  listAliasMappingRowsAction,
  listDeliveryLocationsAction,
  reorderZonesAction,
  reMatchUnmatchedShipmentsAction,
  setZoneActiveForLocationsAction,
  updateZoneForLocationsAction,
} from "@/app/admin/shipments/location-actions";
import { distributionAreaValidationError } from "@/lib/distribution-area-name";
import { LocationMappingEditModal } from "@/components/admin/shipments/LocationMappingEditModal";
import { LocationAliasesManageModal } from "@/components/admin/shipments/LocationAliasesManageModal";
import { LocationAliasImportModal } from "@/components/admin/shipments/LocationAliasImportModal";
import { aliasLookupKey } from "@/lib/delivery-location-normalize";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";

type Props = {
  initialMappings: AliasMappingRow[];
  initialZones: ShipmentZoneDto[];
  initialLocations: DeliveryLocationDto[];
};

export function LocationsAdminClient({
  initialMappings,
  initialZones,
  initialLocations,
}: Props) {
  const router = useRouter();
  const { workCountry, basePath } = useShipmentCountry();
  const searchRef = useRef<HTMLInputElement>(null);
  const [mappings, setMappings] = useState(initialMappings);
  const [zones, setZones] = useState(initialZones);
  const [locations, setLocations] = useState(initialLocations);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<LocationAliasImportResult | null>(null);
  const [newZoneName, setNewZoneName] = useState("");
  const [quickZoneOpen, setQuickZoneOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AliasMappingRow | null>(null);
  const [aliasesLocation, setAliasesLocation] = useState<DeliveryLocationDto | null>(null);

  const activeZones = useMemo(
    () => zones.filter((z) => z.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [zones],
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return mappings;
    const compact = aliasLookupKey(q);
    const norm = q.toLowerCase();
    return mappings.filter((m) => {
      if (m.originalName.toLowerCase().includes(norm)) return true;
      if (m.displayName.toLowerCase().includes(norm)) return true;
      if ((m.distributionAreaName ?? "").toLowerCase().includes(norm)) return true;
      if (compact && aliasLookupKey(m.originalName).includes(compact)) return true;
      return false;
    });
  }, [mappings, search]);

  const selected = useMemo(
    () => mappings.find((m) => m.aliasId === selectedId) ?? null,
    [mappings, selectedId],
  );

  const locCountByZone = useMemo(() => {
    const map = new Map<string, number>();
    for (const loc of locations) {
      if (!loc.distributionAreaId) continue;
      map.set(loc.distributionAreaId, (map.get(loc.distributionAreaId) ?? 0) + 1);
    }
    return map;
  }, [locations]);

  const refresh = useCallback(async () => {
    setBusy(true);
    const [mapRes, locRes] = await Promise.all([
      listAliasMappingRowsAction(workCountry, { includeInactive: true }),
      listDeliveryLocationsAction(workCountry, { includeInactive: true }),
    ]);
    setBusy(false);
    if (mapRes.ok) setMappings(mapRes.rows);
    if (locRes.ok) setLocations(locRes.locations);
    router.refresh();
  }, [router, workCountry]);

  function exportExcel() {
    const rows = mappings.map((m) => ({
      "מקום מסירה מקורי": m.originalName,
      "אזור חלוקה": m.distributionAreaName || "",
      "מקום מסירה מעודכן": m.displayName,
      סטטוס: m.isActive ? "פעיל" : "מושבת",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "התאמות");
    XLSX.writeFile(wb, "delivery-location-aliases.xlsx");
  }

  async function addZone(nameRaw?: string) {
    const name = (nameRaw ?? newZoneName).trim();
    if (!name) return;
    const validationError = distributionAreaValidationError(name);
    if (validationError) {
      setMsg(validationError);
      return;
    }
    setBusy(true);
    const res = await createZoneForLocationsAction(workCountry, name);
    setBusy(false);
    if (res.ok) {
      setZones((prev) => [...prev, res.zone].sort((a, b) => a.sortOrder - b.sortOrder));
      setNewZoneName("");
      setQuickZoneOpen(false);
      setMsg(`אזור חלוקה נוסף: ${res.zone.name}`);
    } else setMsg(res.error || "שמירת אזור נכשלה");
  }

  async function deleteSelected() {
    if (!selected) {
      setMsg("בחרו שורה לעריכה/מחיקה");
      return;
    }
    if (!window.confirm(`למחוק התאמה "${selected.originalName}"?`)) return;
    setBusy(true);
    const res = await deleteLocationAliasAction(workCountry, selected.aliasId);
    setBusy(false);
    if (!res.ok) setMsg(res.error);
    else {
      setSelectedId(null);
      setMsg("ההתאמה נמחקה");
      await refresh();
    }
  }

  function openEdit(row?: AliasMappingRow | null) {
    const target = row ?? selected;
    if (!target) {
      setMsg("בחרו שורה לעריכה");
      return;
    }
    setSelectedId(target.aliasId);
    setEditingRow(target);
  }

  function openAliasesManage(row?: AliasMappingRow | null) {
    const target = row ?? selected;
    if (!target) {
      setMsg("בחרו שורה לניהול כינויים");
      return;
    }
    const loc =
      locations.find((l) => l.id === target.locationId) ??
      ({
        id: target.locationId,
        displayName: target.displayName,
        distributionAreaId: target.distributionAreaId,
        distributionAreaName: target.distributionAreaName,
        isActive: true,
        aliasCount: 0,
        aliases: mappings
          .filter((m) => m.locationId === target.locationId && m.isActive)
          .map((m) => ({
            id: m.aliasId,
            originalName: m.originalName,
            normalizedOriginalName: "",
            isActive: true,
          })),
        createdAt: "",
        updatedAt: "",
      } satisfies DeliveryLocationDto);
    setAliasesLocation(loc);
  }

  async function runReMatchUnmatched() {
    setBusy(true);
    const res = await reMatchUnmatchedShipmentsAction(workCountry);
    setBusy(false);
    if (!res.ok) setMsg(res.error);
    else {
      setMsg(
        `התאמה מחדש: נסרקו ${res.result.scanned} · זוהו ${res.result.matched} · עודכנו ${res.result.updated}`,
      );
      await refresh();
    }
  }

  return (
    <div className="shp-page shp-page--wide loc-admin" dir="rtl">
      <div className="shp-header">
        <button type="button" className="shp-btn shp-btn--ghost" onClick={() => router.push(basePath)}>
          <ArrowRight size={16} />
          חזרה לרשימת משלוחים
        </button>
        <MapPinned size={22} style={{ color: "#2563eb" }} />
        <div>
          <h1>ניהול יישובים ואזורי חלוקה</h1>
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            טבלת אב קבועה: מקום מסירה מקורי → מעודכן → אזור חלוקה
          </p>
        </div>
        <div className="shp-header-actions">
          <button type="button" className="shp-btn" onClick={() => setZonesOpen(true)}>
            ניהול אזורי חלוקה
          </button>
          <button type="button" className="shp-btn shp-btn--primary" onClick={() => setImportOpen(true)}>
            <Upload size={14} />
            ייבוא התאמות יישובים
          </button>
          <button type="button" className="shp-btn" onClick={exportExcel}>
            <Download size={14} />
            ייצוא Excel
          </button>
          <button type="button" className="shp-btn" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={14} />
            רענון
          </button>
        </div>
      </div>

      {msg && (
        <div className="shp-alert" role="status">
          {msg}
        </div>
      )}

      {importResult && (
        <div className="shp-alert">
          ייבוא #{importResult.audit.importId.slice(0, 8)} · נקלטו {importResult.processed} · חדשים{" "}
          {importResult.createdAliases} · עודכנו {importResult.updatedAliases} · אזורים חדשים{" "}
          {importResult.createdAreas} · נכשלו {importResult.failed}
        </div>
      )}

      <section className="loc-admin__toolbar loc-admin__toolbar--actions">
        <div className="loc-admin__action-btns">
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} />
            יישוב חדש
          </button>
          <button
            type="button"
            className="shp-btn"
            disabled={busy}
            onClick={() => {
              setNewZoneName("");
              setQuickZoneOpen(true);
            }}
          >
            <Plus size={14} />
            אזור חלוקה חדש
          </button>
          <button type="button" className="shp-btn" disabled={busy} onClick={() => openEdit()}>
            <Pencil size={14} />
            עריכה
          </button>
          <button type="button" className="shp-btn" disabled={busy} onClick={() => openAliasesManage()}>
            כינויים ליישוב
          </button>
          <button type="button" className="shp-btn" disabled={busy} onClick={() => void deleteSelected()}>
            <Trash2 size={14} />
            מחיקה
          </button>
          <button
            type="button"
            className="shp-btn"
            onClick={() => searchRef.current?.focus()}
          >
            <Search size={14} />
            חיפוש
          </button>
          <button
            type="button"
            className="shp-btn"
            disabled={busy}
            onClick={() => void runReMatchUnmatched()}
          >
            <RefreshCw size={14} />
            התאם לא מזוהים
          </button>
        </div>
        <div className="loc-admin__search">
          <Search size={16} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש כינוי / יישוב / אזור…"
          />
        </div>
        <span style={{ fontSize: 13, color: "#64748b" }}>{filtered.length} התאמות</span>
      </section>

      <section className="loc-admin__card">
        <h2>טבלת התאמות</h2>
        <p className="loc-admin__hint">
          בחרו שורה ולחצו עריכה או «כינויים ליישוב». ניתן להוסיף Aliases בכל שפה — המערכת מזהה
          אוטומטית גם BETLAHEM, bet-lahem ו-بيت لحم.
        </p>
        <div className="shp-daily-wrap">
          <table className="shp-table shp-table--daily shp-table--alias">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th style={{ width: 220 }}>מקום מסירה מקורי</th>
                <th style={{ width: 180 }}>מקום מסירה מעודכן</th>
                <th style={{ width: 140 }}>אזור חלוקה</th>
                <th style={{ width: 90 }}>סטטוס</th>
                <th style={{ width: 100 }}>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="shp-daily-empty">
                    אין התאמות — ייבאו קובץ Excel או הוסיפו יישוב חדש
                  </td>
                </tr>
              )}
              {filtered.map((m) => (
                <tr
                  key={m.aliasId}
                  className={selectedId === m.aliasId ? "loc-admin__row--selected" : undefined}
                  onClick={() => setSelectedId(m.aliasId)}
                  onDoubleClick={() => openEdit(m)}
                  style={{ cursor: "pointer" }}
                >
                  <td className="shp-daily-center">
                    <input
                      type="radio"
                      name="loc-sel"
                      checked={selectedId === m.aliasId}
                      onChange={() => setSelectedId(m.aliasId)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td>
                    <span className="shp-trunc" title={m.originalName}>
                      {m.originalName}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{m.displayName}</td>
                  <td>
                    {m.distributionAreaName ? (
                      <span className="shp-zone-tag">{m.distributionAreaName}</span>
                    ) : (
                      <span className="shp-unset-tag">לא הוגדר</span>
                    )}
                  </td>
                  <td>{m.isActive ? "פעיל" : "מושבת"}</td>
                  <td>
                    <div className="shp-daily-actions">
                      <button
                        type="button"
                        className="shp-btn shp-btn--sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(m);
                        }}
                      >
                        עריכה
                      </button>
                      <button
                        type="button"
                        className="shp-btn shp-btn--sm"
                        title="מחק התאמה"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!window.confirm(`למחוק התאמה "${m.originalName}"?`)) return;
                          const res = await deleteLocationAliasAction(workCountry, m.aliasId);
                          if (!res.ok) setMsg(res.error);
                          else {
                            if (selectedId === m.aliasId) setSelectedId(null);
                            await refresh();
                          }
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {aliasesLocation && (
        <LocationAliasesManageModal
          location={aliasesLocation}
          onClose={() => setAliasesLocation(null)}
          onChanged={() => void refresh()}
        />
      )}

      {(createOpen || editingRow) && (
        <LocationMappingEditModal
          mode={createOpen ? "create" : "edit"}
          mapping={editingRow}
          locations={locations}
          zones={zones}
          onClose={() => {
            setCreateOpen(false);
            setEditingRow(null);
          }}
          onSaved={(row) => {
            setMappings((prev) => {
              const idx = prev.findIndex((m) => m.aliasId === row.aliasId);
              if (idx < 0) return [row, ...prev];
              const next = [...prev];
              next[idx] = row;
              return next;
            });
            setSelectedId(row.aliasId);
            setMsg(createOpen ? "יישוב נוסף לטבלת ההתאמות" : "ההתאמה עודכנה");
            void refresh();
          }}
          onZonesChange={setZones}
        />
      )}

      {quickZoneOpen && (
        <div
          className="shp-modal-backdrop"
          onClick={() => !busy && setQuickZoneOpen(false)}
        >
          <div
            className="shp-modal"
            style={{ maxWidth: 420, width: "92vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shp-modal__header">
              <strong>אזור חלוקה חדש</strong>
              <button type="button" className="shp-icon-btn" onClick={() => setQuickZoneOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="shp-modal__body">
              <label className="loc-mapping-field">
                <span>שם אזור</span>
                <input
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="למשל: الجليل, منطقة 1, Zone 7"
                  onKeyDown={(e) => e.key === "Enter" && void addZone()}
                  autoFocus
                />
              </label>
            </div>
            <div className="shp-modal__footer">
              <button type="button" className="shp-btn" onClick={() => setQuickZoneOpen(false)}>
                ביטול
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                disabled={busy || !newZoneName.trim()}
                onClick={() => void addZone()}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}

      {zonesOpen && (
        <div className="shp-modal-backdrop" onClick={() => setZonesOpen(false)}>
          <div
            className="shp-modal"
            style={{ maxWidth: 720, width: "96vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shp-modal__header">
              <strong>ניהול אזורי חלוקה</strong>
              <button type="button" className="shp-icon-btn" onClick={() => setZonesOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="shp-modal__body">
              <p className="loc-admin__hint">
                שם חופשי בכל שפה — עברית, ערבית, אנגלית (למשל: الجليل, منطقة 1, Zone 7)
              </p>
              <div className="loc-admin__add-row">
                <input
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="למשל: الجليل, منطقة 1, Zone 7"
                  onKeyDown={(e) => e.key === "Enter" && void addZone()}
                />
                <button type="button" className="shp-btn shp-btn--primary" onClick={() => void addZone()}>
                  <Plus size={14} />
                  הוסף אזור
                </button>
              </div>
              <div className="shp-daily-wrap" style={{ maxHeight: "50vh" }}>
                <table className="shp-table shp-table--daily">
                  <thead>
                    <tr>
                      <th>אזור חלוקה</th>
                      <th>מספר יישובים</th>
                      <th>סטטוס</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeZones.map((z, idx) => (
                      <tr key={z.id}>
                        <td>
                          <span className="shp-zone-tag">{z.name}</span>
                        </td>
                        <td className="shp-daily-center">{locCountByZone.get(z.id) ?? 0}</td>
                        <td>{z.isActive ? "פעיל" : "מושבת"}</td>
                        <td>
                          <div className="shp-daily-actions">
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm"
                              onClick={async () => {
                                const name = window.prompt("שם אזור", z.name);
                                if (!name?.trim()) return;
                                const validationError = distributionAreaValidationError(name.trim());
                                if (validationError) {
                                  setMsg(validationError);
                                  return;
                                }
                                await updateZoneForLocationsAction(workCountry, z.id, { name: name.trim() });
                                setZones((prev) =>
                                  prev.map((x) => (x.id === z.id ? { ...x, name: name.trim() } : x)),
                                );
                              }}
                            >
                              עריכה
                            </button>
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm"
                              onClick={async () => {
                                await setZoneActiveForLocationsAction(workCountry, z.id, !z.isActive);
                                setZones((prev) =>
                                  prev.map((x) => (x.id === z.id ? { ...x, isActive: !x.isActive } : x)),
                                );
                              }}
                            >
                              {z.isActive ? "השבת" : "הפעל"}
                            </button>
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm"
                              disabled={idx === 0}
                              onClick={async () => {
                                const ordered = [...activeZones];
                                const i = ordered.findIndex((x) => x.id === z.id);
                                if (i <= 0) return;
                                [ordered[i - 1], ordered[i]] = [ordered[i], ordered[i - 1]];
                                await reorderZonesAction(workCountry, ordered.map((x) => x.id));
                                setZones(ordered.map((x, sortOrder) => ({ ...x, sortOrder })));
                              }}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm"
                              onClick={async () => {
                                if (!window.confirm("למחוק אזור?")) return;
                                await deleteZoneForLocationsAction(workCountry, z.id);
                                setZones((prev) => prev.filter((x) => x.id !== z.id));
                                await refresh();
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="shp-modal__footer">
              <button type="button" className="shp-btn" onClick={() => setZonesOpen(false)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <LocationAliasImportModal
          onClose={() => setImportOpen(false)}
          onDone={(result) => {
            setImportResult(result);
            setMsg(
              `ייבוא הושלם: ${result.createdAliases} כינויים חדשים · ${result.updatedAliases} עודכנו · ${result.createdAreas} אזורים · ${result.failed} נכשלו`,
            );
            void refresh();
          }}
        />
      )}
    </div>
  );
}
