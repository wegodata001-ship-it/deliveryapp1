"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Users,
  MapPin,
  RefreshCw,
  Banknote,
  Package,
  Filter,
  CheckSquare,
  Square,
  Edit2,
} from "lucide-react";
import type {
  ShipmentBatchDto,
  ShipmentCourierDto,
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentStatus,
  UpdateShipmentRecordInput,
  UpdateShipmentBatchInput,
} from "@/app/admin/shipments/types";
import {
  SHIPMENT_PAYMENT_STATUS_LABELS,
} from "@/app/admin/shipments/types";
import {
  assignZoneAction,
  assignCourierAction,
  updateShipmentStatusAction,
  updateShipmentRecordAction,
  listShipmentRecordsAction,
  createZoneAction,
  updateShipmentBatchAction,
  getShipmentBatchAction,
} from "@/app/admin/shipments/actions";
import { ShipmentPaymentModal } from "@/components/admin/shipments/ShipmentPaymentModal";
import { InlineAutocompleteCell } from "@/components/admin/shipments/InlineAutocompleteCell";
import { InlineValueCell } from "@/components/admin/shipments/InlineValueCell";
import { SyncedTableScroll } from "@/components/admin/shipments/SyncedTableScroll";

type Props = {
  batch: ShipmentBatchDto;
  initialRecords: ShipmentRecordDto[];
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
};

const STATUS_OPTIONS: { value: ShipmentStatus; label: string }[] = [
  { value: "NEW", label: "חדש" },
  { value: "RECEIVED", label: "נקלט" },
  { value: "ASSIGNED", label: "שובץ" },
  { value: "IN_TRANSIT", label: "בדרך" },
  { value: "DELIVERED", label: "נמסר" },
  { value: "NOT_DELIVERED", label: "לא נמסר" },
  { value: "RETURNED", label: "חזר למחסן" },
  { value: "COMPLETED", label: "הושלם" },
];

function PayStatusBadge({ status }: { status: "UNPAID" | "PARTIAL" | "PAID" }) {
  const cls = `shp-badge shp-badge--${status.toLowerCase()}`;
  return <span className={cls}>{SHIPMENT_PAYMENT_STATUS_LABELS[status]}</span>;
}

function fmtIls(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2 });
}

