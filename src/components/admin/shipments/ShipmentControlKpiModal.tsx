"use client";

import { useMemo, useState, Fragment } from "react";
import {
  X, Search, Banknote, Trash2, Plus, Save, Eye,
} from "lucide-react";
import type { ShipmentControlRecord } from "@/app/admin/shipments/control/types";
import type { ShipmentRecordDto, ShipmentStatus } from "@/app/admin/shipments/types";
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_PAYMENT_STATUS_LABELS,
} from "@/app/admin/shipments/types";
import {
  assignCourierAction,
  assignZoneAction,
  createCourierAction,
  createZoneAction,
  deleteShipmentRecordAction,
  getShipmentRecordAction,
  updateShipmentRecordAction,
  updateShipmentStatusAction,
} from "@/app/admin/shipments/actions";
import { ShipmentPaymentModal } from "@/components/admin/shipments/ShipmentPaymentModal";

export type KpiDrillKey =
  | "all"
  | "delivered"
  | "in_transit"
  | "not_delivered"
  | "returned"
  | "completed"
  | "to_charge"
  | "collected"
  | "remaining"
  | "credit"
  | "zones"
  | "couriers"
  | "no_courier"
  | "no_zone"
  | "unpaid"
  | "partial"
  | "paid"
  | "boxes"
  | "weight"
  | "delivered_boxes"
  | "not_delivered_boxes";

export const KPI_DRILL_TITLES: Record<KpiDrillKey, string> = {
  all: "סה״כ משלוחים",
  delivered: "נמסרו",
  in_transit: "בדרך",
  not_delivered: "לא נמסרו",
  returned: "חזרו",
  completed: "הושלמו",
  to_charge: "לחיוב",
  collected: "נגבה",
  remaining: "יתרה פתוחה",
  credit: "יתרת זכות",
  zones: "אזורים",
  couriers: "שליחים",
  no_courier: "ללא שליח",
  no_zone: "ללא אזור",
  unpaid: "לא שולמו",
  partial: "שולמו חלקית",
  paid: "שולמו",
  boxes: "קרטונים",
  weight: "משקל",
  delivered_boxes: "קרטונים שנמסרו",
  not_delivered_boxes: "קרטונים שלא נמסרו",
};

const STATUS_OPTIONS: ShipmentStatus[] = [
  "NEW", "RECEIVED", "ASSIGNED", "IN_TRANSIT",
  "DELIVERED", "NOT_DELIVERED", "RETURNED", "COMPLETED",
];

type Props = {
  kpiKey: KpiDrillKey;
  records: ShipmentControlRecord[];
  zones: { id: string; name: string }[];
  courierOptions: { id: string; name: string }[];
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
};

