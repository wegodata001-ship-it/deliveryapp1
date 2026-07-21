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
  CheckSquare,
  Square,
  Edit2,
  Plus,
  Search,
  Trash2,
  FileText,
  FileSpreadsheet,
  RotateCcw,
  Upload,
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
  assignZoneAction,
  assignCourierAction,
  updateShipmentStatusAction,
  updateShipmentRecordAction,
  listShipmentRecordsAction,
  createZoneAction,
  createCourierAction,
  updateShipmentBatchAction,
  getShipmentBatchAction,
  deleteShipmentRecordAction,
} from "@/app/admin/shipments/actions";
import { ShipmentPaymentModal } from "@/components/admin/shipments/ShipmentPaymentModal";
import { ShipmentBatchImportModal } from "@/components/admin/shipments/ShipmentBatchImportModal";
import { InlineAutocompleteCell } from "@/components/admin/shipments/InlineAutocompleteCell";
import { InlineValueCell } from "@/components/admin/shipments/InlineValueCell";
import { SyncedTableScroll } from "@/components/admin/shipments/SyncedTableScroll";
import type { ShipmentControlRecord } from "@/app/admin/shipments/control/types";
import {
  exportShipmentReportExcel,
  exportShipmentReportPdf,
} from "@/lib/shipment-report-export";

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

function fmtIls(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2 });
}

