"use client";

import { useState } from "react";
import type {
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentCourierDto,
  ShipmentStatus,
  UpdateShipmentRecordInput,
} from "@/app/admin/shipments/types";
import { SHIPMENT_STATUS_LABELS } from "@/app/admin/shipments/types";
import { AlertTriangle } from "lucide-react";
import { CustomerNameFixModal } from "@/components/admin/shipments/CustomerNameFixModal";
import { InlineValueCell } from "@/components/admin/shipments/InlineValueCell";
import { ZoneAssignModal } from "@/components/admin/shipments/ZoneAssignModal";
import { isInvalidCustomerName } from "@/lib/shipment-customer-name-quality";
import { sumCollectedByPaymentMethod } from "@/lib/shipment-payment-method-filter";

const STATUS_OPTIONS: { value: ShipmentStatus; label: string }[] = (
  Object.entries(SHIPMENT_STATUS_LABELS) as Array<[ShipmentStatus, string]>
).map(([value, label]) => ({ value, label }));

function fmtIls(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2 });
}

/**
 * יתרת לקוח מ־SSOT (מערכת הלקוחות).
 * תמיד מציגים מספר — כולל ₪0.00 כשאין יתרה / אין לקוח.
 * הערך מגיע מחישוב יתרות הלקוחות (לא מדמי משלוח).
 */
