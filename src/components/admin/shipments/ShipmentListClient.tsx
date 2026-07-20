"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  Plus,
  Truck,
  ChevronLeft,
  RefreshCw,
  MapPin,
  Edit2,
  Trash2,
  Settings,
  UserCheck,
  UserX,
  Users,
  Search,
  Layers,
  DollarSign,
  Wallet,
  FileText,
  FileSpreadsheet,
  RotateCcw,
} from "lucide-react";
import type {
  ShipmentBatchDto,
  ShipmentCourierDto,
  ShipmentPaymentStatus,
  ShipmentZoneDto,
  UpdateShipmentBatchInput,
} from "@/app/admin/shipments/types";
import { SHIPMENT_PAYMENT_STATUS_LABELS } from "@/app/admin/shipments/types";
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
  updateShipmentBatchAction,
  deleteShipmentBatchesAction,
} from "@/app/admin/shipments/actions";

type Props = {
  initialBatches: ShipmentBatchDto[];
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
};

type ListStatusFilter = "" | "empty" | "open" | "partial" | "paid";

type ListFilters = {
  freeSearch: string;
  listStatus: ListStatusFilter;
  paymentStatus: string;
  zoneId: string;
  courierId: string;
  arrivalDate: string;
  registrationDate: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: ListFilters = {
  freeSearch: "",
  listStatus: "",
  paymentStatus: "",
  zoneId: "",
  courierId: "",
  arrivalDate: "",
  registrationDate: "",
  dateFrom: "",
  dateTo: "",
};

function fmtUsd(n: number) {
  return n.toLocaleString("he-IL", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
}

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0 });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function ymd(iso: string | null): string {
  return iso?.slice(0, 10) ?? "";
}

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

function listStatusKey(batch: ShipmentBatchDto): Exclude<ListStatusFilter, ""> {
  if (batch.recordCount === 0) return "empty";
  if (batch.paidCount >= batch.recordCount) return "paid";
  if (batch.paidCount === 0) return "open";
  return "partial";
}

