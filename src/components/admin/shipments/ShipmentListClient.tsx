"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  Plus,
  Truck,
  ChevronLeft,
  X,
  RefreshCw,
  MapPin,
  Edit2,
  Trash2,
  Settings,
  UserCheck,
  UserX,
  Users,
  Search,
} from "lucide-react";
import type {
  ShipmentBatchDto,
  ShipmentCourierDto,
  ShipmentZoneDto,
} from "@/app/admin/shipments/types";
import {
  listShipmentBatchesAction,
  createZoneAction,
  updateZoneAction,
  setZoneActiveAction,
  deleteZoneAction,
  createCourierAction,
  updateCourierAction,
  setCourierActiveAction,
  deleteCourierAction,
} from "@/app/admin/shipments/actions";

type Props = {
  initialBatches: ShipmentBatchDto[];
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
};

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0 });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

/** מזהה ראשי לעובדים: מספר קונטיינר; fallback למספר מקור מהספק */
function primaryContainerId(batch: ShipmentBatchDto): string | null {
  return batch.containerNumber || batch.sourceShipmentNumber || null;
}

function listStatusLabel(batch: ShipmentBatchDto): string {
  if (batch.recordCount === 0) return "ריק";
  if (batch.paidCount >= batch.recordCount) return "שולם";
  if (batch.paidCount === 0) return "פתוח";
  return "חלקי";
}

function listStatusClass(batch: ShipmentBatchDto): string {
  if (batch.recordCount === 0) return "shp-badge--new";
  if (batch.paidCount >= batch.recordCount) return "shp-badge--paid";
  if (batch.paidCount === 0) return "shp-badge--unpaid";
  return "shp-badge--partial";
}