function fmtOrderAmount(record: ShipmentRecordDto) {
  if (record.orderAmount == null) return "—";
  const symbol: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", TRY: "₺", GBP: "£" };
  const currency = record.orderCurrency ?? "UNKNOWN";
  const suffix = currency === "UNKNOWN" ? ` ${currency}` : "";
  return `${symbol[currency] ?? ""}${record.orderAmount.toLocaleString("he-IL", {
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

function batchShipmentLabel(batch: ShipmentBatchDto): string {
  return batch.containerNumber || batch.sourceShipmentNumber || batch.batchNumber;
}

function recordPaymentYmd(record: ShipmentRecordDto): string {
  if (!record.payments.length) return "";
  const last = record.payments[record.payments.length - 1];
  const raw = last.details?.paymentDate || last.createdAt;
  return raw?.slice(0, 10) ?? "";
}

function toControlRecord(batch: ShipmentBatchDto, r: ShipmentRecordDto): ShipmentControlRecord {
  return {
    id: r.id,
    batchId: r.batchId,
    batchNumber: r.batchNumber,
    containerNumber: batch.containerNumber,
    rowIndex: r.rowIndex,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    address: r.address,
    city: r.city,
    boxes: r.boxes,
    cartonDetails: r.cartonDetails,
    weight: r.weight,
    orderAmount: r.orderAmount,
    orderCurrency: r.orderCurrency,
    deliveryFeeAmount: r.deliveryFeeAmount,
    deliveryFeeCurrency: r.deliveryFeeCurrency,
    deliveryFeeIls: r.deliveryFeeIls,
    zoneId: r.zoneId,
    zoneName: r.zoneName,
    courierId: r.courierId,
    courierName: r.courierName,
    status: r.status,
    paymentStatus: r.paymentStatus,
    paidAmountIls: r.paidAmountIls,
    remainingFeeIls: r.remainingFeeIls,
    notes: r.notes,
    createdAt: r.createdAt,
    payments: r.payments.map((p) => ({
      id: p.id,
      method: p.method,
      methodLabel: p.methodLabel,
      amountIls: p.amountIls,
      details: p.details,
      notes: p.notes,
      createdAt: p.createdAt,
    })),
  };
}

type RowFilters = {
  search: string;
  arrivalDate: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_ROW_FILTERS: RowFilters = {
  search: "",
  arrivalDate: "",
  dateFrom: "",
  dateTo: "",
};

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
  const [importOpen, setImportOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Filters
  const [filters, setFilters] = useState<RowFilters>(EMPTY_ROW_FILTERS);
  const [exportBusy, setExportBusy] = useState(false);

  // Bulk assign
  const [bulkZoneId, setBulkZoneId] = useState("");
  const [bulkCourierId, setBulkCourierId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<ShipmentStatus | "">("");

  const shipmentLabel = batchShipmentLabel(batch);
  const arrivalYmd = batch.arrivalDate?.slice(0, 10) ?? "";

  const filteredRecords = useMemo(() => {
    const q = filters.search.trim().toLocaleLowerCase();
    return records.filter((r) => {
      if (filters.arrivalDate && arrivalYmd !== filters.arrivalDate) return false;
      const rangeDate = arrivalYmd || r.createdAt.slice(0, 10);
      if (filters.dateFrom && (!rangeDate || rangeDate < filters.dateFrom)) return false;
      if (filters.dateTo && (!rangeDate || rangeDate > filters.dateTo)) return false;
      if (q) {
        const hay = [
          shipmentLabel,
          batch.batchNumber,
          batch.sourceShipmentNumber,
          batch.containerNumber,
          r.customerCode,
          r.customerName,
          r.customerPhone,
          r.address,
          r.city,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, filters, arrivalYmd, shipmentLabel, batch.batchNumber, batch.sourceShipmentNumber, batch.containerNumber]);

  function patchFilter<K extends keyof RowFilters>(key: K, value: RowFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

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

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!confirm(`למחוק ${count} משלוחים מסומנים?\nפעולה זו אינה ניתנת לביטול.`)) return;
    setLoading(true);
    const ids = Array.from(selected);
    const errors: string[] = [];
    for (const id of ids) {
      const res = await deleteShipmentRecordAction(id);
      if (!res.ok) errors.push(res.error);
    }
    setLoading(false);
    setSelected(new Set());
    await refresh();
    if (errors.length) {
      setError(`נמחקו חלקית. שגיאות: ${errors.slice(0, 2).join("; ")}`);
    } else {
      setSuccess(`נמחקו ${count} משלוחים`);
    }
    clearMsg();
  }

  async function handleExport(format: "excel" | "pdf") {
    const source = selected.size > 0
      ? filteredRecords.filter((r) => selected.has(r.id))
      : filteredRecords;
    if (source.length === 0) {
      setError("אין שורות לייצוא");
      clearMsg();
      return;
    }
    setExportBusy(true);
    try {
      const mapped = source.map((r) => toControlRecord(batch, r));
      const params = {
        kind: "all" as const,
        records: mapped,
        filters: {
          dateFrom: "",
          dateTo: "",
          containerNumber: "",
          zoneId: "",
          courierName: "",
          status: "",
          paymentScope: "all" as const,
        },
        meta: {
          companyName: "Wego",
          generatedBy: "מערכת משלוחים",
          generatedAt: new Date(),
        },
      };
      if (format === "excel") await exportShipmentReportExcel(params);
      else await exportShipmentReportPdf(params);
      setSuccess(format === "excel" ? "קובץ Excel הורד" : "PDF נפתח");
    } catch (e) {
      setError(String(e));
    }
    setExportBusy(false);
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

  async function handleRowCourier(
    recordId: string,
    courier: { id: string; name: string } | null,
  ): Promise<boolean> {
    const courierId = courier?.id ?? null;
    const result = await assignCourierAction({ recordIds: [recordId], courierId });
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return false;
    }
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, courierId, courierName: courier?.name ?? null }
          : r,
      ),
    );
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

  async function quickAddCourier(name: string) {
    const result = await createCourierAction(name);
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return null;
    }
    setCouriers((previous) => {
      const without = previous.filter((courier) => courier.id !== result.courier.id);
      return [...without, result.courier];
    });
    return result.courier;
  }

  function handlePaymentSaved(updated: ShipmentRecordDto) {
    setRecords((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    setPaymentRecord(updated);
  }

  const allSelected =
    filteredRecords.length > 0 && filteredRecords.every((r) => selected.has(r.id));
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
          <button className="shp-btn shp-btn--primary shp-btn--sm" onClick={() => setImportOpen(true)}>
            <Upload size={14} />
            ייבוא Excel
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

      {/* Filters + actions — שורה אחת בלי גלילה */}
      <div className="shp-filter-toolbar shp-filter-toolbar--single" dir="rtl">
        <div className="shp-filter-toolbar__row">
          <div className="shp-filter-toolbar__search">
            <Search size={14} />
            <input
              value={filters.search}
              onChange={(e) => patchFilter("search", e.target.value)}
              placeholder="חיפוש: מספר, שם, טלפון, כתובת…"
              aria-label="חיפוש"
            />
          </div>
          <label className="shp-filter-toolbar__date">
            <span>מתאריך</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => patchFilter("dateFrom", e.target.value)}
            />
          </label>
          <label className="shp-filter-toolbar__date">
            <span>עד תאריך</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => patchFilter("dateTo", e.target.value)}
            />
          </label>
          <label className="shp-filter-toolbar__date">
            <span>תאריך הגעה</span>
            <input
              type="date"
              value={filters.arrivalDate}
              onChange={(e) => patchFilter("arrivalDate", e.target.value)}
            />
          </label>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={() => setFilters(EMPTY_ROW_FILTERS)}
            title="איפוס מסננים"
          >
            <RotateCcw size={13} />
            איפוס
          </button>
          <span className="shp-filter-toolbar__count">
            {filteredRecords.length}/{records.length}
          </span>
          <button
            type="button"
            className="shp-btn shp-btn--primary shp-btn--sm"
            onClick={() => router.push("/admin/shipments/import")}
          >
            <Plus size={14} />
            הוסף משלוח
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            disabled={exportBusy || filteredRecords.length === 0}
            onClick={() => void handleExport("pdf")}
          >
            <FileText size={14} />
            PDF
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            disabled={exportBusy || filteredRecords.length === 0}
            onClick={() => void handleExport("excel")}
          >
            <FileSpreadsheet size={14} />
            Excel
          </button>
          {selected.size > 0 ? (
            <button
              type="button"
              className="shp-btn shp-btn--danger shp-btn--sm"
              disabled={loading}
              onClick={() => void handleBulkDelete()}
            >
              <Trash2 size={14} />
              מחק מסומנים
            </button>
          ) : null}
        </div>
      </div>

      {/* Selection + bulk toolbar */}
      {selected.size > 0 && (
        <div className="shp-toolbar">
          <span className="shp-toolbar__count">נבחרו {selected.size} משלוחים</span>

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

          <button
            type="button"
            className="shp-btn shp-btn--danger shp-btn--sm"
            disabled={loading}
            onClick={() => void handleBulkDelete()}
          >
            <Trash2 size={13} />
            מחק משלוחים
          </button>
        </div>
      )}

      {/* Main table — Excel-style: כל העמודות בשורה אחת, עריכה מקומית */}
      <SyncedTableScroll>
        <table className="shp-table shp-batch-table">
          <thead>
            <tr>
              <th className="shp-col-check" onClick={toggleAll} style={{ cursor: "pointer" }}>
                {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              </th>
              <th>#</th>
              <th className="shp-col-customer">לקוח</th>
              <th>טלפון</th>
              <th className="shp-col-address">כתובת</th>
              <th>עיר</th>
              <th>קרטונים</th>
              <th>משקל</th>
              <th className="shp-col-money">סכום הזמנה</th>
              <th className="shp-col-money">דמי משלוח ₪</th>
              <th className="shp-col-payment">גבייה</th>
              <th className="shp-col-money">סכום ששולם</th>
              <th className="shp-col-money">יתרה</th>
              <th className="shp-col-pay-date">תאריך גבייה</th>
              <th className="shp-col-zone">אזור</th>
              <th className="shp-col-courier">שליח</th>
              <th className="shp-col-notes">הערות</th>
              <th className="shp-col-status">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 && (
              <tr>
                <td colSpan={18} style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                  אין שורות להצגה
                </td>
              </tr>
            )}
            {filteredRecords.map((r) => {
              const feeAmount = r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0;
              const canCollect = feeAmount > 0;
              return (
                <tr key={r.id} className={selected.has(r.id) ? "shp-row--selected" : ""}>
                  <td className="shp-col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                    />
                  </td>
                  <td style={{ color: "#64748b", fontSize: "0.75rem" }}>{r.rowIndex}</td>
                  <td className="shp-col-customer" style={{ fontWeight: 600 }}>
                    <InlineValueCell
                      value={r.customerName}
                      type="text"
                      placeholder="שם לקוח"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { customerName: (value as string | null) || null },
                          { customerName: (value as string | null) || null },
                        )
                      }
                    />
                  </td>
                  <td style={{ direction: "ltr", textAlign: "right" }}>
                    <InlineValueCell
                      value={r.customerPhone}
                      type="text"
                      placeholder="טלפון"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { customerPhone: (value as string | null) || null },
                          { customerPhone: (value as string | null) || null },
                        )
                      }
                    />
                  </td>
                  <td className="shp-col-address">
                    <InlineValueCell
                      value={r.address}
                      type="text"
                      placeholder="כתובת"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { address: (value as string | null) || null },
                          { address: (value as string | null) || null },
                        )
                      }
                    />
                  </td>
                  <td>
                    <InlineValueCell
                      value={r.city}
                      type="text"
                      placeholder="עיר"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { city: (value as string | null) || null },
                          { city: (value as string | null) || null },
                        )
                      }
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <InlineValueCell
                      value={r.boxes}
                      type="number"
                      min={0}
                      step={1}
                      placeholder="0"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { boxes: value as number | null },
                          { boxes: value as number | null },
                        )
                      }
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <InlineValueCell
                      value={r.weight}
                      type="number"
                      min={0}
                      step={0.001}
                      suffix=" ק״ג"
                      placeholder="0"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { weight: value as number | null },
                          { weight: value as number | null },
                        )
                      }
                    />
                  </td>
                  <td className="shp-col-money">
                    <InlineValueCell
                      value={r.orderAmount}
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="סכום"
                      format={() => fmtOrderAmount(r)}
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { orderAmount: value as number | null },
                          { orderAmount: value as number | null },
                        )
                      }
                    />
                  </td>
                  <td className="shp-col-money shp-col-fee" style={{ fontWeight: 600, color: "#1d4ed8" }}>
                    <InlineValueCell
                      value={r.deliveryFeeAmount ?? r.deliveryFeeIls}
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="הזן דמי משלוח"
                      format={(v) => (v == null ? "הזן דמי משלוח" : fmtIls(typeof v === "number" ? v : Number(v)))}
                      onSave={(value) => {
                        const amount = value as number | null;
                        const paymentStatus =
                          amount == null || amount <= 0
                            ? "UNPAID"
                            : r.paidAmountIls >= amount
                              ? "PAID"
                              : r.paidAmountIls > 0
                                ? "PARTIAL"
                                : "UNPAID";
                        return saveRecordPatch(
                          r.id,
                          { deliveryFeeAmount: amount, deliveryFeeCurrency: "ILS" },
                          {
                            deliveryFeeAmount: amount,
                            deliveryFeeCurrency: "ILS",
                            deliveryFeeIls: amount,
                            remainingFeeIls: Math.max(0, (amount ?? 0) - r.paidAmountIls),
                            paymentStatus,
                          },
                        );
                      }}
                    />
                  </td>
                  <td className="shp-col-payment">
                    <button
                      type="button"
                      className="shp-btn shp-btn--sm shp-btn--primary"
                      onClick={() => setPaymentRecord(r)}
                      disabled={!canCollect}
                      title={
                        feeAmount <= 0
                          ? "יש להזין דמי משלוח בעמודה לפני הגבייה"
                          : undefined
                      }
                    >
                      <Banknote size={13} />
                      {feeAmount <= 0
                        ? "גבייה"
                        : r.paymentStatus === "PAID"
                          ? "✓ שולם"
                          : r.paymentStatus === "PARTIAL"
                            ? "חלקי"
                            : "גבה"}
                    </button>
                  </td>
                  <td className="shp-col-money" style={{ color: "#15803d", fontWeight: 600 }}>
                    {fmtIls(r.paidAmountIls)}
                  </td>
                  <td
                    className="shp-col-money"
                    style={{
                      color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d",
                      fontWeight: 600,
                    }}
                  >
                    {fmtIls(r.remainingFeeIls)}
                  </td>
                  <td className="shp-col-pay-date">{formatPaymentDate(r)}</td>
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
                  <td className="shp-col-courier">
                    <InlineAutocompleteCell
                      valueId={r.courierId}
                      valueName={r.courierName}
                      options={couriers}
                      placeholder="בחר שליח..."
                      entityLabel="שליח"
                      onSelect={(option) => handleRowCourier(r.id, option)}
                      onCreate={quickAddCourier}
                    />
                  </td>
                  <td className="shp-col-notes">
                    <InlineValueCell
                      value={r.notes}
                      type="text"
                      onSave={(value) =>
                        saveRecordPatch(
                          r.id,
                          { notes: (value as string | null) || null },
                          { notes: (value as string | null) || null },
                        )
                      }
                    />
                  </td>
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

      <ShipmentBatchImportModal
        open={importOpen}
        batchId={batch.id}
        zones={zones}
        couriers={couriers}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setSuccess("הקובץ יובא בהצלחה");
          void refresh();
        }}
      />
    </div>
  );
}
