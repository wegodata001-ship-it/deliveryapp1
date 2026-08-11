"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Users,
  MapPin,
  RefreshCw,
  Package,
  Edit2,
  Plus,
  Search,
  Trash2,
  FileText,
  FileSpreadsheet,
  RotateCcw,
  Upload,
  MapPinned,
  CircleDollarSign,
} from "lucide-react";
import type {
  ShipmentBatchDto,
  ShipmentCourierDto,
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentStatus,
  UpdateShipmentRecordInput,
  UpdateShipmentBatchInput,
  ShipmentImportMatchSummary,
  CreateShipmentRecordInput,
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
  createShipmentRecordAction,
  createShipmentRecordsBulkAction,
} from "@/app/admin/shipments/actions";
import { assignZoneWithLocationPromptAction } from "@/app/admin/shipments/location-actions";
import { sameShipmentLocality } from "@/lib/shipment-zone-locality";
import { ShipmentPaymentModal } from "@/components/admin/shipments/ShipmentPaymentModal";
import { ShipmentBatchImportModal } from "@/components/admin/shipments/ShipmentBatchImportModal";
import { ShipmentDeliveryFeeImportModal } from "@/components/admin/shipments/ShipmentDeliveryFeeImportModal";
import { FixLocationModal } from "@/components/admin/shipments/FixLocationModal";
import { ShipmentRecordsEditableTable } from "@/components/admin/shipments/ShipmentRecordsEditableTable";
import { QuickAddPackagePanel } from "@/components/admin/shipments/QuickAddPackagePanel";
import { CourierPdfModal } from "@/components/admin/shipments/CourierPdfModal";
import { CustomShipmentPdfModal } from "@/components/admin/shipments/CustomShipmentPdfModal";
import { CourierDebtCloseModal } from "@/components/admin/shipments/CourierDebtCloseModal";
import type { ShipmentControlRecord } from "@/app/admin/shipments/control/types";
import { exportShipmentReportExcel } from "@/lib/shipment-report-export";
import { ShipmentMultiSelectFilter } from "@/components/admin/shipments/ShipmentMultiSelectFilter";
import {
  filterRecordsByPaymentMethod,
  recordHasPaymentOnDate,
  sumCollectedByPaymentMethod,
  sumRecordsCollectedByPaymentMethod,
  type ShipmentPaymentMethodOption,
} from "@/lib/shipment-payment-method-filter";

/** ערך מיוחד במסנן אזור — משלוחים ללא אזור חלוקה */
const NO_ZONE_VALUE = "__no_zone__";