function fmtDeliveryFee(record: ShipmentRecordDto) {
  if (record.deliveryFeeAmount == null) return fmtIls(record.deliveryFeeIls);
  const symbol: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", TRY: "₺", GBP: "£" };
  const currency = record.deliveryFeeCurrency ?? "UNKNOWN";
  const suffix = currency === "UNKNOWN" ? " (מטבע לא זוהה)" : "";
  return `${symbol[currency] ?? ""}${record.deliveryFeeAmount.toLocaleString("he-IL", {
    maximumFractionDigits: 4,
  })}${suffix}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function formatPaymentDate(record: ShipmentRecordDto): string {
  if (!record.payments.length) return "—";
  const last = record.payments[record.payments.length - 1];
  const raw = last.details?.paymentDate || last.createdAt;
  return formatDate(raw);
}

function formatAddress(record: ShipmentRecordDto): string {
  const parts = [record.address, record.city].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function batchShipmentLabel(batch: ShipmentBatchDto): string {
  return batch.containerNumber || batch.sourceShipmentNumber || batch.batchNumber;
}

export function ShipmentBatchClient({
  batch: initialBatch,
  initialRecords,
  initialZones,
  initialCouriers,
}: Props) {
  const router = useRouter();
  const [batch, setBatch] = useState(initialBatch);
  const [records, setRecords] = useState<ShipmentRecordDto[]>(initialRecords);
  const [zones, setZones] = useState<ShipmentZoneDto[]>(initialZones);
  const [couriers, setCouriers] = useState<ShipmentCourierDto[]>(initialCouriers);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [paymentRecord, setPaymentRecord] = useState<ShipmentRecordDto | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterZone, setFilterZone] = useState("");
  const [filterCourier, setFilterCourier] = useState("");
  const [filterPayStatus, setFilterPayStatus] = useState("");

  // Bulk assign
  const [bulkZoneId, setBulkZoneId] = useState("");
  const [bulkCourierId, setBulkCourierId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<ShipmentStatus | "">("");

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterZone && r.zoneId !== filterZone) return false;
      if (filterCourier && !(r.courierName ?? "").includes(filterCourier)) return false;
      if (filterPayStatus && r.paymentStatus !== filterPayStatus) return false;
      return true;
    });
  }, [records, filterStatus, filterZone, filterCourier, filterPayStatus]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filteredRecords.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredRecords.map((r) => r.id)));
    }
  }

  const clearMsg = useCallback(() => {
    setTimeout(() => { setError(null); setSuccess(null); }, 3000);
  }, []);

  async function refresh() {
    setLoading(true);
    const res = await listShipmentRecordsAction(batch.id);
    setLoading(false);
    if (res.ok) setRecords(res.records);
  }

  async function handleBulkZone() {
    if (!bulkZoneId || selected.size === 0) return;
    setLoading(true);
    const res = await assignZoneAction({ recordIds: Array.from(selected), zoneId: bulkZoneId });
    setLoading(false);
    if (res.ok) {
      setSuccess(`שויך אזור ל-${selected.size} משלוחים`);
      setSelected(new Set());
      await refresh();
    } else {
      setError(res.error);
    }
    clearMsg();
  }

  async function handleBulkCourier() {
    if (!bulkCourierId || selected.size === 0) return;
    setLoading(true);
    const res = await assignCourierAction({
      recordIds: Array.from(selected),
      courierId: bulkCourierId,
    });
    setLoading(false);
    if (res.ok) {
      setSuccess(`שויך שליח ל-${selected.size} משלוחים`);
      setSelected(new Set());
      await refresh();
    } else {
      setError(res.error);
    }
    clearMsg();
  }

  async function handleBulkStatus() {
    if (!bulkStatus || selected.size === 0) return;
    setLoading(true);
    const res = await updateShipmentStatusAction({ recordIds: Array.from(selected), status: bulkStatus });
    setLoading(false);
    if (res.ok) {
      setSuccess(`עודכן סטטוס ל-${selected.size} משלוחים`);
      setSelected(new Set());
      await refresh();
    } else {
      setError(res.error);
    }
    clearMsg();
  }

  async function handleRowZone(
    recordId: string,
    zone: { id: string; name: string } | null,
  ): Promise<boolean> {
    const zoneId = zone?.id ?? null;
    const result = await assignZoneAction({ recordIds: [recordId], zoneId });
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return false;
    }
    setRecords((prev) => prev.map((r) => {
      if (r.id !== recordId) return r;
      return { ...r, zoneId, zoneName: zone?.name ?? null };
    }));
    showSaved();
    return true;
  }

  async function handleRowStatus(recordId: string, status: ShipmentStatus) {
    const result = await updateShipmentStatusAction({ recordIds: [recordId], status });
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return;
    }
    setRecords((prev) => prev.map((r) => r.id === recordId ? { ...r, status } : r));
    showSaved();
  }

  function showSaved(message = "✓ נשמר") {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 1200);
  }

  async function saveRecordPatch(
    recordId: string,
    patch: UpdateShipmentRecordInput["patch"],
    optimisticPatch: Partial<ShipmentRecordDto>,
  ): Promise<boolean> {
    const result = await updateShipmentRecordAction({ recordId, patch });
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return false;
    }
    setRecords((previous) =>
      previous.map((record) =>
        record.id === recordId ? { ...record, ...optimisticPatch } : record,
      ),
    );
    showSaved();
    return true;
  }

  async function quickAddZone(name: string) {
    const result = await createZoneAction(name);
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return null;
    }
    setZones((previous) => {
      const without = previous.filter((zone) => zone.id !== result.zone.id);
      return [...without, result.zone];
    });
    return result.zone;
  }

  function handlePaymentSaved(updated: ShipmentRecordDto) {
    setRecords((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    setPaymentRecord(updated);
  }

  const allSelected = filteredRecords.length > 0 && selected.size === filteredRecords.length;
  const totalFee = records.reduce((s, r) => s + (r.deliveryFeeIls ?? 0), 0);
  const totalPaid = records.reduce((s, r) => s + r.paidAmountIls, 0);
  const paidCount = records.filter((r) => r.paymentStatus === "PAID").length;

  return (
    <div className="shp-page shp-page--wide">
      {/* Back + header */}
      <div className="shp-header">
        <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={() => router.back()}>
          <ArrowRight size={14} />
          חזרה
        </button>
        <div>
          <h1>
            <Package size={20} style={{ display: "inline", marginLeft: 8, verticalAlign: "middle" }} />
            {batch.batchNumber}
          </h1>
          {batch.containerNumber && (
            <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 2 }}>
              קונטיינר: {batch.containerNumber}
              {batch.weekCode ? ` · ${batch.weekCode}` : ""}
            </div>
          )}
        </div>
        <div className="shp-header-actions">
          <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={() => setEditOpen(true)}>
            <Edit2 size={14} />
            עריכת פרטי משלוח
          </button>
          <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "shp-spinner--dark" : ""} />
            רענון
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="shp-stats">
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{records.length}</div>
          <div className="shp-stat-card__label">חבילות / לקוחות</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{paidCount}</div>
          <div className="shp-stat-card__label">שולמו</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{records.length - paidCount}</div>
          <div className="shp-stat-card__label">ממתינים</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtIls(totalFee)}</div>
          <div className="shp-stat-card__label">סה״כ דמי משלוח</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtIls(totalPaid)}</div>
          <div className="shp-stat-card__label">נגבה</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{batch.arrivalDate ? formatDate(batch.arrivalDate) : "—"}</div>
          <div className="shp-stat-card__label">תאריך הגעה</div>
        </div>
      </div>

      {/* Alerts */}
      {error && <div className="shp-alert shp-alert--error">{error}</div>}
      {success && <div className="shp-alert shp-alert--success">{success}</div>}

      {/* Filters */}
      <div className="shp-filters">
        <Filter size={14} style={{ color: "#64748b" }} />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">כל הסטטוסים</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filterZone} onChange={(e) => setFilterZone(e.target.value)}>
          <option value="">כל האזורים</option>
          {zones.filter((zone) => zone.isActive).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <input
          placeholder="שם שליח..."
          value={filterCourier}
          onChange={(e) => setFilterCourier(e.target.value)}
          style={{ width: 140 }}
        />
        <select value={filterPayStatus} onChange={(e) => setFilterPayStatus(e.target.value)}>
          <option value="">סטטוס תשלום</option>
          <option value="UNPAID">לא שולם</option>
          <option value="PARTIAL">חלקי</option>
          <option value="PAID">שולם</option>
        </select>
        <span style={{ fontSize: "0.8rem", color: "#64748b", marginRight: "auto" }}>
          {filteredRecords.length} / {records.length} שורות
        </span>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="shp-toolbar">
          <span className="shp-toolbar__count">{selected.size} נבחרו</span>

          <select value={bulkZoneId} onChange={(e) => setBulkZoneId(e.target.value)} style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid #93c5fd" }}>
            <option value="">בחר אזור...</option>
            {zones.filter((zone) => zone.isActive).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <button className="shp-btn shp-btn--primary shp-btn--sm" onClick={handleBulkZone} disabled={!bulkZoneId || loading}>
            <MapPin size={13} />
            שייך אזור
          </button>

          <select
            value={bulkCourierId}
            onChange={(e) => setBulkCourierId(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid #93c5fd" }}
          >
            <option value="">בחר שליח...</option>
            {couriers.filter((courier) => courier.isActive).map((courier) => (
              <option key={courier.id} value={courier.id}>{courier.name}</option>
            ))}
          </select>
          <button className="shp-btn shp-btn--primary shp-btn--sm" onClick={handleBulkCourier} disabled={!bulkCourierId || loading}>
            <Users size={13} />
            שייך שליח
          </button>

          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as ShipmentStatus | "")} style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid #93c5fd" }}>
            <option value="">עדכן סטטוס...</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={handleBulkStatus} disabled={!bulkStatus || loading}>
            עדכן
          </button>
        </div>
      )}

      {/* Main table */}
      <SyncedTableScroll>
        <table className="shp-table shp-batch-table">
          <thead>
            <tr>
              <th className="shp-col-check" onClick={toggleAll} style={{ cursor: "pointer" }}>
                {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              </th>
              <th className="shp-col-arrival">תאריך הגעה</th>
              <th className="shp-col-shipment-no">מספר משלוח</th>
              <th className="shp-col-code">קוד לקוח</th>
              <th className="shp-col-customer">שם לקוח</th>
              <th className="shp-col-phone">טלפון</th>
              <th className="shp-col-address">כתובת</th>
              <th className="shp-col-zone">אזור חלוקה</th>
              <th className="shp-col-boxes">חבילות</th>
              <th className="shp-col-fee">דמי משלוח</th>
              <th className="shp-col-pay-date">תאריך רישום</th>
              <th className="shp-col-status">סטטוס</th>
              <th className="shp-col-pay-status">סטטוס תשלום</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 && (
              <tr>
                <td colSpan={13} style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                  אין שורות להצגה
                </td>
              </tr>
            )}
            {filteredRecords.map((r) => {
              const feeAmount = r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0;
              const feeIsIls =
                r.deliveryFeeCurrency === "ILS" ||
                (r.deliveryFeeCurrency == null && r.deliveryFeeIls != null) ||
                r.deliveryFeeCurrency == null;
              const canCollect = feeAmount > 0 && feeIsIls;
              return (
                <tr key={r.id} className={selected.has(r.id) ? "shp-row--selected" : ""}>
                  <td className="shp-col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                    />
                  </td>
                  <td className="shp-col-arrival">{formatDate(batch.arrivalDate)}</td>
                  <td className="shp-col-shipment-no">
                    <strong>{batchShipmentLabel(batch)}</strong>
                    <span className="shp-muted" style={{ display: "block", fontSize: "0.7rem" }}>
                      {batch.batchNumber}
                    </span>
                  </td>
                  <td className="shp-col-code">{r.customerCode || "—"}</td>
                  <td className="shp-col-customer">{r.customerName || "—"}</td>
                  <td className="shp-col-phone">{r.customerPhone || "—"}</td>
                  <td className="shp-col-address" title={formatAddress(r)}>
                    {formatAddress(r)}
                  </td>
                  <td className="shp-col-zone">
                    <InlineAutocompleteCell
                      valueId={r.zoneId}
                      valueName={r.zoneName}
                      options={zones}
                      placeholder="בחר אזור..."
                      entityLabel="אזור"
                      onSelect={(option) => handleRowZone(r.id, option)}
                      onCreate={quickAddZone}
                    />
                  </td>
                  <td className="shp-col-boxes">
                    <InlineValueCell
                      value={r.boxes}
                      type="number"
                      min={0}
                      step={1}
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { boxes: value as number | null },
                          { boxes: value as number | null },
                        )
                      }
                    />
                  </td>
                  <td className="shp-col-fee">
                    <InlineValueCell
                      value={r.deliveryFeeAmount ?? r.deliveryFeeIls}
                      type="number"
                      min={0}
                      step={0.01}
                      format={() => fmtDeliveryFee(r)}
                      onSave={(value) => {
                        const amount = value as number | null;
                        const currency = r.deliveryFeeCurrency ?? "ILS";
                        const paymentStatus =
                          currency !== "ILS" || amount == null || amount <= 0
                            ? "UNPAID"
                            : r.paidAmountIls >= amount
                              ? "PAID"
                              : r.paidAmountIls > 0
                                ? "PARTIAL"
                                : "UNPAID";
                        return saveRecordPatch(
                          r.id,
                          { deliveryFeeAmount: amount, deliveryFeeCurrency: currency },
                          {
                            deliveryFeeAmount: amount,
                            deliveryFeeCurrency: currency,
                            deliveryFeeIls: currency === "ILS" ? amount : null,
                            remainingFeeIls:
                              currency === "ILS"
                                ? Math.max(0, (amount ?? 0) - r.paidAmountIls)
                                : 0,
                            paymentStatus,
                          },
                        );
                      }}
                    />
                  </td>
                  <td className="shp-col-pay-date">{formatPaymentDate(r)}</td>
                  <td className="shp-col-status">
                    <select
                      className="shp-inline-select"
                      value={r.status}
                      onChange={(e) => handleRowStatus(r.id, e.target.value as ShipmentStatus)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="shp-col-pay-status">
                    <button
                      type="button"
                      className="shp-pay-status-btn"
                      onClick={() => setPaymentRecord(r)}
                      disabled={!canCollect}
                      title={
                        feeAmount <= 0
                          ? "יש להזין דמי משלוח לפני הגבייה"
                          : !feeIsIls
                            ? "קליטת תשלום זמינה לדמי משלוח בש״ח בלבד"
                            : "פתיחת גבייה"
                      }
                    >
                      <PayStatusBadge status={r.paymentStatus} />
                      {canCollect ? <Banknote size={12} /> : null}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SyncedTableScroll>

      {/* Payment modal */}
      {paymentRecord && (
        <ShipmentPaymentModal
          record={paymentRecord}
          onClose={() => setPaymentRecord(null)}
          onSaved={handlePaymentSaved}
        />
      )}

      {editOpen ? (
        <div className="shp-modal-backdrop" role="presentation" onClick={() => setEditOpen(false)}>
          <div className="shp-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <header className="shp-modal__head">
              <h3>עריכת משלוח {batch.batchNumber}</h3>
              <button type="button" className="shp-btn shp-btn--ghost shp-btn--sm" onClick={() => setEditOpen(false)}>
                ✕
              </button>
            </header>
            <form
              className="shp-modal__body shp-edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const str = (k: string) => {
                  const v = String(fd.get(k) ?? "").trim();
                  return v || null;
                };
                const num = (k: string) => {
                  const v = String(fd.get(k) ?? "").trim();
                  if (!v) return null;
                  const n = Number(v.replace(",", "."));
                  return Number.isFinite(n) ? n : null;
                };
                const input: UpdateShipmentBatchInput = {
                  batchId: batch.id,
                  sourceShipmentNumber: str("sourceShipmentNumber"),
                  containerNumber: str("containerNumber"),
                  shippingDate: str("shippingDate"),
                  arrivalDate: str("arrivalDate"),
                  totalBoxes: num("totalBoxes"),
                  totalWeight: num("totalWeight"),
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
                void updateShipmentBatchAction(input).then(async (res) => {
                  setEditSaving(false);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  const refreshed = await getShipmentBatchAction(batch.id);
                  if (refreshed.ok) setBatch(refreshed.batch);
                  const recRes = await listShipmentRecordsAction(batch.id);
                  if (recRes.ok) setRecords(recRes.records);
                  setEditOpen(false);
                  setSuccess("פרטי המשלוח עודכנו");
                });
              }}
            >
              <label>
                <span>מספר משלוח (מקור)</span>
                <input name="sourceShipmentNumber" defaultValue={batch.sourceShipmentNumber ?? ""} />
              </label>
              <label>
                <span>קונטיינר</span>
                <input name="containerNumber" defaultValue={batch.containerNumber ?? ""} />
              </label>
              <label>
                <span>תאריך יציאה</span>
                <input name="shippingDate" type="date" defaultValue={batch.shippingDate?.slice(0, 10) ?? ""} />
              </label>
              <label>
                <span>תאריך הגעה</span>
                <input name="arrivalDate" type="date" defaultValue={batch.arrivalDate?.slice(0, 10) ?? ""} />
              </label>
              <label>
                <span>שבוע (מחושב)</span>
                <input value={batch.weekCode ?? "—"} disabled readOnly />
              </label>
              <label>
                <span>קרטונים</span>
                <input name="totalBoxes" defaultValue={batch.totalBoxes ?? ""} />
              </label>
              <label>
                <span>משקל</span>
                <input name="totalWeight" defaultValue={batch.totalWeight ?? ""} />
              </label>
              <label>
                <span>אזור (לכל החבילות)</span>
                <select name="applyZoneId" defaultValue="">
                  <option value="">ללא שינוי</option>
                  <option value="__CLEAR__">נקה אזור מכל החבילות</option>
                  {zones
                    .filter((z) => z.isActive || batch.zoneIds.includes(z.id))
                    .map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                        {batch.zoneIds.includes(z.id) ? " ✓" : ""}
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
                    .filter((c) => c.isActive || batch.courierIds.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {batch.courierIds.includes(c.id) ? " ✓" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="shp-edit-form__full">
                <span>הערות</span>
                <textarea name="notes" rows={3} defaultValue={batch.notes ?? ""} />
              </label>
              <footer className="shp-modal__foot" style={{ gridColumn: "1 / -1" }}>
                <button type="button" className="shp-btn shp-btn--secondary" onClick={() => setEditOpen(false)}>
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