function matchesFilters(batch: ShipmentBatchDto, f: ListFilters): boolean {
  const arrive = ymd(batch.arrivalDate);
  const created = ymd(batch.createdAt);
  const ship = ymd(batch.shippingDate);

  if (f.arrivalDate && arrive !== f.arrivalDate) return false;
  if (f.registrationDate && created !== f.registrationDate) return false;
  if (f.dateFrom) {
    const ref = arrive || ship || created;
    if (!ref || ref < f.dateFrom) return false;
  }
  if (f.dateTo) {
    const ref = arrive || ship || created;
    if (!ref || ref > f.dateTo) return false;
  }
  if (f.listStatus && listStatusKey(batch) !== f.listStatus) return false;
  if (f.zoneId && !batch.zoneIds.includes(f.zoneId)) return false;
  if (f.courierId && !batch.courierIds.includes(f.courierId)) return false;
  if (f.paymentStatus) {
    const ps = f.paymentStatus as ShipmentPaymentStatus;
    if (!batch.paymentStatuses.includes(ps)) return false;
  }
  if (f.freeSearch.trim()) {
    const q = f.freeSearch.trim().toLocaleLowerCase();
    if (!(batch.searchText ?? "").includes(q)) return false;
  }
  return true;
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
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editBatch, setEditBatch] = useState<ShipmentBatchDto | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [newZoneName, setNewZoneName] = useState("");
  const [editZoneId, setEditZoneId] = useState<string | null>(null);
  const [editZoneName, setEditZoneName] = useState("");
  const [zoneLoading, setZoneLoading] = useState(false);
  const [newCourierName, setNewCourierName] = useState("");
  const [editCourierId, setEditCourierId] = useState<string | null>(null);
  const [editCourierName, setEditCourierName] = useState("");
  const [courierLoading, setCourierLoading] = useState(false);

  const filteredBatches = useMemo(
    () => batches.filter((b) => matchesFilters(b, filters)),
    [batches, filters],
  );

  const kpis = useMemo(() => {
    const shipmentCount = filteredBatches.length;
    const packages = filteredBatches.reduce((s, b) => s + (b.boxesSum || b.recordCount), 0);
    const totalUsd = filteredBatches.reduce((s, b) => s + b.totalOrderUsd, 0);
    const remaining = filteredBatches.reduce((s, b) => s + b.totalRemainingIls, 0);
    return { shipmentCount, packages, totalUsd, remaining };
  }, [filteredBatches]);

  function showMsg(msg: string, isError = false) {
    if (isError) setError(msg);
    else setSuccess(msg);
    setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 3000);
  }

  function patchFilter<K extends keyof ListFilters>(key: K, value: ListFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filteredBatches.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(filteredBatches.map((b) => b.id)));
  }

  function openSelected() {
    if (selected.size === 0) return;
    const ids = [...selected].join(",");
    router.push(`/admin/shipments/combined?ids=${encodeURIComponent(ids)}`);
  }

  function openCreateShipment() {
    router.push("/admin/shipments/import");
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    const count = selected.size;
    const ok = window.confirm(
      `למחוק ${count} משלוחים?\nפעולה זו תמחק גם את כל החבילות והתשלומים המשויכים ולא ניתן לבטל.`,
    );
    if (!ok) return;
    setDeleteBusy(true);
    const res = await deleteShipmentBatchesAction([...selected]);
    setDeleteBusy(false);
    if (!res.ok) {
      showMsg(res.error, true);
      return;
    }
    setSelected(new Set());
    showMsg(`נמחקו ${res.deleted} משלוחים`);
    await refresh();
  }

  async function exportExcel() {
    try {
      const XLSX = await import("xlsx");
      const rows = filteredBatches.map((b) => ({
        "מספר משלוח": primaryContainerId(b) || b.batchNumber,
        "מזהה מערכת": b.batchNumber,
        שבוע: b.weekCode ?? "",
        יציאה: formatDate(b.shippingDate),
        הגעה: formatDate(b.arrivalDate),
        "תאריך רישום": formatDate(b.createdAt),
        חבילות: b.boxesSum || b.recordCount,
        "סכום ($)": b.totalOrderUsd,
        "שולם (₪)": b.totalPaidIls,
        "יתרה (₪)": b.totalRemainingIls,
        סטטוס: listStatusLabel(b),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "משלוחים");
      XLSX.writeFile(wb, `shipments-${new Date().toISOString().slice(0, 10)}.xlsx`);
      showMsg("הקובץ הורד");
    } catch (e) {
      showMsg(String(e), true);
    }
  }

  function exportPdf() {
    const rows = filteredBatches
      .map((b) => {
        const id = primaryContainerId(b) || b.batchNumber;
        return `<tr>
          <td>${id}</td>
          <td>${b.weekCode ?? "—"}</td>
          <td>${formatDate(b.arrivalDate)}</td>
          <td>${b.boxesSum || b.recordCount}</td>
          <td>${fmtUsd(b.totalOrderUsd)}</td>
          <td>${fmtIls(b.totalRemainingIls)}</td>
          <td>${listStatusLabel(b)}</td>
        </tr>`;
      })
      .join("");
    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"/><title>משלוחים</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}
        h1{font-size:18px;margin:0 0 12px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}
        th{background:#f1f5f9}
      </style></head><body>
      <h1>רשימת משלוחים (${filteredBatches.length})</h1>
      <table><thead><tr>
        <th>מספר משלוח</th><th>שבוע</th><th>הגעה</th><th>חבילות</th><th>סכום</th><th>יתרה</th><th>סטטוס</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      showMsg("יש לאפשר חלונות קופצים לייצוא PDF", true);
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  async function refresh() {
    setLoading(true);
    const res = await listShipmentBatchesAction();
    setLoading(false);
    if (res.ok) setBatches(res.batches);
  }

  async function saveEditBatch(form: HTMLFormElement) {
    if (!editBatch) return;
    const fd = new FormData(form);
    const num = (key: string) => {
      const raw = String(fd.get(key) ?? "").trim();
      if (!raw) return null;
      const n = Number(raw.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const str = (key: string) => {
      const raw = String(fd.get(key) ?? "").trim();
      return raw || null;
    };
    const input: UpdateShipmentBatchInput = {
      batchId: editBatch.id,
      sourceShipmentNumber: str("sourceShipmentNumber"),
      containerNumber: str("containerNumber"),
      totalBoxes: num("totalBoxes"),
      totalWeight: num("totalWeight"),
      shippingDate: str("shippingDate"),
      arrivalDate: str("arrivalDate"),
      notes: str("notes"),
      applyZoneId: (() => {
        const v = String(fd.get("applyZoneId") ?? "");
        if (!v) return undefined;
        if (v === "__CLEAR__") return null;
        return v;
      })(),
      applyCourierId: (() => {
        const v = String(fd.get("applyCourierId") ?? "");
        if (!v) return undefined;
        if (v === "__CLEAR__") return null;
        return v;
      })(),
    };
    setEditSaving(true);
    const res = await updateShipmentBatchAction(input);
    setEditSaving(false);
    if (!res.ok) {
      showMsg(res.error, true);
      return;
    }
    showMsg("פרטי המשלוח עודכנו");
    setEditBatch(null);
    await refresh();
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
    } else showMsg(res.error, true);
  }

  async function handleUpdateZone() {
    if (!editZoneId || !editZoneName.trim()) return;
    setZoneLoading(true);
    const res = await updateZoneAction(editZoneId, editZoneName.trim());
    setZoneLoading(false);
    if (res.ok) {
      setZones((prev) => prev.map((z) => (z.id === editZoneId ? { ...z, name: editZoneName.trim() } : z)));
      setEditZoneId(null);
      setEditZoneName("");
      showMsg("האזור עודכן");
    } else showMsg(res.error, true);
  }

  async function handleDeleteZone(id: string) {
    if (!confirm("למחוק את האזור?")) return;
    setZoneLoading(true);
    const res = await deleteZoneAction(id);
    setZoneLoading(false);
    if (res.ok) {
      setZones((prev) => prev.filter((z) => z.id !== id));
      showMsg("האזור נמחק");
    } else showMsg(res.error, true);
  }

  async function handleToggleZone(zone: ShipmentZoneDto) {
    setZoneLoading(true);
    const res = await setZoneActiveAction(zone.id, !zone.isActive);
    setZoneLoading(false);
    if (res.ok) {
      setZones((previous) =>
        previous.map((item) => (item.id === zone.id ? { ...item, isActive: !item.isActive } : item)),
      );
      showMsg(zone.isActive ? "האזור הושבת" : "האזור הופעל");
    } else showMsg(res.error, true);
  }

  async function handleCreateCourier() {
    if (!newCourierName.trim()) return;
    setCourierLoading(true);
    const res = await createCourierAction(newCourierName.trim());
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) => [...previous.filter((item) => item.id !== res.courier.id), res.courier]);
      setNewCourierName("");
      showMsg("השליח נוסף");
    } else showMsg(res.error, true);
  }

  async function handleUpdateCourier() {
    if (!editCourierId || !editCourierName.trim()) return;
    setCourierLoading(true);
    const res = await updateCourierAction(editCourierId, editCourierName.trim());
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) =>
        previous.map((courier) =>
          courier.id === editCourierId ? { ...courier, name: editCourierName.trim() } : courier,
        ),
      );
      setEditCourierId(null);
      setEditCourierName("");
      showMsg("השליח עודכן");
    } else showMsg(res.error, true);
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
    } else showMsg(res.error, true);
  }

  async function handleDeleteCourier(id: string) {
    if (!confirm("למחוק את השליח? השיוך יוסר מהמשלוחים הקיימים.")) return;
    setCourierLoading(true);
    const res = await deleteCourierAction(id);
    setCourierLoading(false);
    if (res.ok) {
      setCouriers((previous) => previous.filter((courier) => courier.id !== id));
      showMsg("השליח נמחק");
    } else showMsg(res.error, true);
  }

  return (
    <div className="shp-page">
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
        </div>
      </div>

      <div className="shp-stats">
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{kpis.shipmentCount}</div>
          <div className="shp-stat-card__label">סה״כ משלוחים</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{kpis.packages}</div>
          <div className="shp-stat-card__label">סה״כ חבילות</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtUsd(kpis.totalUsd)}</div>
          <div className="shp-stat-card__label">סה״כ סכום ($)</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtIls(kpis.remaining)}</div>
          <div className="shp-stat-card__label">סה״כ יתרה לתשלום</div>
        </div>
      </div>

      {error && <div className="shp-alert shp-alert--error">{error}</div>}
      {success && <div className="shp-alert shp-alert--success">{success}</div>}

      {showSettings && (
        <div className="shp-settings-grid">
          <div className="shp-zones-panel">
            <h3>
              <MapPin size={14} style={{ display: "inline", marginLeft: 6, verticalAlign: "middle" }} />
              ניהול אזורי חלוקה
            </h3>
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
                        style={{
                          border: "none",
                          background: "transparent",
                          width: 90,
                          fontSize: "0.8rem",
                          direction: "rtl",
                        }}
                        autoFocus
                      />
                      <button
                        onClick={handleUpdateZone}
                        disabled={zoneLoading}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#15803d" }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          setEditZoneId(null);
                          setEditZoneName("");
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      {z.name}
                      <button
                        className="shp-zone-chip__del"
                        onClick={() => {
                          setEditZoneId(z.id);
                          setEditZoneName(z.name);
                        }}
                        title="ערוך"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        className="shp-zone-chip__del"
                        onClick={() => handleToggleZone(z)}
                        title={z.isActive ? "השבת" : "הפעל"}
                      >
                        {z.isActive ? <UserCheck size={11} /> : <UserX size={11} />}
                      </button>
                      <button className="shp-zone-chip__del" onClick={() => handleDeleteZone(z.id)} title="מחק">
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="shp-zones-add">
              <input
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="שם אזור חדש"
                onKeyDown={(e) => e.key === "Enter" && handleCreateZone()}
              />
              <button className="shp-btn shp-btn--primary shp-btn--sm" onClick={handleCreateZone} disabled={zoneLoading}>
                <Plus size={13} /> הוסף
              </button>
            </div>
          </div>

          <div className="shp-zones-panel">
            <h3>
              <Users size={14} style={{ display: "inline", marginLeft: 6, verticalAlign: "middle" }} />
              ניהול שליחים
            </h3>
            <div className="shp-zones-list">
              {couriers.length === 0 && (
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>אין שליחים מוגדרים עדיין</span>
              )}
              {couriers.map((c) => (
                <div key={c.id} className={`shp-zone-chip ${!c.isActive ? "is-inactive" : ""}`}>
                  {editCourierId === c.id ? (
                    <>
                      <input
                        value={editCourierName}
                        onChange={(e) => setEditCourierName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleUpdateCourier()}
                        style={{
                          border: "none",
                          background: "transparent",
                          width: 90,
                          fontSize: "0.8rem",
                          direction: "rtl",
                        }}
                        autoFocus
                      />
                      <button
                        onClick={handleUpdateCourier}
                        disabled={courierLoading}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#15803d" }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          setEditCourierId(null);
                          setEditCourierName("");
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      {c.name}
                      <button
                        className="shp-zone-chip__del"
                        onClick={() => {
                          setEditCourierId(c.id);
                          setEditCourierName(c.name);
                        }}
                      >
                        <Edit2 size={11} />
                      </button>
                      <button className="shp-zone-chip__del" onClick={() => handleToggleCourier(c)}>
                        {c.isActive ? <UserCheck size={11} /> : <UserX size={11} />}
                      </button>
                      <button className="shp-zone-chip__del" onClick={() => handleDeleteCourier(c.id)}>
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="shp-zones-add">
              <input
                value={newCourierName}
                onChange={(e) => setNewCourierName(e.target.value)}
                placeholder="שם שליח חדש"
                onKeyDown={(e) => e.key === "Enter" && handleCreateCourier()}
              />
              <button
                className="shp-btn shp-btn--primary shp-btn--sm"
                onClick={handleCreateCourier}
                disabled={courierLoading}
              >
                <Plus size={13} /> הוסף
              </button>
            </div>
          </div>
        </div>
      )}

      {batches.length === 0 ? (
        <div className="shp-empty">
          <div className="shp-empty__icon">
            <Package size={48} />
          </div>
          <div className="shp-empty__title">אין משלוחים</div>
          <div className="shp-empty__sub">צור משלוח חדש ומלא את פרטיו, ואז הוסף חבילות</div>
          <div style={{ marginTop: 16 }}>
            <button className="shp-btn shp-btn--primary" onClick={openCreateShipment}>
              <Plus size={15} /> יצירת משלוח
            </button>
          </div>
        </div>
      ) : (
        <div>
          {selected.size > 0 && (
            <div className="shp-selection-bar">
              <span>
                נבחרו <strong>{selected.size}</strong> משלוחים
              </span>
              <div className="shp-selection-bar__actions">
                <button type="button" className="shp-btn shp-btn--secondary shp-btn--sm" onClick={openSelected}>
                  <Layers size={14} />
                  פתח מסומנים
                </button>
                <button
                  type="button"
                  className="shp-btn shp-btn--danger shp-btn--sm"
                  onClick={() => void handleDeleteSelected()}
                  disabled={deleteBusy}
                >
                  <Trash2 size={14} />
                  מחק משלוחים
                </button>
                <button
                  type="button"
                  className="shp-btn shp-btn--ghost shp-btn--sm"
                  onClick={() => setSelected(new Set())}
                >
                  בטל סימון
                </button>
              </div>
            </div>
          )}

          <div className="shp-list-toolbar">
            <div className="shp-list-toolbar__filters">
              <div className="shp-list-toolbar__search">
                <Search size={14} />
                <input
                  value={filters.freeSearch}
                  onChange={(e) => patchFilter("freeSearch", e.target.value)}
                  placeholder="חיפוש: מספר משלוח, קוד, שם, טלפון, כתובת..."
                  aria-label="חיפוש"
                />
              </div>
              <select
                value={filters.listStatus}
                onChange={(e) => patchFilter("listStatus", e.target.value as ListStatusFilter)}
                aria-label="סטטוס"
              >
                <option value="">כל הסטטוסים</option>
                <option value="open">פתוח</option>
                <option value="partial">חלקי</option>
                <option value="paid">שולם</option>
                <option value="empty">ריק</option>
              </select>
              <select
                value={filters.paymentStatus}
                onChange={(e) => patchFilter("paymentStatus", e.target.value)}
                aria-label="סטטוס תשלום"
              >
                <option value="">סטטוס תשלום</option>
                {(Object.keys(SHIPMENT_PAYMENT_STATUS_LABELS) as ShipmentPaymentStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {SHIPMENT_PAYMENT_STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
              <select
                value={filters.zoneId}
                onChange={(e) => patchFilter("zoneId", e.target.value)}
                aria-label="אזור"
              >
                <option value="">אזור</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <select
                value={filters.courierId}
                onChange={(e) => patchFilter("courierId", e.target.value)}
                aria-label="שליח"
              >
                <option value="">שליח</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={filters.arrivalDate}
                onChange={(e) => patchFilter("arrivalDate", e.target.value)}
                title="תאריך הגעה"
                aria-label="תאריך הגעה"
              />
              <input
                type="date"
                value={filters.registrationDate}
                onChange={(e) => patchFilter("registrationDate", e.target.value)}
                title="תאריך רישום"
                aria-label="תאריך רישום"
              />
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => patchFilter("dateFrom", e.target.value)}
                title="מתאריך"
                aria-label="מתאריך"
              />
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => patchFilter("dateTo", e.target.value)}
                title="עד תאריך"
                aria-label="עד תאריך"
              />
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                onClick={() => setFilters(EMPTY_FILTERS)}
                title="איפוס מסננים"
              >
                <RotateCcw size={13} />
                איפוס
              </button>
              <span className="shp-list-toolbar__count">
                {filteredBatches.length}/{batches.length}
              </span>
            </div>

            <div className="shp-list-toolbar__actions">
              <button type="button" className="shp-btn shp-btn--primary shp-btn--sm" onClick={openCreateShipment}>
                <Plus size={14} />
                הוסף משלוח
              </button>
              <button type="button" className="shp-btn shp-btn--secondary shp-btn--sm" onClick={exportPdf}>
                <FileText size={14} />
                PDF
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                onClick={() => void exportExcel()}
              >
                <FileSpreadsheet size={14} />
                Excel
              </button>
              {selected.size > 0 ? (
                <button
                  type="button"
                  className="shp-btn shp-btn--danger shp-btn--sm"
                  onClick={() => void handleDeleteSelected()}
                  disabled={deleteBusy}
                >
                  <Trash2 size={14} />
                  מחק מסומנים
                </button>
              ) : null}
            </div>
          </div>

          {filteredBatches.length === 0 ? (
            <div className="shp-empty" style={{ padding: "40px 20px" }}>
              <div className="shp-empty__title">לא נמצאו משלוחים</div>
              <div className="shp-empty__sub">שנה את המסננים או נקה אותם</div>
            </div>
          ) : (
            <div className="shp-table-wrap">
              <table className="shp-table shp-table--list">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === filteredBatches.length}
                        onChange={toggleSelectAll}
                        aria-label="בחר הכל"
                      />
                    </th>
                    <th>מספר משלוח</th>
                    <th>שבוע</th>
                    <th>יציאה</th>
                    <th>הגעה</th>
                    <th>חבילות</th>
                    <th>
                      <DollarSign size={12} style={{ display: "inline" }} /> סכום כולל ($)
                    </th>
                    <th>
                      <Wallet size={12} style={{ display: "inline" }} /> שולם
                    </th>
                    <th>יתרה</th>
                    <th>סטטוס</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBatches.map((b) => {
                    const containerId = primaryContainerId(b);
                    return (
                      <tr key={b.id} className={selected.has(b.id) ? "is-selected" : undefined}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(b.id)}
                            onChange={() => toggleSelect(b.id)}
                            aria-label={`בחר ${b.batchNumber}`}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="shp-link-btn"
                            onClick={() => router.push(`/admin/shipments/${b.id}`)}
                          >
                            <strong>{containerId || b.batchNumber}</strong>
                            <span className="shp-muted">{b.batchNumber}</span>
                          </button>
                        </td>
                        <td>{b.weekCode ?? "—"}</td>
                        <td>{formatDate(b.shippingDate)}</td>
                        <td>{formatDate(b.arrivalDate)}</td>
                        <td>{b.boxesSum || b.recordCount}</td>
                        <td className="shp-col-money">{fmtUsd(b.totalOrderUsd)}</td>
                        <td className="shp-col-money" style={{ color: "#15803d" }}>
                          {fmtIls(b.totalPaidIls)}
                        </td>
                        <td
                          className="shp-col-money"
                          style={{ color: b.totalRemainingIls > 0 ? "#dc2626" : "#15803d", fontWeight: 600 }}
                        >
                          {fmtIls(b.totalRemainingIls)}
                        </td>
                        <td>
                          <span className={`shp-badge ${listStatusClass(b)}`}>{listStatusLabel(b)}</span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="shp-row-actions">
                            <button
                              type="button"
                              className="shp-btn shp-btn--ghost shp-btn--sm"
                              title="עריכת פרטי משלוח"
                              onClick={() => setEditBatch(b)}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              type="button"
                              className="shp-btn shp-btn--ghost shp-btn--sm"
                              title="פתח"
                              onClick={() => router.push(`/admin/shipments/${b.id}`)}
                            >
                              <ChevronLeft size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editBatch ? (
        <div className="shp-modal-backdrop" role="presentation" onClick={() => setEditBatch(null)}>
          <div className="shp-modal" dir="rtl" role="dialog" onClick={(e) => e.stopPropagation()}>
            <header className="shp-modal__head">
              <h3>עריכת משלוח {editBatch.batchNumber}</h3>
              <button type="button" className="shp-btn shp-btn--ghost shp-btn--sm" onClick={() => setEditBatch(null)}>
                ✕
              </button>
            </header>
            <form
              className="shp-modal__body shp-edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEditBatch(e.currentTarget);
              }}
            >
              <label>
                <span>מספר משלוח (מקור)</span>
                <input name="sourceShipmentNumber" defaultValue={editBatch.sourceShipmentNumber ?? ""} />
              </label>
              <label>
                <span>מספר קונטיינר</span>
                <input name="containerNumber" defaultValue={editBatch.containerNumber ?? ""} />
              </label>
              <label>
                <span>תאריך יציאה</span>
                <input name="shippingDate" type="date" defaultValue={ymd(editBatch.shippingDate)} />
              </label>
              <label>
                <span>תאריך הגעה</span>
                <input name="arrivalDate" type="date" defaultValue={ymd(editBatch.arrivalDate)} />
              </label>
              <label>
                <span>שבוע (מחושב אוטומטית)</span>
                <input value={editBatch.weekCode ?? "—"} disabled readOnly />
              </label>
              <label>
                <span>מספר קרטונים</span>
                <input name="totalBoxes" inputMode="numeric" defaultValue={editBatch.totalBoxes ?? ""} />
              </label>
              <label>
                <span>משקל</span>
                <input name="totalWeight" inputMode="decimal" defaultValue={editBatch.totalWeight ?? ""} />
              </label>
              <label>
                <span>אזור (לכל החבילות)</span>
                <select name="applyZoneId" defaultValue="">
                  <option value="">ללא שינוי</option>
                  <option value="__CLEAR__">נקה אזור מכל החבילות</option>
                  {zones.filter((z) => z.isActive || editBatch.zoneIds.includes(z.id)).map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                      {editBatch.zoneIds.includes(z.id) ? " ✓" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>שליח (לכל החבילות)</span>
                <select name="applyCourierId" defaultValue="">
                  <option value="">ללא שינוי</option>
                  <option value="__CLEAR__">נקה שליח מכל החבילות</option>
                  {couriers
                    .filter((c) => c.isActive || editBatch.courierIds.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {editBatch.courierIds.includes(c.id) ? " ✓" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="shp-edit-form__full">
                <span>הערות</span>
                <textarea name="notes" rows={3} defaultValue={editBatch.notes ?? ""} />
              </label>
              <p className="shp-muted shp-edit-form__full">
                בחירת אזור/שליח כאן מעדכנת את כל החבילות במשלוח. ניתן לערוך גם ברמת חבילה בודדת.
              </p>
              <footer className="shp-modal__foot">
                <button type="button" className="shp-btn shp-btn--secondary" onClick={() => setEditBatch(null)}>
                  ביטול
                </button>
                <button type="submit" className="shp-btn shp-btn--primary" disabled={editSaving}>
                  {editSaving ? "שומר…" : "שמור"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