function fmtIls(n: number | null | undefined) {
  if (n == null) return "—";
  return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function filterRecordsForKpi(
  records: ShipmentControlRecord[],
  key: KpiDrillKey,
): ShipmentControlRecord[] {
  switch (key) {
    case "all":
    case "zones":
    case "couriers":
    case "boxes":
    case "weight":
      return records;
    case "delivered":
      return records.filter((r) => r.status === "DELIVERED");
    case "in_transit":
      return records.filter((r) => r.status === "IN_TRANSIT");
    case "not_delivered":
      return records.filter((r) => r.status === "NOT_DELIVERED");
    case "returned":
      return records.filter((r) => r.status === "RETURNED");
    case "completed":
      return records.filter((r) => r.status === "COMPLETED");
    case "to_charge":
      return records.filter((r) => (r.deliveryFeeIls ?? 0) > 0);
    case "collected":
      return records.filter((r) => r.paidAmountIls > 0);
    case "remaining":
      return records.filter((r) => r.remainingFeeIls > 0.01);
    case "credit":
      return records.filter(
        (r) => r.paidAmountIls > (r.deliveryFeeIls ?? 0) + 0.01,
      );
    case "no_courier":
      return records.filter((r) => !r.courierName);
    case "no_zone":
      return records.filter((r) => !r.zoneId);
    case "unpaid":
      return records.filter((r) => r.paymentStatus === "UNPAID");
    case "partial":
      return records.filter((r) => r.paymentStatus === "PARTIAL");
    case "paid":
      return records.filter((r) => r.paymentStatus === "PAID");
    case "delivered_boxes":
      return records.filter((r) => r.status === "DELIVERED" || r.status === "COMPLETED");
    case "not_delivered_boxes":
      return records.filter((r) => r.status === "NOT_DELIVERED" || r.status === "RETURNED");
    default:
      return records;
  }
}

export function ShipmentControlKpiModal({
  kpiKey,
  records,
  zones,
  courierOptions,
  canWrite,
  onClose,
  onChanged,
}: Props) {
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentRecord, setPaymentRecord] = useState<ShipmentRecordDto | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newZoneName, setNewZoneName] = useState("");
  const [newCourierName, setNewCourierName] = useState("");
  const [localZones, setLocalZones] = useState(zones);
  const [localCouriers, setLocalCouriers] = useState(courierOptions);

  const baseRecords = useMemo(
    () => filterRecordsForKpi(records, kpiKey),
    [records, kpiKey],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return baseRecords;
    return baseRecords.filter((r) => {
      const hay = [
        r.batchNumber,
        r.customerName,
        r.customerPhone,
        r.address,
        r.city,
        r.zoneName,
        r.courierName,
        r.containerNumber,
        r.cartonDetails,
        r.notes,
        String(r.boxes ?? ""),
        String(r.weight ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [baseRecords, search]);

  const summary = useMemo(() => {
    const fee = filtered.reduce((s, r) => s + (r.deliveryFeeIls ?? 0), 0);
    const paid = filtered.reduce((s, r) => s + r.paidAmountIls, 0);
    const remaining = filtered.reduce((s, r) => s + r.remainingFeeIls, 0);
    const boxes = filtered.reduce((s, r) => s + (r.boxes ?? 0), 0);
    const weight = filtered.reduce((s, r) => s + (r.weight ?? 0), 0);
    return { fee, paid, remaining, boxes, weight };
  }, [filtered]);

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssignZone(recordId: string, zoneId: string) {
    await withBusy(recordId, async () => {
      const res = await assignZoneAction({
        recordIds: [recordId],
        zoneId: zoneId || null,
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleAssignCourier(recordId: string, courierId: string) {
    await withBusy(recordId, async () => {
      const res = await assignCourierAction({
        recordIds: [recordId],
        courierId: courierId || null,
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleStatus(recordId: string, status: ShipmentStatus) {
    await withBusy(recordId, async () => {
      const res = await updateShipmentStatusAction({
        recordIds: [recordId],
        status,
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleFee(recordId: string, amount: number | null) {
    await withBusy(recordId, async () => {
      const res = await updateShipmentRecordAction({
        recordId,
        patch: { deliveryFeeAmount: amount, deliveryFeeCurrency: "ILS" },
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleWeight(recordId: string, weight: number | null) {
    await withBusy(recordId, async () => {
      const res = await updateShipmentRecordAction({
        recordId,
        patch: { weight },
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleBoxes(recordId: string, boxes: number | null) {
    await withBusy(recordId, async () => {
      const res = await updateShipmentRecordAction({
        recordId,
        patch: { boxes },
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleNotes(recordId: string, notes: string | null) {
    await withBusy(recordId, async () => {
      const res = await updateShipmentRecordAction({
        recordId,
        patch: { notes },
      });
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function handleDelete(recordId: string) {
    if (!canWrite) return;
    if (!window.confirm("למחוק את המשלוח ואת כל הגביות שלו?")) return;
    await withBusy(recordId, async () => {
      const res = await deleteShipmentRecordAction(recordId);
      if (!res.ok) throw new Error(res.error);
    });
  }

  async function openPayment(recordId: string) {
    setBusyId(recordId);
    setError(null);
    const res = await getShipmentRecordAction(recordId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPaymentRecord(res.record);
  }

  async function createZoneQuick() {
    const name = newZoneName.trim();
    if (!name) return;
    setBusyId("new-zone");
    const res = await createZoneAction(name);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLocalZones((prev) => [
      ...prev.filter((z) => z.id !== res.zone.id),
      { id: res.zone.id, name: res.zone.name },
    ]);
    setNewZoneName("");
    onChanged();
  }

  async function createCourierQuick() {
    const name = newCourierName.trim();
    if (!name) return;
    setBusyId("new-courier");
    const res = await createCourierAction(name);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLocalCouriers((prev) => [
      ...prev.filter((c) => c.id !== res.courier.id),
      { id: res.courier.id, name: res.courier.name },
    ]);
    setNewCourierName("");
    onChanged();
  }

  const cols = {
    zone: kpiKey === "no_zone" || kpiKey === "all" || kpiKey === "zones",
    courier: kpiKey === "no_courier" || kpiKey === "in_transit" || kpiKey === "all" || kpiKey === "couriers",
    boxes: kpiKey === "boxes" || kpiKey === "delivered_boxes" || kpiKey === "not_delivered_boxes" || kpiKey === "all",
    weight: kpiKey === "weight" || kpiKey === "boxes",
    fee: ["to_charge", "remaining", "unpaid", "partial", "paid", "collected", "credit", "all"].includes(kpiKey),
    paid: ["paid", "partial", "collected", "credit", "remaining", "unpaid"].includes(kpiKey),
    remaining: ["unpaid", "partial", "remaining", "to_charge"].includes(kpiKey),
    status: ["in_transit", "returned", "not_delivered", "all"].includes(kpiKey),
    payment: ["unpaid", "partial", "paid", "collected", "credit", "remaining", "to_charge"].includes(kpiKey),
    notes: kpiKey === "returned",
    feeEdit: kpiKey === "to_charge" || kpiKey === "remaining" || kpiKey === "all",
    weightEdit: kpiKey === "weight" || kpiKey === "boxes",
    collect: ["unpaid", "partial", "remaining", "to_charge", "all", "paid", "collected", "credit"].includes(kpiKey),
  };

  return (
    <>
      <div className="shp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="shp-modal shp-modal--kpi" dir="rtl">
          <div className="shp-modal__header">
            {KPI_DRILL_TITLES[kpiKey]}
            <span className="sc-kpi-modal-count">{filtered.length}</span>
            <button className="shp-modal__header-close" onClick={onClose} title="סגור">
              <X size={18} />
            </button>
          </div>

          <div className="shp-modal__body">
            <div className="sc-kpi-modal-toolbar">
              <div className="sc-kpi-modal-search">
                <Search size={14} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש לפי לקוח, כתובת, שליח, קרטון..."
                />
              </div>
              <div className="sc-kpi-modal-summary">
                <span>דמי משלוח: <strong>{fmtIls(summary.fee)}</strong></span>
                <span>נגבה: <strong>{fmtIls(summary.paid)}</strong></span>
                <span>יתרה: <strong>{fmtIls(summary.remaining)}</strong></span>
                {(kpiKey === "boxes" || kpiKey === "delivered_boxes" || kpiKey === "not_delivered_boxes") && (
                  <span>קרטונים: <strong>{summary.boxes}</strong></span>
                )}
                {kpiKey === "weight" && (
                  <span>משקל: <strong>{summary.weight.toLocaleString("he-IL")} ק״ג</strong></span>
                )}
              </div>
            </div>

            {canWrite && (kpiKey === "no_zone" || kpiKey === "zones") && (
              <div className="sc-kpi-modal-quickadd">
                <input
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="אזור חדש..."
                />
                <button
                  className="shp-btn shp-btn--secondary shp-btn--sm"
                  onClick={() => void createZoneQuick()}
                  disabled={busyId === "new-zone" || !newZoneName.trim()}
                >
                  <Plus size={13} /> הוסף אזור
                </button>
              </div>
            )}

            {canWrite && (kpiKey === "no_courier" || kpiKey === "couriers") && (
              <div className="sc-kpi-modal-quickadd">
                <input
                  value={newCourierName}
                  onChange={(e) => setNewCourierName(e.target.value)}
                  placeholder="שליח חדש..."
                />
                <button
                  className="shp-btn shp-btn--secondary shp-btn--sm"
                  onClick={() => void createCourierQuick()}
                  disabled={busyId === "new-courier" || !newCourierName.trim()}
                >
                  <Plus size={13} /> הוסף שליח
                </button>
              </div>
            )}

            {error && <div className="shp-alert shp-alert--error">{error}</div>}

            <div className="shp-table-wrap sc-kpi-modal-table">
              <table className="shp-table shp-table--compact">
                <thead>
                  <tr>
                    <th>משלוח</th>
                    <th>לקוח</th>
                    {(cols.zone) && <th>אזור</th>}
                    {(cols.courier) && <th>שליח</th>}
                    {cols.boxes && (
                      <th>קרטונים</th>
                    )}
                    {cols.weight && <th>משקל</th>}
                    {(cols.fee) && (
                      <th>דמי משלוח</th>
                    )}
                    {(cols.paid) && <th>נגבה</th>}
                    {(cols.remaining) && <th>יתרה</th>}
                    {cols.status && <th>סטטוס</th>}
                    {(cols.payment) && <th>תשלום</th>}
                    {cols.notes && <th>הערות</th>}
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} style={{ textAlign: "center", padding: 28, color: "#94a3b8" }}>
                        אין רשומות להצגה
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => (
                    <Fragment key={r.id}>
                      <tr className={busyId === r.id ? "sc-kpi-row--busy" : undefined}>
                        <td style={{ fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>
                          {r.batchNumber}
                          <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>#{r.rowIndex}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.customerName || "—"}</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{r.customerPhone || ""}</div>
                        </td>

                        {(cols.zone) && (
                          <td>
                            {canWrite ? (
                              <select
                                className="shp-inline-select"
                                value={r.zoneId ?? ""}
                                onChange={(e) => void handleAssignZone(r.id, e.target.value)}
                                disabled={busyId === r.id}
                              >
                                <option value="">ללא אזור</option>
                                {localZones.map((z) => (
                                  <option key={z.id} value={z.id}>{z.name}</option>
                                ))}
                              </select>
                            ) : (
                              r.zoneName || "—"
                            )}
                          </td>
                        )}

                        {(cols.courier) && (
                          <td>
                            {canWrite ? (
                              <select
                                className="shp-inline-select"
                                value={r.courierId ?? ""}
                                onChange={(e) => void handleAssignCourier(r.id, e.target.value)}
                                disabled={busyId === r.id}
                              >
                                <option value="">ללא שליח</option>
                                {localCouriers.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            ) : (
                              r.courierName || "—"
                            )}
                          </td>
                        )}

                        {cols.boxes && (
                          <td style={{ textAlign: "center" }}>
                            {canWrite && cols.weightEdit ? (
                              <input
                                className="sc-kpi-inline-num"
                                type="number"
                                min={0}
                                defaultValue={r.boxes ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v === r.boxes) return;
                                  void handleBoxes(r.id, v);
                                }}
                              />
                            ) : (
                              <>
                                {r.boxes ?? "—"}
                                {r.cartonDetails && (
                                  <div style={{ fontSize: "0.68rem", color: "#64748b" }}>{r.cartonDetails}</div>
                                )}
                              </>
                            )}
                          </td>
                        )}

                        {cols.weight && (
                          <td style={{ textAlign: "center" }}>
                            {canWrite && cols.weightEdit ? (
                              <input
                                className="sc-kpi-inline-num"
                                type="number"
                                min={0}
                                step={0.001}
                                defaultValue={r.weight ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v === r.weight) return;
                                  void handleWeight(r.id, v);
                                }}
                              />
                            ) : (
                              r.weight != null ? `${r.weight}` : "—"
                            )}
                          </td>
                        )}

                        {(cols.fee) && (
                          <td style={{ fontWeight: 600 }}>
                            {canWrite && cols.feeEdit ? (
                              <input
                                className="sc-kpi-inline-num"
                                type="number"
                                min={0}
                                step={0.01}
                                defaultValue={r.deliveryFeeIls ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v === r.deliveryFeeIls) return;
                                  void handleFee(r.id, v);
                                }}
                              />
                            ) : (
                              fmtIls(r.deliveryFeeIls)
                            )}
                          </td>
                        )}

                        {(cols.paid) && (
                          <td style={{ color: "#15803d", fontWeight: 600 }}>{fmtIls(r.paidAmountIls)}</td>
                        )}

                        {(cols.remaining) && (
                          <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d", fontWeight: 600 }}>
                            {fmtIls(r.remainingFeeIls)}
                          </td>
                        )}

                        {cols.status && (
                          <td>
                            {canWrite ? (
                              <select
                                className="shp-inline-select"
                                value={r.status}
                                onChange={(e) => void handleStatus(r.id, e.target.value as ShipmentStatus)}
                                disabled={busyId === r.id}
                              >
                                {STATUS_OPTIONS.map((s) => (
                                  <option key={s} value={s}>{SHIPMENT_STATUS_LABELS[s]}</option>
                                ))}
                              </select>
                            ) : (
                              SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status
                            )}
                          </td>
                        )}

                        {(cols.payment) && (
                          <td>
                            <span className={`shp-badge shp-badge--${r.paymentStatus.toLowerCase()}`}>
                              {SHIPMENT_PAYMENT_STATUS_LABELS[r.paymentStatus as "UNPAID" | "PARTIAL" | "PAID"] ?? r.paymentStatus}
                            </span>
                            {r.payments.length > 0 && (
                              <div style={{ fontSize: "0.68rem", color: "#64748b", marginTop: 2 }}>
                                {r.payments.map((p) => `${p.methodLabel} ${fmtIls(p.amountIls)}`).join(" · ")}
                              </div>
                            )}
                          </td>
                        )}

                        {cols.notes && (
                          <td>
                            {canWrite ? (
                              <input
                                className="sc-kpi-inline-text"
                                defaultValue={r.notes ?? ""}
                                placeholder="סיבת החזרה / הערה"
                                onBlur={(e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v === r.notes) return;
                                  void handleNotes(r.id, v);
                                }}
                              />
                            ) : (
                              r.notes || "—"
                            )}
                          </td>
                        )}

                        <td>
                          <div className="sc-kpi-actions">
                            <button
                              className="shp-btn shp-btn--icon"
                              title="פרטים"
                              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                            >
                              <Eye size={13} />
                            </button>
                            {cols.collect && (r.deliveryFeeIls ?? 0) > 0 && (
                              <button
                                className="shp-btn shp-btn--sm shp-btn--primary"
                                disabled={busyId === r.id}
                                onClick={() => void openPayment(r.id)}
                                title={r.paymentStatus === "UNPAID" ? "בצע גבייה" : "פרטי גבייה"}
                              >
                                <Banknote size={12} />
                                {r.paymentStatus === "UNPAID" ? "גבה" : "גבייה"}
                              </button>
                            )}
                            {canWrite && (
                              <button
                                className="shp-btn shp-btn--icon"
                                title="מחק"
                                disabled={busyId === r.id}
                                onClick={() => void handleDelete(r.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === r.id && (
                        <tr>
                          <td colSpan={12}>
                            <div className="sc-expand-panel">
                              <div className="sc-expand-grid">
                                <div><span className="sc-expand-label">כתובת:</span> {r.address || "—"} {r.city || ""}</div>
                                <div><span className="sc-expand-label">קונטיינר:</span> {r.containerNumber || "—"}</div>
                                <div><span className="sc-expand-label">קרטונים:</span> {r.boxes ?? "—"} {r.cartonDetails ? `(${r.cartonDetails})` : ""}</div>
                                <div><span className="sc-expand-label">משקל:</span> {r.weight != null ? `${r.weight} ק״ג` : "—"}</div>
                                <div><span className="sc-expand-label">הערות:</span> {r.notes || "—"}</div>
                                <div>
                                  <span className="sc-expand-label">סטטוס:</span>{" "}
                                  {SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="shp-modal__footer">
            <button className="shp-btn shp-btn--secondary" onClick={onClose}>
              סגור
            </button>
            {canWrite && (
              <span className="sc-kpi-modal-hint">
                <Save size={13} /> שינויים נשמרים אוטומטית
              </span>
            )}
          </div>
        </div>
      </div>

      {paymentRecord && (
        <ShipmentPaymentModal
          record={paymentRecord}
          onClose={() => setPaymentRecord(null)}
          onSaved={() => {
            setPaymentRecord(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