export function ShipmentListClient({
  initialBatches,
  initialZones,
  initialCouriers,
}: Props) {
  const router = useRouter();
  const [batches, setBatches] = useState(initialBatches);
  const [zones, setZones] = useState(initialZones);
  const [couriers, setCouriers] = useState(initialCouriers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Zone management state
  const [newZoneName, setNewZoneName] = useState("");
  const [editZoneId, setEditZoneId] = useState<string | null>(null);
  const [editZoneName, setEditZoneName] = useState("");
  const [zoneLoading, setZoneLoading] = useState(false);
  const [newCourierName, setNewCourierName] = useState("");
  const [editCourierId, setEditCourierId] = useState<string | null>(null);
  const [editCourierName, setEditCourierName] = useState("");
  const [courierLoading, setCourierLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase();
    if (!q) return batches;
    return batches.filter((batch) => {
      const container = primaryContainerId(batch)?.toLocaleLowerCase() ?? "";
      const listNumber = batch.batchNumber.toLocaleLowerCase();
      const arrival = formatDate(batch.arrivalDate).toLocaleLowerCase();
      const arrivalIso = batch.arrivalDate?.slice(0, 10) ?? "";
      return (
        container.includes(q) ||
        listNumber.includes(q) ||
        arrival.includes(q) ||
        arrivalIso.includes(q)
      );
    });
  }, [batches, searchQuery]);

  function showMsg(msg: string, isError = false) {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 3000);
  }

  async function refresh() {
    setLoading(true);
    const res = await listShipmentBatchesAction();
    setLoading(false);
    if (res.ok) setBatches(res.batches);
  }

  async function handleCreateZone() {
    if (!newZoneName.trim()) return;
    setZoneLoading(true);
    const res = await createZoneAction(newZoneName.trim());
    setZoneLoading(false);
    if (res.ok) {
      setZones((prev) => [...prev, res.zone]);
      setNewZoneName("");
      showMsg("האזור נוסף");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleUpdateZone() {
    if (!editZoneId || !editZoneName.trim()) return;
    setZoneLoading(true);
    const res = await updateZoneAction(editZoneId, editZoneName.trim());
    setZoneLoading(false);
    if (res.ok) {
      setZones((prev) => prev.map((z) => z.id === editZoneId ? { ...z, name: editZoneName.trim() } : z));
      setEditZoneId(null);
      setEditZoneName("");
      showMsg("האזור עודכן");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleDeleteZone(id: string) {
    if (!confirm("למחוק את האזור?")) return;
    setZoneLoading(true);
    const res = await deleteZoneAction(id);
    setZoneLoading(false);
    if (res.ok) {
      setZones((prev) => prev.filter((z) => z.id !== id));
      showMsg("האזור נמחק");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleToggleZone(zone: ShipmentZoneDto) {
    setZoneLoading(true);
    const res = await setZoneActiveAction(zone.id, !zone.isActive);
    setZoneLoading(false);
    if (res.ok) {
      setZones((previous) =>
        previous.map((item) =>
          item.id === zone.id ? { ...item, isActive: !item.isActive } : item,
        ),
      );
      showMsg(zone.isActive ? "האזור הושבת" : "האזור הופעל");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleCreateCourier() {
    if (!newCourierName.trim()) return;
    setCourierLoading(true);
    const res = await createCourierAction(newCourierName.trim());
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) => [
        ...previous.filter((item) => item.id !== res.courier.id),
        res.courier,
      ]);
      setNewCourierName("");
      showMsg("השליח נוסף");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleUpdateCourier() {
    if (!editCourierId || !editCourierName.trim()) return;
    setCourierLoading(true);
    const res = await updateCourierAction(editCourierId, editCourierName.trim());
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) =>
        previous.map((courier) =>
          courier.id === editCourierId
            ? { ...courier, name: editCourierName.trim() }
            : courier,
        ),
      );
      setEditCourierId(null);
      setEditCourierName("");
      showMsg("השליח עודכן");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleToggleCourier(courier: ShipmentCourierDto) {
    setCourierLoading(true);
    const res = await setCourierActiveAction(courier.id, !courier.isActive);
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) =>
        previous.map((item) =>
          item.id === courier.id ? { ...item, isActive: !item.isActive } : item,
        ),
      );
      showMsg(courier.isActive ? "השליח הושבת" : "השליח הופעל");
    } else {
      showMsg(res.error, true);
    }
  }

  async function handleDeleteCourier(id: string) {
    if (!confirm("למחוק את השליח? השיוך יוסר מהמשלוחים הקיימים.")) return;
    setCourierLoading(true);
    const res = await deleteCourierAction(id);
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) => previous.filter((courier) => courier.id !== id));
      showMsg("השליח נמחק");
    } else {
      showMsg(res.error, true);
    }
  }

  const totalRecords = batches.reduce((s, b) => s + b.recordCount, 0);
  const totalPaid = batches.reduce((s, b) => s + b.paidCount, 0);
  const totalFee = batches.reduce((s, b) => s + b.totalFeeIls, 0);

  return (
    <div className="shp-page">
      {/* Header */}
      <div className="shp-header">
        <Truck size={22} style={{ color: "#2563eb" }} />
        <h1>ניהול משלוחים</h1>
        <div className="shp-header-actions">
          <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings size={14} />
            הגדרות משלוחים
          </button>
          <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} />
            רענון
          </button>
          <button className="shp-btn shp-btn--primary" onClick={() => router.push("/admin/shipments/import")}>
            <Plus size={15} />
            ייבוא משלוח חדש
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="shp-stats">
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{batches.length}</div>
          <div className="shp-stat-card__label">אצוות</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{totalRecords}</div>
          <div className="shp-stat-card__label">משלוחים</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{totalPaid}</div>
          <div className="shp-stat-card__label">שולמו</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtIls(totalFee)}</div>
          <div className="shp-stat-card__label">סה״כ דמי משלוח</div>
        </div>
      </div>

      {/* Alerts */}
      {error && <div className="shp-alert shp-alert--error">{error}</div>}
      {success && <div className="shp-alert shp-alert--success">{success}</div>}

      {/* Module settings — inline, no modal */}
      {showSettings && (
        <div className="shp-settings-grid">
        <div className="shp-zones-panel">
          <h3><MapPin size={14} style={{ display: "inline", marginLeft: 6, verticalAlign: "middle" }} />ניהול אזורי חלוקה</h3>

          <div className="shp-zones-list">
            {zones.length === 0 && (
              <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>אין אזורים מוגדרים עדיין</span>
            )}
            {zones.map((z) => (
              <div key={z.id} className={`shp-zone-chip ${!z.isActive ? "is-inactive" : ""}`}>
                {editZoneId === z.id ? (
                  <>
                    <input
                      value={editZoneName}
                      onChange={(e) => setEditZoneName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleUpdateZone()}
                      style={{ border: "none", background: "transparent", width: 90, fontSize: "0.8rem", direction: "rtl" }}
                      autoFocus
                    />
                    <button
                      onClick={handleUpdateZone}
                      disabled={zoneLoading}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#15803d", fontSize: "0.75rem" }}
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => { setEditZoneId(null); setEditZoneName(""); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.75rem" }}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    {z.name}
                    <button
                      className="shp-zone-chip__del"
                      onClick={() => { setEditZoneId(z.id); setEditZoneName(z.name); }}
                      title="ערוך"
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      className="shp-zone-chip__del"
                      onClick={() => handleToggleZone(z)}
                      title={z.isActive ? "השבת" : "הפעל"}
                      disabled={zoneLoading}
                    >
                      {z.isActive ? <UserX size={11} /> : <UserCheck size={11} />}
                    </button>
                    <button
                      className="shp-zone-chip__del"
                      onClick={() => handleDeleteZone(z.id)}
                      title="מחק"
                    >
                      <X size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 320 }}>
            <input
              type="text"
              placeholder="שם אזור חדש..."
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateZone()}
              style={{ flex: 1, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.85rem", direction: "rtl" }}
            />
            <button
              className="shp-btn shp-btn--primary shp-btn--sm"
              onClick={handleCreateZone}
              disabled={zoneLoading || !newZoneName.trim()}
            >
              <Plus size={13} />
              הוסף
            </button>
          </div>
        </div>
        <div className="shp-zones-panel">
          <h3><Users size={14} style={{ display: "inline", marginLeft: 6, verticalAlign: "middle" }} />ניהול שליחים</h3>

          <div className="shp-zones-list">
            {couriers.length === 0 && (
              <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>אין שליחים מוגדרים עדיין</span>
            )}
            {couriers.map((courier) => (
              <div key={courier.id} className={`shp-zone-chip ${!courier.isActive ? "is-inactive" : ""}`}>
                {editCourierId === courier.id ? (
                  <>
                    <input
                      value={editCourierName}
                      onChange={(event) => setEditCourierName(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && handleUpdateCourier()}
                      className="shp-settings-chip-input"
                      autoFocus
                    />
                    <button onClick={handleUpdateCourier} disabled={courierLoading} className="shp-settings-chip-save">✓</button>
                    <button onClick={() => { setEditCourierId(null); setEditCourierName(""); }} className="shp-settings-chip-cancel">✕</button>
                  </>
                ) : (
                  <>
                    {courier.name}
                    <button
                      className="shp-zone-chip__del"
                      onClick={() => { setEditCourierId(courier.id); setEditCourierName(courier.name); }}
                      title="ערוך"
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      className="shp-zone-chip__del"
                      onClick={() => handleToggleCourier(courier)}
                      title={courier.isActive ? "השבת" : "הפעל"}
                      disabled={courierLoading}
                    >
                      {courier.isActive ? <UserX size={11} /> : <UserCheck size={11} />}
                    </button>
                    <button
                      className="shp-zone-chip__del"
                      onClick={() => handleDeleteCourier(courier.id)}
                      title="מחק"
                    >
                      <X size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="shp-settings-add">
            <input
              type="text"
              placeholder="שם שליח חדש..."
              value={newCourierName}
              onChange={(event) => setNewCourierName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleCreateCourier()}
            />
            <button
              className="shp-btn shp-btn--primary shp-btn--sm"
              onClick={handleCreateCourier}
              disabled={courierLoading || !newCourierName.trim()}
            >
              <Plus size={13} />
              הוסף
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Batches list */}
      {batches.length === 0 ? (
        <div className="shp-empty">
          <div className="shp-empty__icon"><Package size={48} /></div>
          <div className="shp-empty__title">אין אצוות משלוחים</div>
          <div className="shp-empty__sub">ייבא קובץ Excel כדי להתחיל</div>
          <div style={{ marginTop: 16 }}>
            <button className="shp-btn shp-btn--primary" onClick={() => router.push("/admin/shipments/import")}>
              <Plus size={15} />
              ייבוא משלוח
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="shp-filters">
            <Search size={14} style={{ color: "#64748b" }} />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="חיפוש לפי קונטיינר, מספר רשימה או תאריך הגעה..."
              style={{ flex: 1, minWidth: 260 }}
            />
            <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
              {filteredBatches.length} / {batches.length}
            </span>
          </div>

          {filteredBatches.length === 0 ? (
            <div className="shp-empty" style={{ padding: "40px 20px" }}>
              <div className="shp-empty__title">לא נמצאו רשימות</div>
              <div className="shp-empty__sub">נסה מספר קונטיינר, מספר רשימה או תאריך הגעה</div>
            </div>
          ) : (
            filteredBatches.map((b) => {
              const containerId = primaryContainerId(b);
              return (
                <div
                  key={b.id}
                  className="shp-batch-card"
                  onClick={() => router.push(`/admin/shipments/${b.id}`)}
                >
                  <div className="shp-batch-card__primary">
                    <div className="shp-batch-card__container">
                      {containerId ? `קונטיינר ${containerId}` : "ללא מספר קונטיינר"}
                    </div>
                    <div className="shp-batch-card__list-number">רשימה: {b.batchNumber}</div>
                  </div>

                  <div className="shp-batch-card__meta">
                    <div className="shp-batch-card__meta-item">
                      <span className="shp-batch-card__meta-label">תאריך הגעה</span>
                      <span className="shp-batch-card__meta-value">{formatDate(b.arrivalDate)}</span>
                    </div>
                    <div className="shp-batch-card__meta-item">
                      <span className="shp-batch-card__meta-label">משלוחים</span>
                      <span className="shp-batch-card__meta-value">{b.recordCount}</span>
                    </div>
                    <div className="shp-batch-card__meta-item">
                      <span className="shp-batch-card__meta-label">סה״כ דמי משלוח</span>
                      <span className="shp-batch-card__meta-value">{fmtIls(b.totalFeeIls)}</span>
                    </div>
                    <div className="shp-batch-card__meta-item">
                      <span className="shp-batch-card__meta-label">סטטוס הרשימה</span>
                      <span className={`shp-badge ${listStatusClass(b)}`}>{listStatusLabel(b)}</span>
                    </div>
                  </div>

                  <div className="shp-batch-card__arrow">
                    <ChevronLeft size={18} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