type Props = {
  batch: ShipmentBatchDto;
  initialRecords: ShipmentRecordDto[];
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
  paymentMethods?: ShipmentPaymentMethodOption[];
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

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function batchShipmentLabel(batch: ShipmentBatchDto): string {
  return batch.containerNumber || batch.sourceShipmentNumber || batch.batchNumber;
}

function toControlRecord(batch: ShipmentBatchDto, r: ShipmentRecordDto): ShipmentControlRecord {
  return {
    id: r.id,
    batchId: r.batchId,
    batchNumber: r.batchNumber,
    containerNumber: batch.containerNumber,
    rowIndex: r.rowIndex,
    customerCode: r.customerCode,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerPhone2: r.customerPhone2,
    address: r.address,
    city: r.city,
    updatedDeliveryLocation: r.updatedDeliveryLocation,
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
    expenses: [],
    expensesTotalIls: 0,
    expensesCount: 0,
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
  paymentDate: string;
  zoneIds: string[];
  unmatchedOnly: boolean;
  paymentMethods: string[];
};

const EMPTY_ROW_FILTERS: RowFilters = {
  search: "",
  arrivalDate: "",
  paymentDate: "",
  zoneIds: [],
  unmatchedOnly: false,
  paymentMethods: [],
};

function recordArrivalYmd(
  record: ShipmentRecordDto,
  batchArrivalYmd: string,
): string | null {
  const fromRecord = record.arrivalDate?.slice(0, 10);
  if (fromRecord && /^\d{4}-\d{2}-\d{2}$/.test(fromRecord)) return fromRecord;
  if (batchArrivalYmd && /^\d{4}-\d{2}-\d{2}$/.test(batchArrivalYmd)) return batchArrivalYmd;
  return null;
}

export function ShipmentBatchClient({
  batch: initialBatch,
  initialRecords,
  initialZones,
  initialCouriers,
  paymentMethods = [],
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
  const [feePricingOpen, setFeePricingOpen] = useState(false);
  const [courierPdfOpen, setCourierPdfOpen] = useState(false);
  const [customPdfOpen, setCustomPdfOpen] = useState(false);
  const [debtCloseOpen, setDebtCloseOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [fixLocationRecord, setFixLocationRecord] = useState<ShipmentRecordDto | null>(null);
  const [importSummary, setImportSummary] = useState<ShipmentImportMatchSummary | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [bulkAddCount, setBulkAddCount] = useState("5");
  const [bulkAddBusy, setBulkAddBusy] = useState(false);

  // Filters
  const [filters, setFilters] = useState<RowFilters>(EMPTY_ROW_FILTERS);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    try {
      const key = `shp-import-summary-${initialBatch.id}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      sessionStorage.removeItem(key);
      setImportSummary(JSON.parse(raw) as ShipmentImportMatchSummary);
    } catch {
      /* ignore */
    }
  }, [initialBatch.id]);

  // Bulk assign
  const [bulkZoneId, setBulkZoneId] = useState("");
  const [bulkCourierId, setBulkCourierId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<ShipmentStatus | "">("");

  const shipmentLabel = batchShipmentLabel(batch);
  const batchArrivalYmd = batch.arrivalDate?.slice(0, 10) ?? "";

  const zoneOptions = useMemo(
    () => [
      { value: NO_ZONE_VALUE, label: "ללא אזור" },
      ...zones
        .filter((z) => z.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"))
        .map((z) => ({ value: z.id, label: z.name })),
    ],
    [zones],
  );

  const paymentMethodOptions = useMemo(
    () => paymentMethods.map((m) => ({ value: m.id, label: m.label })),
    [paymentMethods],
  );

  const filteredRecords = useMemo(() => {
    const q = filters.search.trim().toLocaleLowerCase();
    const zoneSet = new Set(filters.zoneIds);
    const wantNoZone = zoneSet.has(NO_ZONE_VALUE);
    const selectedZoneIds = filters.zoneIds.filter((id) => id !== NO_ZONE_VALUE);
    const arrival = filters.arrivalDate.trim();
    const payDay = filters.paymentDate.trim();

    let base = records.filter((r) => {
      if (filters.unmatchedOnly && r.locationMatchStatus !== "UNMATCHED") return false;
      if (zoneSet.size > 0) {
        const matchZone = Boolean(r.zoneId && selectedZoneIds.includes(r.zoneId));
        const matchNone = wantNoZone && !r.zoneId;
        if (!matchZone && !matchNone) return false;
      }
      if (arrival) {
        const ymd = recordArrivalYmd(r, batchArrivalYmd);
        if (ymd !== arrival) return false;
      }
      if (payDay && !recordHasPaymentOnDate(r, payDay, filters.paymentMethods)) return false;
      if (q) {
        const hay = [
          shipmentLabel,
          batch.batchNumber,
          batch.sourceShipmentNumber,
          batch.containerNumber,
          r.customerCode,
          r.customerName,
          r.customerPhone,
          r.customerPhone2,
          r.address,
          r.city,
          r.updatedDeliveryLocation,
          r.originalDeliveryLocation,
          r.zoneName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    base = filterRecordsByPaymentMethod(base, filters.paymentMethods);
    return base;
  }, [
    records,
    filters,
    batchArrivalYmd,
    shipmentLabel,
    batch.batchNumber,
    batch.sourceShipmentNumber,
    batch.containerNumber,
  ]);

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
    const allFilteredSelected =
      filteredRecords.length > 0 && filteredRecords.every((r) => selected.has(r.id));
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      // בחר הכול = כל תוצאות הסינון הפעילות (לא רק עמוד נוכחי)
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
    const courierName = couriers.find((c) => c.id === bulkCourierId)?.name ?? "—";
    const count = selected.size;
    if (!confirm(`האם לשייך את השליח ${courierName} ל-${count} משלוחים?`)) return;
    setLoading(true);
    const res = await assignCourierAction({
      recordIds: Array.from(selected),
      courierId: bulkCourierId,
    });
    setLoading(false);
    if (res.ok) {
      setSuccess(`שויך שליח ${courierName} ל-${count} משלוחים`);
      setSelected(new Set());
      setBulkCourierId("");
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

  async function handleExportExcel() {
    const source =
      selected.size > 0
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
      await exportShipmentReportExcel({
        kind: "all",
        records: mapped,
        filters: {
          dateFrom: "",
          dateTo: "",
          containerNumber: "",
          zoneId: "",
          courierName: "",
          status: "",
          paymentScope: "all",
        },
        meta: {
          companyName: "Wego",
          generatedBy: "מערכת משלוחים",
          generatedAt: new Date(),
        },
      });
      setSuccess("קובץ Excel הורד");
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
    const record = records.find((r) => r.id === recordId);
    if (!record) return false;

    const applyLocal = (list: typeof records) =>
      list.map((r) =>
        r.id === recordId || sameShipmentLocality(r, record)
          ? { ...r, zoneId, zoneName: zone?.name ?? null }
          : r,
      );

    const snapshot = records;
    setRecords(applyLocal);

    const result = await assignZoneWithLocationPromptAction({
      recordIds: [recordId],
      zoneId,
      updateLocationPermanently: Boolean(zoneId),
    });
    if (!result.ok) {
      setRecords(snapshot);
      setError(result.error);
      clearMsg();
      return false;
    }

    if (result.updatedRecordIds?.length) {
      const idSet = new Set(result.updatedRecordIds);
      setRecords((prev) =>
        prev.map((r) =>
          idSet.has(r.id) ? { ...r, zoneId, zoneName: zone?.name ?? null } : r,
        ),
      );
    }
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
    const source = records.find((r) => r.id === recordId);
    const codeDigits = (source?.customerCode ?? "").replace(/\D/g, "").replace(/^0+/, "");

    if (patch.customerName !== undefined && codeDigits) {
      setRecords((previous) =>
        previous.map((record) => {
          const d = (record.customerCode ?? "").replace(/\D/g, "").replace(/^0+/, "");
          return record.id === recordId || (d && d === codeDigits)
            ? { ...record, ...optimisticPatch }
            : record;
        }),
      );
    } else {
      setRecords((previous) =>
        previous.map((record) =>
          record.id === recordId ? { ...record, ...optimisticPatch } : record,
        ),
      );
    }

    const result = await updateShipmentRecordAction({ recordId, patch });
    if (!result.ok) {
      await refresh();
      setError(result.error);
      clearMsg();
      return false;
    }
    if (result.updatedRecordIds?.length && patch.customerName !== undefined) {
      const idSet = new Set(result.updatedRecordIds);
      setRecords((previous) =>
        previous.map((record) =>
          idSet.has(record.id) ? { ...record, customerName: patch.customerName ?? null } : record,
        ),
      );
    }
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

  function appendRecordsToState(newRecords: ShipmentRecordDto[]) {
    setRecords((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of newRecords) byId.set(r.id, r);
      return [...byId.values()].sort((a, b) => a.rowIndex - b.rowIndex);
    });
    const addedBoxes = newRecords.reduce((sum, r) => sum + (r.boxes ?? 0), 0);
    setBatch((prev) => ({
      ...prev,
      recordCount: prev.recordCount + newRecords.length,
      boxesSum: prev.boxesSum + addedBoxes,
      unpaidCount: prev.unpaidCount + newRecords.length,
    }));
  }

  async function handleQuickAddPackage(
    input: Omit<CreateShipmentRecordInput, "batchId">,
    addAnother: boolean,
  ): Promise<boolean> {
    setQuickAddBusy(true);
    setError(null);
    const result = await createShipmentRecordAction({ ...input, batchId: batch.id });
    setQuickAddBusy(false);
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return false;
    }
    appendRecordsToState([result.record]);
    showSaved(`חבילה נוספה · ${records.length + 1} חבילות`);
    if (!addAnother) setQuickAddOpen(false);
    return true;
  }

  async function handleBulkAddPackages() {
    const count = Number(bulkAddCount.trim());
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      setError("כמות לא תקינה (1–50)");
      clearMsg();
      return;
    }
    setBulkAddBusy(true);
    setError(null);
    const result = await createShipmentRecordsBulkAction({ batchId: batch.id, count });
    setBulkAddBusy(false);
    if (!result.ok) {
      setError(result.error);
      clearMsg();
      return;
    }
    appendRecordsToState(result.records);
    showSaved(`${result.records.length} חבילות נוספו · ${records.length + result.records.length} סה״כ`);
  }

  function handlePaymentSaved(updated: ShipmentRecordDto) {
    setRecords((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    setPaymentRecord(updated);
  }

  const allSelected =
    filteredRecords.length > 0 && filteredRecords.every((r) => selected.has(r.id));

  const paymentMethodFilter = filters.paymentMethods;
  const totalFee = filteredRecords.reduce(
    (s, r) => s + (r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0),
    0,
  );
  const totalPaid = sumRecordsCollectedByPaymentMethod(filteredRecords, paymentMethodFilter);
  const paidCount = filteredRecords.filter((r) => {
    const collected = sumCollectedByPaymentMethod(r.payments, paymentMethodFilter);
    return collected > 0.005;
  }).length;

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
        <div className="shp-header-actions" dir="ltr">
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={() => router.push("/admin/shipments/locations")}
            title="ניהול אזורי חלוקה והתאמות יישובים"
          >
            <MapPinned size={14} />
            ניהול אזורי חלוקה
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={() => setEditOpen(true)}
          >
            <Edit2 size={14} />
            עריכת פרטי משלוח
          </button>
        </div>
      </div>

      {/* Stats — לפי מסננים פעילים (כולל צורת תשלום) */}
      <div className="shp-stats">
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{records.length}</div>
          <div className="shp-stat-card__label">חבילות / לקוחות</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{paidCount}</div>
          <div className="shp-stat-card__label">
            {paymentMethodFilter.length ? "עם גבייה באמצעי" : "שולמו"}
          </div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{filteredRecords.length - paidCount}</div>
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

      {/* שורת פעולות — מעל הטבלה, בנפרד מהמסננים */}
      <div className="shp-actions-toolbar" dir="rtl">
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
          onClick={() => setImportOpen(true)}
        >
          <Upload size={14} />
          ייבוא Excel
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary shp-btn--sm"
          onClick={() => setFeePricingOpen(true)}
          title="ייבוא תמחור דמי משלוח לפי קוד לקוח וסך קרטונים"
        >
          <CircleDollarSign size={14} />
          הוסף תמחור דמי משלוח
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary shp-btn--sm"
          disabled={exportBusy || filteredRecords.length === 0}
          onClick={() => void handleExportExcel()}
        >
          <FileSpreadsheet size={14} />
          ייצוא Excel
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--sm shp-btn--courier-pdf"
          disabled={filteredRecords.length === 0}
          onClick={() => setCourierPdfOpen(true)}
          title="הפקת PDF לשליח"
        >
          <FileText size={14} />
          PDF לשליח
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--primary shp-btn--sm"
          disabled={filteredRecords.length === 0}
          onClick={() => setCustomPdfOpen(true)}
          title="PDF מותאם אישית לפי עמודות לבחירה"
        >
          <FileText size={14} />
          PDF מותאם
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary shp-btn--sm"
          disabled={filteredRecords.length === 0}
          onClick={() => setDebtCloseOpen(true)}
          title="סגירת חוב לכל משלוחי השליח באזורים שנבחרו"
        >
          <CircleDollarSign size={14} />
          סגירת חוב לפי שליח
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary shp-btn--sm"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "shp-spinner--dark" : ""} />
          רענון
        </button>
        <span className="shp-filter-toolbar__count">
          {filteredRecords.length}/{records.length}
        </span>
      </div>

      {/* שורת מסננים בלבד */}
      <div className="shp-filter-toolbar shp-filter-toolbar--single" dir="rtl">
        <div className="shp-filter-toolbar__row shp-filter-toolbar__row--wrap">
          <label className="shp-filter-toolbar__date-stack">
            <span>תאריך הגעה</span>
            <input
              type="date"
              value={filters.arrivalDate}
              onChange={(e) => patchFilter("arrivalDate", e.target.value)}
            />
          </label>
          <label className="shp-filter-toolbar__date-stack">
            <span>תאריך תשלום</span>
            <input
              type="date"
              value={filters.paymentDate}
              onChange={(e) => patchFilter("paymentDate", e.target.value)}
              title="התאריך שבו בוצע התשלום בפועל"
            />
          </label>
          <ShipmentMultiSelectFilter
            label="אזור חלוקה"
            options={zoneOptions}
            values={filters.zoneIds}
            onChange={(zoneIds) => patchFilter("zoneIds", zoneIds)}
          />
          <label className="shp-filter-toolbar__check">
            <input
              type="checkbox"
              checked={filters.unmatchedOnly}
              onChange={(e) => patchFilter("unmatchedOnly", e.target.checked)}
            />
            יישובים לא מזוהים
          </label>
          <ShipmentMultiSelectFilter
            label="צורת תשלום"
            options={paymentMethodOptions}
            values={filters.paymentMethods}
            onChange={(paymentMethods) => patchFilter("paymentMethods", paymentMethods)}
          />
          <div className="shp-filter-toolbar__search">
            <Search size={14} />
            <input
              value={filters.search}
              onChange={(e) => patchFilter("search", e.target.value)}
              placeholder="מספר משלוח / קוד לקוח / שם / טלפון / כתובת"
              aria-label="חיפוש כללי"
            />
          </div>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={() => setFilters(EMPTY_ROW_FILTERS)}
            title="איפוס מסננים"
          >
            <RotateCcw size={13} />
            איפוס
          </button>
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

      {importSummary && (
        <div className="shp-alert" style={{ background: "#fff7ed", color: "#9a3412" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>סיכום ייבוא</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
            <span>סה״כ שורות: {importSummary.totalRows}</span>
            <span>נקלטו: {importSummary.importedRows}</span>
            <span>יישובים שזוהו: {importSummary.matchedLocations}</span>
            <span>לא זוהו: {importSummary.unmatchedLocations}</span>
            <span>אזורים אוטומטיים: {importSummary.autoFilledZones}</span>
            <span>נכשלו: {importSummary.failedRows}</span>
          </div>
          {importSummary.unmatchedLocations > 0 && (
            <button
              type="button"
              className="shp-btn shp-btn--sm"
              style={{ marginTop: 8 }}
              onClick={() =>
                setFilters((prev) => ({ ...prev, unmatchedOnly: true, missingZoneOnly: false }))
              }
            >
              הצג יישובים שלא זוהו
            </button>
          )}
        </div>
      )}

      <div
        className="shp-packages-header"
        dir="rtl"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
            חבילות במשלוח {batch.batchNumber}
          </h2>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
            {records.length} חבילות
            {filteredRecords.length !== records.length
              ? ` · ${filteredRecords.length} מוצגות לאחר סינון`
              : null}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="shp-btn shp-btn--primary shp-btn--sm"
            onClick={() => {
              setQuickAddOpen(true);
              setError(null);
            }}
          >
            <Plus size={14} />
            הוספת חבילה
          </button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <input
              type="number"
              min={1}
              max={50}
              value={bulkAddCount}
              onChange={(e) => setBulkAddCount(e.target.value)}
              style={{ width: 56, padding: "6px 8px" }}
              aria-label="כמות חבילות להוספה"
            />
            <button
              type="button"
              className="shp-btn shp-btn--secondary shp-btn--sm"
              disabled={bulkAddBusy}
              onClick={() => void handleBulkAddPackages()}
            >
              {bulkAddBusy ? "מוסיף…" : "+ הוסף מספר חבילות"}
            </button>
          </div>
        </div>
      </div>

      {quickAddOpen ? (
        <QuickAddPackagePanel
          batchLabel={batch.batchNumber}
          busy={quickAddBusy}
          onCancel={() => setQuickAddOpen(false)}
          onSave={handleQuickAddPackage}
        />
      ) : null}

      <ShipmentRecordsEditableTable
        records={filteredRecords}
        selected={selected}
        zones={zones}
        couriers={couriers}
        showBatchContext
        paymentMethodFilter={paymentMethodFilter}
        onToggle={toggleSelect}
        onToggleAll={toggleAll}
        allSelected={allSelected}
        onSavePatch={saveRecordPatch}
        onZoneSelect={handleRowZone}
        onCourierSelect={handleRowCourier}
        onStatusChange={handleRowStatus}
        onCreateZone={quickAddZone}
        onCreateCourier={quickAddCourier}
        onCollect={setPaymentRecord}
        onFixLocation={setFixLocationRecord}
      />

      {/* Payment modal */}
      {paymentRecord && (
        <ShipmentPaymentModal
          record={paymentRecord}
          onClose={() => setPaymentRecord(null)}
          onSaved={handlePaymentSaved}
        />
      )}

      {fixLocationRecord && (
        <FixLocationModal
          record={fixLocationRecord}
          zones={zones}
          onClose={() => setFixLocationRecord(null)}
          onSaved={async () => {
            await refresh();
            setSuccess("היישוב עודכן");
            clearMsg();
          }}
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
                    if (v === "__ADD_NEW__") return undefined;
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
                  <option value="__ADD_NEW__">➕ הוסף שליח חדש</option>
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

      {feePricingOpen ? (
        <ShipmentDeliveryFeeImportModal
          batchId={batch.id}
          shipmentLabel={batchShipmentLabel(batch)}
          onClose={() => setFeePricingOpen(false)}
          onDone={() => {
            setSuccess("תמחור דמי משלוח עודכן בהצלחה");
            void refresh();
          }}
        />
      ) : null}

      {courierPdfOpen && (
        <CourierPdfModal
          filteredRecords={filteredRecords}
          selectedIds={selected}
          couriers={couriers}
          zones={zones}
          batchId={batch.id}
          onSelectAllFiltered={toggleAll}
          onClose={() => setCourierPdfOpen(false)}
          onSuccess={(message) => {
            setSuccess(message);
            clearMsg();
          }}
        />
      )}

      {customPdfOpen && (
        <CustomShipmentPdfModal
          filteredRecords={filteredRecords}
          selectedIds={selected}
          paymentMethodFilter={paymentMethodFilter}
          onClose={() => setCustomPdfOpen(false)}
          onSuccess={(message) => {
            setSuccess(message);
            clearMsg();
          }}
        />
      )}

      {debtCloseOpen && (
        <CourierDebtCloseModal
          couriers={couriers}
          records={records}
          batchIds={[batch.id]}
          onClose={() => setDebtCloseOpen(false)}
          onDone={(message) => {
            setSuccess(message);
            clearMsg();
            void refresh();
          }}
        />
      )}
    </div>
  );
}
