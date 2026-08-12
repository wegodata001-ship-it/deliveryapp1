"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CreateShipmentRecordInput,
  ShipmentCourierDto,
  ShipmentRecordDto,
  ShipmentStatus,
  ShipmentZoneDto,
} from "@/app/admin/shipments/types";
import { SHIPMENT_STATUS_LABELS } from "@/app/admin/shipments/types";
import { shipmentRecordToDuplicateBaseline } from "@/lib/shipment-record-duplicate";
import {
  getEffectiveDeliveryPlaceFromRecord,
  shipmentOriginalDeliveryPlace,
} from "@/lib/shipment-delivery-place";

export type QuickAddPackageForm = {
  customerCode: string;
  customerName: string;
  customerPhone: string;
  customerPhone2: string;
  address: string;
  deliveryPlace: string;
  zoneId: string;
  courierId: string;
  boxes: string;
  weight: string;
  cartonDetails: string;
  deliveryFeeAmount: string;
  orderAmount: string;
  notes: string;
  status: ShipmentStatus;
};

type SourceMeta = {
  recordId: string;
  originalDeliveryLocation: string | null;
  deliveryLocationId: string | null;
  locationMatchStatus: ShipmentRecordDto["locationMatchStatus"];
  initialDeliveryPlace: string | null;
  orderCurrency: ShipmentRecordDto["orderCurrency"];
};

const EMPTY_FORM: QuickAddPackageForm = {
  customerCode: "",
  customerName: "",
  customerPhone: "",
  customerPhone2: "",
  address: "",
  deliveryPlace: "",
  zoneId: "",
  courierId: "",
  boxes: "1",
  weight: "",
  cartonDetails: "",
  deliveryFeeAmount: "",
  orderAmount: "",
  notes: "",
  status: "NEW",
};

type Props = {
  batchLabel: string;
  sourceRecord: ShipmentRecordDto | null;
  zones: ShipmentZoneDto[];
  couriers: ShipmentCourierDto[];
  busy?: boolean;
  onCancel: () => void;
  onSave: (input: Omit<CreateShipmentRecordInput, "batchId">, addAnother: boolean) => Promise<boolean>;
};

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fmtPhone(p1: string | null, p2: string | null): string {
  return [p1?.trim(), p2?.trim()].filter(Boolean).join(" / ");
}

function shipmentDisplayLabel(record: ShipmentRecordDto | null, batchLabel: string): string {
  if (!record) return batchLabel;
  return record.containerNumber || record.sourceShipmentNumber || record.batchNumber || batchLabel;
}

function baselineToForm(
  baseline: ReturnType<typeof shipmentRecordToDuplicateBaseline>,
  source: ShipmentRecordDto,
): QuickAddPackageForm {
  return {
    customerCode: baseline.customerCode ?? "",
    customerName: baseline.customerName ?? "",
    customerPhone: baseline.customerPhone ?? "",
    customerPhone2: baseline.customerPhone2 ?? "",
    address: baseline.address ?? "",
    deliveryPlace: baseline.city ?? "",
    zoneId: baseline.zoneId ?? "",
    courierId: baseline.courierId ?? "",
    boxes: baseline.boxes != null ? String(baseline.boxes) : "1",
    weight: baseline.weight != null ? String(baseline.weight) : "",
    cartonDetails: baseline.cartonDetails ?? "",
    deliveryFeeAmount:
      baseline.deliveryFeeAmount != null ? String(baseline.deliveryFeeAmount) : "",
    orderAmount: baseline.orderAmount != null ? String(baseline.orderAmount) : "",
    notes: baseline.notes ?? "",
    status: baseline.status ?? source.status ?? "NEW",
  };
}

