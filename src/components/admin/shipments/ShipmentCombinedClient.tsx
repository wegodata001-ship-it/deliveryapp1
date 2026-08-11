"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  MapPinned,
  FileText,
  CircleDollarSign,
} from "lucide-react";
import type {
  ShipmentBatchDto,
  ShipmentCourierDto,
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentStatus,
  UpdateShipmentRecordInput,
} from "@/app/admin/shipments/types";
import {
  assignCourierAction,
  assignZoneAction,
  createCourierAction,
  createZoneAction,
  deleteShipmentRecordAction,
  listShipmentRecordsByBatchIdsAction,
  updateShipmentRecordAction,
  updateShipmentStatusAction,
} from "@/app/admin/shipments/actions";
import { assignZoneWithLocationPromptAction } from "@/app/admin/shipments/location-actions";
import { isInvalidCustomerName } from "@/lib/shipment-customer-name-quality";
import { sameShipmentLocality } from "@/lib/shipment-zone-locality";
import { ShipmentPaymentModal } from "@/components/admin/shipments/ShipmentPaymentModal";
import { FixLocationModal } from "@/components/admin/shipments/FixLocationModal";
import { ShipmentRecordsEditableTable } from "@/components/admin/shipments/ShipmentRecordsEditableTable";
import { CourierPdfModal } from "@/components/admin/shipments/CourierPdfModal";
import { CustomShipmentPdfModal } from "@/components/admin/shipments/CustomShipmentPdfModal";
import { CourierDebtCloseModal } from "@/components/admin/shipments/CourierDebtCloseModal";
import { ShipmentMultiSelectFilter } from "@/components/admin/shipments/ShipmentMultiSelectFilter";
import {
  filterRecordsByPaymentMethod,
  recordHasPaymentOnDate,
  sumRecordsCollectedByPaymentMethod,
  type ShipmentPaymentMethodOption,
} from "@/lib/shipment-payment-method-filter";

type Props = {
  batchIds: string[];
  initialRecords: ShipmentRecordDto[];
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
  initialBatches: ShipmentBatchDto[];
  paymentMethods?: ShipmentPaymentMethodOption[];
};

/** ערך מיוחד במסנן אזור — משלוחים ללא אזור חלוקה */
const NO_ZONE_VALUE = "__no_zone__";

type RowFilters = {
  search: string;
  zoneIds: string[];
  arrivalDate: string;
  paymentDate: string;
  paymentMethods: string[];
  unmatchedOnly: boolean;
  invalidNameOnly: boolean;
};

const EMPTY_FILTERS: RowFilters = {
  search: "",
  zoneIds: [],
  arrivalDate: "",
  paymentDate: "",
  paymentMethods: [],
  unmatchedOnly: false,
  invalidNameOnly: false,
};

function arrivalYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function customerCodeKey(code: string | null | undefined): string {
  const digits = (code ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || (code ?? "").trim().toLowerCase();
}

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

export function ShipmentCombinedClient({
  batchIds,
  initialRecords,
  initialZones,
  initialCouriers,
  initialBatches,
  paymentMethods = [],
}: Props) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zones, setZones] = useState(initialZones);
  const [couriers, setCouriers] = useState(initialCouriers);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<RowFilters>(EMPTY_FILTERS);
  const [paymentRecord, setPaymentRecord] = useState<ShipmentRecordDto | null>(null);
  const [fixLocationRecord, setFixLocationRecord] = useState<ShipmentRecordDto | null>(null);
  const [courierPdfOpen, setCourierPdfOpen] = useState(false);
  const [customPdfOpen, setCustomPdfOpen] = useState(false);
  const [debtCloseOpen, setDebtCloseOpen] = useState(false);
  const [bulkZoneId, setBulkZoneId] = useState("");
  const [bulkCourierId, setBulkCourierId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<ShipmentStatus | "">("");

  const batchNumbers = useMemo(
    () => [...new Set(initialBatches.map((b) => b.batchNumber))],
    [initialBatches],
  );

  const invalidNameCount = useMemo(
    () => records.filter((r) => isInvalidCustomerName(r.customerName)).length,
    [records],
  );

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
    const zoneSet = new Set(filters.zoneIds);
    const wantNoZone = zoneSet.has(NO_ZONE_VALUE);
    const selectedZoneIds = filters.zoneIds.filter((id) => id !== NO_ZONE_VALUE);
    const arrival = filters.arrivalDate.trim();
    const payDay = filters.paymentDate.trim();
    const q = filters.search.trim().toLocaleLowerCase();

    let base = records.filter((r) => {
      if (filters.invalidNameOnly && !isInvalidCustomerName(r.customerName)) return false;
      if (filters.unmatchedOnly && r.locationMatchStatus !== "UNMATCHED") return false;
      if (zoneSet.size > 0) {
        const matchZone = Boolean(r.zoneId && selectedZoneIds.includes(r.zoneId));
        const matchNone = wantNoZone && !r.zoneId;
        if (!matchZone && !matchNone) return false;
      }
      if (arrival) {
        const ymd = arrivalYmd(r.arrivalDate);
        if (ymd !== arrival) return false;
      }
      if (payDay && !recordHasPaymentOnDate(r, payDay, filters.paymentMethods)) return false;
      if (q) {
        const hay = [
          r.batchNumber,
          r.sourceShipmentNumber,
          r.containerNumber,
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
  }, [records, filters]);

  const filteredPaidTotal = useMemo(
    () => sumRecordsCollectedByPaymentMethod(filteredRecords, filters.paymentMethods),
    [filteredRecords, filters.paymentMethods],
  );

  const filteredFeeTotal = useMemo(
    () =>
      filteredRecords.reduce(
        (s, r) => s + (r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0),
        0,
      ),
    [filteredRecords],
  );

  const allSelected =
    filteredRecords.length > 0 && filteredRecords.every((r) => selected.has(r.id));

  const paymentMethodFilter = filters.paymentMethods;

  const clearMsg = useCallback(() => {
    window.setTimeout(() => setMsg(null), 2500);
  }, []);

  async function refresh() {
    setBusy(true);
    const res = await listShipmentRecordsByBatchIdsAction(batchIds);
    setBusy(false);
    if (res.ok) setRecords(res.records);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filteredRecords.map((r) => r.id)));
  }

  async function saveRecordPatch(
    recordId: string,
    patch: UpdateShipmentRecordInput["patch"],
    optimisticPatch: Partial<ShipmentRecordDto>,
  ): Promise<boolean> {
    const source = records.find((r) => r.id === recordId);
    const codeKey =
      patch.customerName !== undefined ? customerCodeKey(source?.customerCode) : "";

    // Optimistic — כולל משלוחים עם אותו קוד לקוח כשמתקנים שם
    if (patch.customerName !== undefined && codeKey) {
      setRecords((previous) =>
        previous.map((record) =>
          record.id === recordId || customerCodeKey(record.customerCode) === codeKey
            ? { ...record, ...optimisticPatch }
            : record,
        ),
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
      // רענון מלא בכישלון — פשוט יותר משחזור מדויק
      await refresh();
      setMsg(result.error);
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
    setMsg("✓ נשמר");
    clearMsg();
    return true;
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

    // Optimistic — כל שורות אותו יישוב בטבלה
    const snapshot = records;
    setRecords(applyLocal);

    const result = await assignZoneWithLocationPromptAction({
      recordIds: [recordId],
      zoneId,
      updateLocationPermanently: Boolean(zoneId),
    });
    if (!result.ok) {
      setRecords(snapshot);
      setMsg(result.error);
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
    setMsg("✓ אזור חלוקה נשמר (כולל לימוד ליישוב)");
    clearMsg();
    return true;
  }

  async function handleRowCourier(
    recordId: string,
    courier: { id: string; name: string } | null,
  ): Promise<boolean> {
    const courierId = courier?.id ?? null;
    const result = await assignCourierAction({ recordIds: [recordId], courierId });
    if (!result.ok) {
      setMsg(result.error);
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
    setMsg("✓ נשמר");
    clearMsg();
    return true;
  }

  async function handleRowStatus(recordId: string, status: ShipmentStatus) {
    const result = await updateShipmentStatusAction({ recordIds: [recordId], status });
    if (!result.ok) {
      setMsg(result.error);
      clearMsg();
      return;
    }
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, status } : r)));
    setMsg("✓ נשמר");
    clearMsg();
  }

  async function quickAddZone(name: string) {
    const result = await createZoneAction(name);
    if (!result.ok) {
      setMsg(result.error);
      clearMsg();
      return null;
    }
    setZones((prev) => [...prev, result.zone]);
    return result.zone;
  }

  async function quickAddCourier(name: string) {
    const result = await createCourierAction(name);
    if (!result.ok) {
      setMsg(result.error);
      clearMsg();
      return null;
    }
    setCouriers((prev) => [...prev, result.courier]);
    return result.courier;
  }

  async function bulkZone() {
    if (!bulkZoneId || selected.size === 0) return;
    setBusy(true);
    const res = await assignZoneAction({
      recordIds: [...selected],
      zoneId: bulkZoneId,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`עודכן אזור ל-${selected.size} רשומות`);
      setSelected(new Set());
      await refresh();
    } else setMsg(res.error);
    clearMsg();
  }

  async function bulkCourier() {
    if (!bulkCourierId || selected.size === 0) return;
    const courierName = couriers.find((c) => c.id === bulkCourierId)?.name ?? "—";
    const count = selected.size;
    if (!confirm(`האם לשייך את השליח ${courierName} ל-${count} משלוחים?`)) return;
    setBusy(true);
    const res = await assignCourierAction({
      recordIds: [...selected],
      courierId: bulkCourierId,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`שויך שליח ${courierName} ל-${count} רשומות`);
      setSelected(new Set());
      setBulkCourierId("");
      await refresh();
    } else setMsg(res.error);
    clearMsg();
  }

  async function runBulkStatus() {
    if (!bulkStatus || selected.size === 0) return;
    setBusy(true);
    const res = await updateShipmentStatusAction({
      recordIds: [...selected],
      status: bulkStatus,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`עודכן סטטוס ל-${selected.size} רשומות`);
      setSelected(new Set());
      await refresh();
    } else setMsg(res.error);
    clearMsg();
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`למחוק ${selected.size} משלוחים?`)) return;
    setBusy(true);
    for (const id of selected) {
      await deleteShipmentRecordAction(id);
    }
    setBusy(false);
    setSelected(new Set());
    await refresh();
  }

  return (
    <div className="shp-page shp-page--wide">
      <div className="shp-header">
        <button type="button" className="shp-btn shp-btn--ghost" onClick={() => router.push("/admin/shipments")}>
          <ArrowRight size={16} />
          חזרה
        </button>
        <Layers size={22} style={{ color: "#2563eb" }} />
        <div>
          <h1>טבלת משלוחים מאוחדת</h1>
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            {batchNumbers.length} משלוחים · {records.length} שורות
          </p>
        </div>
        <div className="shp-header-actions" dir="ltr">
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={() => router.push("/admin/shipments/locations")}
          >
            <MapPinned size={14} />
            ניהול יישובים
          </button>
        </div>
      </div>

      {msg && <div className="shp-alert">{msg}</div>}

      <div className="shp-kpi-row" dir="rtl">
        <div className="shp-kpi-chip">
          <span>שורות מסוננות:</span>
          <span className="shp-kpi-chip__value">
            {filteredRecords.length}/{records.length}
          </span>
        </div>
        <div className="shp-kpi-chip">
          <span>דמי משלוח:</span>
          <span className="shp-kpi-chip__value" dir="ltr">
            ₪
            {filteredFeeTotal.toLocaleString("he-IL", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="shp-kpi-chip">
          <span>
            נגבה
            {paymentMethodFilter.length ? " (לפי אמצעי)" : ""}:
          </span>
          <span className="shp-kpi-chip__value" dir="ltr">
            ₪
            {filteredPaidTotal.toLocaleString("he-IL", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <button
          type="button"
          className={[
            "shp-kpi-chip",
            invalidNameCount > 0 ? "shp-kpi-chip--warn" : "",
            filters.invalidNameOnly ? "shp-kpi-chip--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() =>
            setFilters((f) => ({ ...f, invalidNameOnly: !f.invalidNameOnly }))
          }
          title="לחץ להצגת משלוחים עם שם לקוח לא תקין בלבד"
        >
          <AlertTriangle size={15} aria-hidden />
          <span>לקוחות עם שם לא תקין:</span>
          <span className="shp-kpi-chip__value">{invalidNameCount}</span>
        </button>
      </div>

      <div className="shp-actions-toolbar" dir="rtl">
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
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={14} />
          רענון
        </button>
        <span className="shp-filter-toolbar__count">
          {filteredRecords.length}/{records.length}
        </span>
      </div>

      <div className="shp-filter-toolbar shp-filter-toolbar--combined" dir="rtl">
        <div className="shp-filter-toolbar__row shp-filter-toolbar__row--wrap">
          <label className="shp-filter-toolbar__date-stack">
            <span>תאריך הגעה</span>
            <input
              type="date"
              value={filters.arrivalDate}
              onChange={(e) => setFilters((f) => ({ ...f, arrivalDate: e.target.value }))}
            />
          </label>
          <label className="shp-filter-toolbar__date-stack">
            <span>תאריך תשלום</span>
            <input
              type="date"
              value={filters.paymentDate}
              onChange={(e) => setFilters((f) => ({ ...f, paymentDate: e.target.value }))}
              title="התאריך שבו בוצע התשלום בפועל"
            />
          </label>
          <ShipmentMultiSelectFilter
            label="אזור חלוקה"
            options={zoneOptions}
            values={filters.zoneIds}
            onChange={(zoneIds) => setFilters((f) => ({ ...f, zoneIds }))}
          />
          <label className="shp-filter-toolbar__check">
            <input
              type="checkbox"
              checked={filters.unmatchedOnly}
              onChange={(e) =>
                setFilters((f) => ({ ...f, unmatchedOnly: e.target.checked }))
              }
            />
            יישובים לא מזוהים
          </label>
          <ShipmentMultiSelectFilter
            label="צורת תשלום"
            options={paymentMethodOptions}
            values={filters.paymentMethods}
            onChange={(paymentMethods) => setFilters((f) => ({ ...f, paymentMethods }))}
          />
          <div className="shp-filter-toolbar__search">
            <Search size={14} />
            <input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="מספר משלוח / קוד לקוח / שם / טלפון / כתובת"
              aria-label="חיפוש כללי"
            />
          </div>
          <button
            type="button"
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            <RotateCcw size={13} />
            נקה מסננים
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="shp-bulk-bar">
          <span>נבחרו {selected.size}</span>
          <select value={bulkZoneId} onChange={(e) => setBulkZoneId(e.target.value)}>
            <option value="">אזור חלוקה...</option>
            {zones.filter((z) => z.isActive).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <button type="button" className="shp-btn shp-btn--sm" onClick={() => void bulkZone()}>
            שייך אזור
          </button>
          <select value={bulkCourierId} onChange={(e) => setBulkCourierId(e.target.value)}>
            <option value="">שליח...</option>
            {couriers.filter((c) => c.isActive).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="shp-btn shp-btn--sm" onClick={() => void bulkCourier()}>
            שייך שליח
          </button>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as ShipmentStatus | "")}
          >
            <option value="">סטטוס...</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="button" className="shp-btn shp-btn--sm" onClick={() => void runBulkStatus()}>
            עדכן סטטוס
          </button>
          <button type="button" className="shp-btn shp-btn--sm shp-btn--danger" onClick={() => void bulkDelete()}>
            <Trash2 size={13} />
            מחק
          </button>
        </div>
      )}

      <ShipmentRecordsEditableTable
        records={filteredRecords}
        selected={selected}
        zones={zones}
        couriers={couriers}
        showBatchContext
        paymentMethodFilter={paymentMethodFilter}
        onToggle={toggle}
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

      {paymentRecord && (
        <ShipmentPaymentModal
          record={paymentRecord}
          onClose={() => setPaymentRecord(null)}
          onSaved={async (updated) => {
            setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setPaymentRecord(null);
          }}
        />
      )}

      {fixLocationRecord && (
        <FixLocationModal
          record={fixLocationRecord}
          zones={zones}
          onClose={() => setFixLocationRecord(null)}
          onSaved={async () => {
            await refresh();
            setMsg("היישוב עודכן");
            clearMsg();
          }}
        />
      )}

      {courierPdfOpen && (
        <CourierPdfModal
          filteredRecords={filteredRecords}
          selectedIds={selected}
          couriers={couriers}
          zones={zones}
          batchId={batchIds[0] ?? null}
          onSelectAllFiltered={toggleAll}
          onClose={() => setCourierPdfOpen(false)}
          onSuccess={(message) => {
            setMsg(message);
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
            setMsg(message);
            clearMsg();
          }}
        />
      )}

      {debtCloseOpen && (
        <CourierDebtCloseModal
          couriers={couriers}
          records={records}
          batchIds={batchIds}
          onClose={() => setDebtCloseOpen(false)}
          onDone={(message) => {
            setMsg(message);
            clearMsg();
            void refresh();
          }}
        />
      )}
    </div>
  );
}