function fmtCustomerBalance(n: number | null | undefined) {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < -0.005 ? `-₪${abs}` : `₪${abs}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function shipmentLabel(r: ShipmentRecordDto): string {
  return r.containerNumber || r.sourceShipmentNumber || r.batchNumber;
}

function fmtPhone(p1: string | null, p2: string | null): string {
  const a = p1?.trim() || null;
  const b = p2?.trim() || null;
  if (a && b) return `${a} / ${b}`;
  return a || b || "—";
}

function collectLabel(
  r: ShipmentRecordDto,
  paymentMethodFilter?: string | string[] | null,
): string {
  const hasMethodFilter = Array.isArray(paymentMethodFilter)
    ? paymentMethodFilter.length > 0
    : Boolean(paymentMethodFilter);
  if (hasMethodFilter) {
    const amount = sumCollectedByPaymentMethod(r.payments, paymentMethodFilter);
    return fmtIls(amount);
  }
  const fee = r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0;
  if (fee <= 0) return "גבייה";
  if (r.paymentStatus === "PAID") return "נגבה";
  if (r.paymentStatus === "PARTIAL") return "נגבה חלקית";
  return "לא נגבה";
}

function Trunc({ text }: { text: string }) {
  return (
    <span className="shp-trunc" title={text}>
      {text}
    </span>
  );
}

export type ShipmentRecordsEditableTableProps = {
  records: ShipmentRecordDto[];
  selected: Set<string>;
  zones: ShipmentZoneDto[];
  couriers: ShipmentCourierDto[];
  showBatchContext?: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  onSavePatch: (
    recordId: string,
    patch: UpdateShipmentRecordInput["patch"],
    optimistic: Partial<ShipmentRecordDto>,
  ) => Promise<boolean>;
  onZoneSelect: (
    recordId: string,
    zone: { id: string; name: string } | null,
  ) => Promise<boolean>;
  onCourierSelect: (
    recordId: string,
    courier: { id: string; name: string } | null,
  ) => Promise<boolean>;
  onStatusChange: (recordId: string, status: ShipmentStatus) => void;
  onCreateZone: (name: string) => Promise<{ id: string; name: string; isActive: boolean } | null>;
  onCreateCourier: (name: string) => Promise<{ id: string; name: string; isActive: boolean } | null>;
  onCollect: (record: ShipmentRecordDto) => void;
  onFixLocation: (record: ShipmentRecordDto) => void;
  /** כשמוגדר — עמודת גובה תשלום מציגה רק את סכום האמצעי/ים שנבחרו */
  paymentMethodFilter?: string | string[] | null;
};

export function ShipmentRecordsEditableTable({
  records,
  selected,
  zones,
  couriers,
  onToggle,
  onToggleAll,
  allSelected,
  onSavePatch,
  onZoneSelect,
  onCourierSelect,
  onStatusChange,
  onCreateZone,
  onCreateCourier,
  onCollect,
  onFixLocation,
  paymentMethodFilter = null,
}: ShipmentRecordsEditableTableProps) {
  const [zoneAssignRecord, setZoneAssignRecord] = useState<ShipmentRecordDto | null>(null);
  const [zoneAssignBusy, setZoneAssignBusy] = useState(false);
  const [courierEditId, setCourierEditId] = useState<string | null>(null);
  const [nameFixRecord, setNameFixRecord] = useState<ShipmentRecordDto | null>(null);
  const [nameFixBusy, setNameFixBusy] = useState(false);

  // ─── Add-courier modal state ───
  const [showAddCourier, setShowAddCourier] = useState(false);
  const [addCourierForRecord, setAddCourierForRecord] = useState<string | null>(null);
  const [addCourierName, setAddCourierName] = useState("");
  const [addCourierPhone, setAddCourierPhone] = useState("");
  const [addCourierSaving, setAddCourierSaving] = useState(false);
  const [addCourierError, setAddCourierError] = useState<string | null>(null);

  const activeCouriers = (couriers ?? []).filter((c) => c.isActive);

  async function handleAddCourier() {
    const name = addCourierName.trim();
    if (!name) return;
    const existing = activeCouriers.find((c) => c.name === name);
    if (existing) {
      setAddCourierError("שליח בשם זה כבר קיים.");
      return;
    }
    setAddCourierSaving(true);
    setAddCourierError(null);
    const result = await onCreateCourier(name);
    setAddCourierSaving(false);
    if (!result) {
      setAddCourierError("שגיאה ביצירת השליח");
      return;
    }
    if (addCourierForRecord) {
      void onCourierSelect(addCourierForRecord, { id: result.id, name: result.name });
    }
    setShowAddCourier(false);
    setAddCourierForRecord(null);
    setAddCourierName("");
    setAddCourierPhone("");
    setCourierEditId(null);
  }

  function openAddCourierModal(recordId: string, prefill = "") {
    setAddCourierForRecord(recordId);
    setAddCourierName(prefill);
    setAddCourierPhone("");
    setAddCourierError(null);
    setShowAddCourier(true);
    setCourierEditId(null);
  }

  return (
    <div className="shp-daily-wrap">
      <table className="shp-table shp-table--daily shp-table--ship-rows">
        <thead>
          <tr>
            <th className="c-check">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="בחר הכל" />
            </th>
            <th className="c-arrive">תאריך הגעה</th>
            <th className="c-ship">מספר משלוח</th>
            <th className="c-code">קוד לקוח</th>
            <th className="c-name">שם לקוח</th>
            <th className="c-phone">טלפון</th>
            <th className="c-addr">כתובת</th>
            <th className="c-upd-loc">מקום מסירה מעודכן</th>
            <th className="c-zone">אזור חלוקה</th>
            <th className="c-courier">שליח</th>
            <th className="c-boxes">מספר קרטונים</th>
            <th className="c-fee">דמי משלוח</th>
            <th className="c-pay">גובה תשלום</th>
            <th className="c-bal">יתרת לקוח</th>
            <th className="c-status">סטטוס</th>
            <th className="c-act">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr>
              <td colSpan={16} className="shp-daily-empty">
                אין שורות להצגה
              </td>
            </tr>
          )}
          {records.map((r) => {
            const feeAmount = r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0;
            const zoneLabel = r.zoneName?.trim() || null;
            const nameInvalid = isInvalidCustomerName(r.customerName);
            const bal = r.customerBalanceUsd;
            const hasMethodFilter = Array.isArray(paymentMethodFilter)
              ? paymentMethodFilter.length > 0
              : Boolean(paymentMethodFilter);
            const methodPaid = hasMethodFilter
              ? sumCollectedByPaymentMethod(r.payments, paymentMethodFilter)
              : r.paidAmountIls;
            const payCls = hasMethodFilter
              ? methodPaid > 0.005
                ? "shp-pay-tag--paid"
                : "shp-pay-tag--unpaid"
              : r.paymentStatus === "PAID"
                ? "shp-pay-tag--paid"
                : r.paymentStatus === "PARTIAL"
                  ? "shp-pay-tag--partial"
                  : "shp-pay-tag--unpaid";
            return (
              <tr key={r.id} className={selected.has(r.id) ? "shp-row--selected" : undefined}>
                <td className="c-check">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => onToggle(r.id)}
                  />
                </td>
                <td className="c-arrive shp-daily-center">{formatDate(r.arrivalDate)}</td>
                <td className="c-ship">
                  <Trunc text={shipmentLabel(r)} />
                </td>
                <td className="c-code shp-daily-center" dir="ltr">
                  <Trunc text={r.customerCode || "—"} />
                </td>
                <td
                  className={["c-name", nameInvalid ? "shp-name-cell--invalid" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={nameInvalid ? "שם הלקוח דורש תיקון" : undefined}
                >
                  {nameInvalid ? (
                    <button
                      type="button"
                      className="shp-name-fix-btn"
                      title="שם הלקוח דורש תיקון"
                      onClick={() => setNameFixRecord(r)}
                    >
                      <AlertTriangle size={14} aria-hidden />
                      <span className="shp-trunc">
                        {r.customerName?.trim() || "שם ריק"}
                      </span>
                    </button>
                  ) : (
                    <InlineValueCell
                      value={r.customerName}
                      type="text"
                      placeholder="שם לקוח"
                      onSave={(value) =>
                        onSavePatch(
                          r.id,
                          { customerName: (value as string | null) || null },
                          { customerName: (value as string | null) || null },
                        )
                      }
                    />
                  )}
                </td>
                <td className="c-phone" dir="ltr">
                  <Trunc text={fmtPhone(r.customerPhone, r.customerPhone2)} />
                </td>
                <td className="c-addr">
                  <Trunc text={r.address || "—"} />
                </td>
                <td className="c-upd-loc">
                  <Trunc text={r.updatedDeliveryLocation || "—"} />
                </td>
                <td className="c-zone">
                  {zoneLabel ? (
                    <button
                      type="button"
                      className="shp-zone-tag shp-zone-tag--btn"
                      title="שנה אזור חלוקה"
                      onClick={() => setZoneAssignRecord(r)}
                    >
                      {zoneLabel}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shp-zone-tag shp-zone-tag--missing"
                      title="הגדר אזור חלוקה"
                      onClick={() => setZoneAssignRecord(r)}
                    >
                      לא הוגדר
                    </button>
                  )}
                </td>
                <td className="c-courier">
                  {courierEditId === r.id ? (
                    <select
                      className="shp-inline-select"
                      autoFocus
                      value={r.courierId ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__ADD_NEW__") {
                          openAddCourierModal(r.id);
                          return;
                        }
                        const id = val || null;
                        const c = activeCouriers.find((x) => x.id === id) ?? null;
                        setCourierEditId(null);
                        void onCourierSelect(r.id, c ? { id: c.id, name: c.name } : null);
                      }}
                      onBlur={() => setCourierEditId(null)}
                    >
                      <option value="">ללא שליח</option>
                      {activeCouriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                      <option value="__ADD_NEW__">➕ הוסף שליח חדש</option>
                    </select>
                  ) : r.courierName ? (
                    <button
                      type="button"
                      className="shp-courier-tag"
                      title="שנה שליח"
                      onClick={() => setCourierEditId(r.id)}
                    >
                      {r.courierName}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shp-courier-tag--missing"
                      title="הגדר שליח"
                      onClick={() => setCourierEditId(r.id)}
                    >
                      ללא שליח
                    </button>
                  )}
                </td>
                <td className="c-boxes shp-daily-center">
                  <InlineValueCell
                    value={r.boxes}
                    type="number"
                    min={0}
                    step={1}
                    placeholder="0"
                    onSave={(value) =>
                      onSavePatch(r.id, { boxes: value as number | null }, { boxes: value as number | null })
                    }
                  />
                </td>
                <td className="c-fee shp-daily-money shp-daily-center">
                  <InlineValueCell
                    value={r.deliveryFeeAmount ?? r.deliveryFeeIls}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="—"
                    format={(v) =>
                      v == null ? "—" : fmtIls(typeof v === "number" ? v : Number(v))
                    }
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
                      return onSavePatch(
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
                <td className="c-pay shp-daily-center">
                  <button
                    type="button"
                    className={`shp-pay-tag ${payCls}`}
                    disabled={feeAmount <= 0}
                    onClick={() => onCollect(r)}
                    title={
                      hasMethodFilter
                        ? `נגבה באמצעי שנבחר: ${fmtIls(methodPaid)}`
                        : undefined
                    }
                  >
                    {collectLabel(r, paymentMethodFilter)}
                  </button>
                </td>
                <td
                  className="c-bal shp-daily-money shp-daily-center"
                  title="יתרת לקוח חיה ממערכת הלקוחות (SSOT)"
                  style={{
                    color:
                      (bal ?? 0) > 0.005
                        ? "#b91c1c"
                        : (bal ?? 0) < -0.005
                          ? "#15803d"
                          : "#475569",
                    fontWeight: 600,
                  }}
                >
                  {fmtCustomerBalance(bal)}
                </td>
                <td className="c-status">
                  <select
                    className="shp-inline-select"
                    value={r.status}
                    onChange={(e) => onStatusChange(r.id, e.target.value as ShipmentStatus)}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="c-act">
                  <button
                    type="button"
                    className="shp-btn shp-btn--sm"
                    onClick={() => onFixLocation(r)}
                    title={
                      r.originalDeliveryLocation
                        ? `תיקון התאמה (מקור: ${r.originalDeliveryLocation})`
                        : "תיקון התאמה"
                    }
                  >
                    תיקון
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {zoneAssignRecord ? (
        <ZoneAssignModal
          record={zoneAssignRecord}
          zones={zones}
          busy={zoneAssignBusy}
          onClose={() => {
            if (!zoneAssignBusy) setZoneAssignRecord(null);
          }}
          onCreateZone={onCreateZone}
          onSave={async (zone) => {
            setZoneAssignBusy(true);
            const ok = await onZoneSelect(zoneAssignRecord.id, zone);
            setZoneAssignBusy(false);
            return ok;
          }}
        />
      ) : null}

      {nameFixRecord ? (
        <CustomerNameFixModal
          record={nameFixRecord}
          busy={nameFixBusy}
          onClose={() => {
            if (!nameFixBusy) setNameFixRecord(null);
          }}
          onSave={async (name) => {
            setNameFixBusy(true);
            const ok = await onSavePatch(
              nameFixRecord.id,
              { customerName: name },
              { customerName: name },
            );
            setNameFixBusy(false);
            return ok;
          }}
        />
      ) : null}

      {showAddCourier && (
        <div className="shp-modal-backdrop" role="presentation" onClick={() => setShowAddCourier(false)}>
          <div
            className="shp-modal"
            dir="rtl"
            role="dialog"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="shp-modal__head">
              <h3>הוסף שליח חדש</h3>
              <button type="button" className="shp-btn shp-btn--ghost shp-btn--sm" onClick={() => setShowAddCourier(false)}>✕</button>
            </header>
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              {addCourierError && (
                <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", borderRadius: 8, fontSize: "0.85rem" }}>
                  {addCourierError}
                </div>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", fontWeight: 600 }}>
                שם השליח *
                <input
                  autoFocus
                  value={addCourierName}
                  onChange={(e) => setAddCourierName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCourier()}
                  style={{ padding: "8px 12px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: "0.9rem" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", fontWeight: 600 }}>
                טלפון (אופציונלי)
                <input
                  value={addCourierPhone}
                  onChange={(e) => setAddCourierPhone(e.target.value)}
                  style={{ padding: "8px 12px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: "0.9rem" }}
                />
              </label>
            </div>
            <footer className="shp-modal__foot">
              <button type="button" className="shp-btn shp-btn--secondary" onClick={() => setShowAddCourier(false)}>
                ביטול
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                onClick={handleAddCourier}
                disabled={addCourierSaving || !addCourierName.trim()}
              >
                {addCourierSaving ? "שומר…" : "שמור"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