function formFromSource(record: ShipmentRecordDto): { form: QuickAddPackageForm; meta: SourceMeta } {
  const baseline = shipmentRecordToDuplicateBaseline(record);
  return {
    form: baselineToForm(baseline, record),
    meta: {
      recordId: record.id,
      originalDeliveryLocation: shipmentOriginalDeliveryPlace(record),
      deliveryLocationId: record.deliveryLocationId,
      locationMatchStatus: record.locationMatchStatus,
      initialDeliveryPlace: getEffectiveDeliveryPlaceFromRecord(record),
      orderCurrency: record.orderCurrency,
    },
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

export function QuickAddPackagePanel({
  batchLabel,
  sourceRecord,
  zones,
  couriers,
  busy = false,
  onCancel,
  onSave,
}: Props) {
  const [form, setForm] = useState<QuickAddPackageForm>(EMPTY_FORM);
  const [sourceMeta, setSourceMeta] = useState<SourceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sourceRecord) {
      const { form: nextForm, meta } = formFromSource(sourceRecord);
      setForm(nextForm);
      setSourceMeta(meta);
      setError(null);
      const t = window.setTimeout(() => boxesRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setForm(EMPTY_FORM);
    setSourceMeta(null);
    return undefined;
  }, [sourceRecord]);

  const activeCouriers = useMemo(() => couriers.filter((c) => c.isActive), [couriers]);
  const activeZones = useMemo(() => zones.filter((z) => z.isActive), [zones]);
  const locked = busy;
  const hasSource = Boolean(sourceRecord && sourceMeta);

  function patch<K extends keyof QuickAddPackageForm>(key: K, value: QuickAddPackageForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildInput(): Omit<CreateShipmentRecordInput, "batchId"> {
    const customerName = form.customerName.trim();
    if (!customerName) throw new Error("שם לקוח חובה");

    const boxes = parseOptionalNumber(form.boxes);
    if (form.boxes.trim() && boxes == null) throw new Error("מספר קרטונים לא תקין");
    const weight = parseOptionalNumber(form.weight);
    if (form.weight.trim() && weight == null) throw new Error("משקל לא תקין");
    const deliveryFeeAmount = parseOptionalNumber(form.deliveryFeeAmount);
    if (form.deliveryFeeAmount.trim() && deliveryFeeAmount == null) {
      throw new Error("דמי משלוח לא תקינים");
    }
    const orderAmount = parseOptionalNumber(form.orderAmount);
    if (form.orderAmount.trim() && orderAmount == null) {
      throw new Error("סכום הזמנה לא תקין");
    }

    const deliveryPlace = form.deliveryPlace.trim() || null;
    const placeUnchanged =
      sourceMeta?.initialDeliveryPlace?.trim() &&
      deliveryPlace === sourceMeta.initialDeliveryPlace.trim();

    return {
      sourceRecordId: sourceMeta?.recordId ?? null,
      customerCode: form.customerCode.trim() || null,
      customerName,
      customerPhone: form.customerPhone.trim() || null,
      customerPhone2: form.customerPhone2.trim() || null,
      address: form.address.trim() || null,
      city: deliveryPlace,
      originalDeliveryLocation: sourceMeta?.originalDeliveryLocation ?? deliveryPlace,
      deliveryLocationId: placeUnchanged ? sourceMeta?.deliveryLocationId ?? null : null,
      locationMatchStatus: placeUnchanged ? sourceMeta?.locationMatchStatus ?? null : null,
      zoneId: form.zoneId || null,
      courierId: form.courierId || null,
      boxes: boxes ?? 1,
      weight,
      cartonDetails: form.cartonDetails.trim() || null,
      deliveryFeeAmount,
      deliveryFeeCurrency: "ILS",
      orderAmount,
      orderCurrency: orderAmount != null ? sourceMeta?.orderCurrency ?? "USD" : null,
      notes: form.notes.trim() || null,
      status: form.status,
    };
  }

  async function handleSave(addAnother: boolean) {
    setError(null);
    if (!hasSource) {
      setError("יש לבחור שורת מקור לפני הוספת חבילה");
      return;
    }
    try {
      const input = buildInput();
      const ok = await onSave(input, addAnother);
      if (ok && addAnother && sourceRecord) {
        const { form: nextForm, meta } = formFromSource(sourceRecord);
        setForm(nextForm);
        setSourceMeta(meta);
        window.setTimeout(() => boxesRef.current?.focus(), 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const sourceSummary = sourceRecord
    ? [
        sourceRecord.customerName,
        sourceRecord.customerCode ? `קוד ${sourceRecord.customerCode}` : null,
        fmtPhone(sourceRecord.customerPhone, sourceRecord.customerPhone2),
        getEffectiveDeliveryPlaceFromRecord(sourceRecord),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="shp-quick-add" dir="rtl">
      <div className="shp-quick-add__head">
        <div>
          <strong className="shp-quick-add__title">הוספת חבילה חדשה</strong>
          {hasSource ? (
            <p className="shp-quick-add__source">
              מועתק משורת: {sourceSummary}
            </p>
          ) : (
            <p className="shp-quick-add__source shp-quick-add__source--warn">
              בחרו שורת מקור לפני מילוי הטופס
            </p>
          )}
        </div>
        <span className="shp-quick-add__batch">משלוח {shipmentDisplayLabel(sourceRecord, batchLabel)}</span>
      </div>

      <section className="shp-quick-add__section">
        <h4 className="shp-quick-add__section-title">פרטי המשלוח</h4>
        <div className="shp-quick-add__grid">
          <label className="shp-quick-add__field">
            <span>מספר משלוח</span>
            <input value={shipmentDisplayLabel(sourceRecord, batchLabel)} readOnly disabled />
          </label>
          <label className="shp-quick-add__field">
            <span>תאריך הגעה</span>
            <input value={formatDate(sourceRecord?.arrivalDate)} readOnly disabled dir="ltr" />
          </label>
          <label className="shp-quick-add__field">
            <span>קוד לקוח</span>
            <input
              dir="ltr"
              value={form.customerCode}
              disabled={locked}
              onChange={(e) => patch("customerCode", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>שם לקוח *</span>
            <input
              value={form.customerName}
              disabled={locked}
              onChange={(e) => patch("customerName", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>טלפון</span>
            <input
              dir="ltr"
              value={form.customerPhone}
              disabled={locked}
              onChange={(e) => patch("customerPhone", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>טלפון נוסף</span>
            <input
              dir="ltr"
              value={form.customerPhone2}
              disabled={locked}
              onChange={(e) => patch("customerPhone2", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field shp-quick-add__field--wide">
            <span>כתובת</span>
            <input
              value={form.address}
              disabled={locked}
              onChange={(e) => patch("address", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>מקום מסירה</span>
            <input
              value={form.deliveryPlace}
              disabled={locked}
              onChange={(e) => patch("deliveryPlace", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>אזור חלוקה</span>
            <select
              value={form.zoneId}
              disabled={locked}
              onChange={(e) => patch("zoneId", e.target.value)}
            >
              <option value="">ללא אזור</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="shp-quick-add__field">
            <span>שליח</span>
            <select
              value={form.courierId}
              disabled={locked}
              onChange={(e) => patch("courierId", e.target.value)}
            >
              <option value="">ללא שליח</option>
              {activeCouriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="shp-quick-add__field">
            <span>סטטוס</span>
            <select
              value={form.status}
              disabled={locked}
              onChange={(e) => patch("status", e.target.value as ShipmentStatus)}
            >
              {(Object.entries(SHIPMENT_STATUS_LABELS) as Array<[ShipmentStatus, string]>).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
      </section>

      <section className="shp-quick-add__section">
        <h4 className="shp-quick-add__section-title">פרטי החבילה החדשה</h4>
        <div className="shp-quick-add__grid">
          <label className="shp-quick-add__field">
            <span>מספר קרטונים</span>
            <input
              ref={boxesRef}
              inputMode="numeric"
              value={form.boxes}
              disabled={locked}
              onChange={(e) => patch("boxes", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>משקל (ק״ג)</span>
            <input
              inputMode="decimal"
              value={form.weight}
              disabled={locked}
              onChange={(e) => patch("weight", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>דמי משלוח ₪</span>
            <input
              inputMode="decimal"
              dir="ltr"
              value={form.deliveryFeeAmount}
              disabled={locked}
              onChange={(e) => patch("deliveryFeeAmount", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field shp-quick-add__field--wide">
            <span>פרטי קרטונים</span>
            <input
              value={form.cartonDetails}
              disabled={locked}
              onChange={(e) => patch("cartonDetails", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field">
            <span>סכום הזמנה $</span>
            <input
              inputMode="decimal"
              dir="ltr"
              value={form.orderAmount}
              disabled={locked}
              onChange={(e) => patch("orderAmount", e.target.value)}
            />
          </label>
          <label className="shp-quick-add__field shp-quick-add__field--wide">
            <span>הערות</span>
            <input
              value={form.notes}
              disabled={locked}
              onChange={(e) => patch("notes", e.target.value)}
            />
          </label>
        </div>
      </section>

      {error ? <div className="shp-alert shp-alert--error">{error}</div> : null}

      <div className="shp-quick-add__actions">
        <button
          type="button"
          className="shp-btn shp-btn--primary shp-btn--sm"
          disabled={locked || !hasSource}
          onClick={() => void handleSave(false)}
        >
          {locked ? "שומר…" : "שמור"}
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary shp-btn--sm"
          disabled={locked || !hasSource}
          onClick={() => void handleSave(true)}
        >
          שמור + הוסף עוד
        </button>
        <button type="button" className="shp-btn shp-btn--sm" disabled={locked} onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

export { EMPTY_FORM as QUICK_ADD_PACKAGE_EMPTY_FORM };
