"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Layers, RefreshCw } from "lucide-react";
import type {
  ShipmentBatchDto,
  ShipmentCourierDto,
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentStatus,
} from "@/app/admin/shipments/types";
import { SHIPMENT_STATUS_LABELS } from "@/app/admin/shipments/types";
import {
  assignCourierAction,
  assignZoneAction,
  listShipmentRecordsByBatchIdsAction,
  updateShipmentStatusAction,
} from "@/app/admin/shipments/actions";
import { SyncedTableScroll } from "@/components/admin/shipments/SyncedTableScroll";

type Props = {
  batchIds: string[];
  initialRecords: ShipmentRecordDto[];
  initialZones: ShipmentZoneDto[];
  initialCouriers: ShipmentCourierDto[];
  initialBatches: ShipmentBatchDto[];
};

function fmtIls(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0 });
}

function fmtUsd(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("he-IL", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function formatPaymentDate(record: ShipmentRecordDto): string {
  if (!record.payments.length) return "—";
  const last = record.payments[record.payments.length - 1];
  return formatDate(last.details?.paymentDate || last.createdAt);
}

function formatAddress(record: ShipmentRecordDto): string {
  const parts = [record.address, record.city].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function batchShipmentLabel(batch: ShipmentBatchDto | undefined, fallback: string): string {
  if (!batch) return fallback;
  return batch.containerNumber || batch.sourceShipmentNumber || batch.batchNumber;
}

export function ShipmentCombinedClient({
  batchIds,
  initialRecords,
  initialZones,
  initialCouriers,
  initialBatches,
}: Props) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zones] = useState(initialZones);
  const [couriers] = useState(initialCouriers);
  const [batches] = useState(initialBatches);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const batchById = useMemo(() => {
    const map = new Map<string, ShipmentBatchDto>();
    for (const b of batches) map.set(b.id, b);
    return map;
  }, [batches]);

  const batchNumbers = useMemo(
    () => [...new Set(records.map((r) => r.batchNumber))],
    [records],
  );

  const totals = useMemo(() => {
    const orderUsd = records.reduce((s, r) => {
      const cur = (r.orderCurrency ?? "USD").toUpperCase();
      if (r.orderAmount && (cur === "USD" || cur === "UNKNOWN" || !r.orderCurrency)) {
        return s + r.orderAmount;
      }
      return s;
    }, 0);
    const paid = records.reduce((s, r) => s + r.paidAmountIls, 0);
    const remaining = records.reduce((s, r) => s + r.remainingFeeIls, 0);
    return { orderUsd, paid, remaining, count: records.length };
  }, [records]);

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
    if (selected.size === records.length) setSelected(new Set());
    else setSelected(new Set(records.map((r) => r.id)));
  }

  async function bulkZone(zoneId: string) {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await assignZoneAction({ recordIds: [...selected], zoneId: zoneId || null });
    setBusy(false);
    if (res.ok) {
      setMsg(`עודכן אזור ל-${selected.size} רשומות`);
      await refresh();
    } else setMsg(res.error);
  }

  async function bulkCourier(courierId: string) {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await assignCourierAction({
      recordIds: [...selected],
      courierId: courierId || null,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`עודכן שליח ל-${selected.size} רשומות`);
      await refresh();
    } else setMsg(res.error);
  }

  async function bulkStatus(status: ShipmentStatus) {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await updateShipmentStatusAction({ recordIds: [...selected], status });
    setBusy(false);
    if (res.ok) {
      setMsg(`עודכן סטטוס ל-${selected.size} רשומות`);
      await refresh();
    } else setMsg(res.error);
  }

  if (batchIds.length === 0) {
    return (
      <div className="shp-page">
        <div className="shp-empty">
          <div className="shp-empty__title">לא נבחרו משלוחים</div>
          <button className="shp-btn shp-btn--primary" onClick={() => router.push("/admin/shipments")}>
            חזרה לרשימה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shp-page">
      <div className="shp-header">
        <button className="shp-btn shp-btn--ghost shp-btn--sm" onClick={() => router.push("/admin/shipments")}>
          <ArrowRight size={16} />
        </button>
        <Layers size={20} style={{ color: "#2563eb" }} />
        <h1>משלוחים מאוחדים</h1>
        <span className="shp-muted">
          {batchNumbers.join(", ")} · {totals.count} לקוחות/חבילות
        </span>
        <div className="shp-header-actions">
          <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={14} /> רענון
          </button>
        </div>
      </div>

      <div className="shp-stats">
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{batchIds.length}</div>
          <div className="shp-stat-card__label">משלוחים</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{totals.count}</div>
          <div className="shp-stat-card__label">חבילות / לקוחות</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtUsd(totals.orderUsd)}</div>
          <div className="shp-stat-card__label">סכום כולל ($)</div>
        </div>
        <div className="shp-stat-card">
          <div className="shp-stat-card__value">{fmtIls(totals.remaining)}</div>
          <div className="shp-stat-card__label">יתרה לתשלום</div>
        </div>
      </div>

      {msg ? <div className="shp-alert shp-alert--info">{msg}</div> : null}

      <div className="shp-filters" style={{ gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.85rem" }}>פעולות על מסומנים ({selected.size}):</span>
        <select
          disabled={selected.size === 0 || busy}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            if (v) void bulkZone(v);
          }}
        >
          <option value="">שיבוץ אזור…</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <select
          disabled={selected.size === 0 || busy}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            if (v) void bulkCourier(v);
          }}
        >
          <option value="">שיבוץ שליח…</option>
          {couriers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          disabled={selected.size === 0 || busy}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as ShipmentStatus;
            e.target.value = "";
            if (v) void bulkStatus(v);
          }}
        >
          <option value="">עדכון סטטוס…</option>
          {(Object.keys(SHIPMENT_STATUS_LABELS) as ShipmentStatus[]).map((k) => (
            <option key={k} value={k}>
              {SHIPMENT_STATUS_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <SyncedTableScroll>
        <table className="shp-table shp-batch-table">
          <thead>
            <tr>
              <th className="shp-col-check">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === records.length}
                  onChange={toggleAll}
                />
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
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const batch = batchById.get(r.batchId);
              return (
                <tr key={r.id}>
                  <td className="shp-col-check">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="shp-col-arrival">{formatDate(batch?.arrivalDate ?? null)}</td>
                  <td className="shp-col-shipment-no">
                    <button
                      type="button"
                      className="shp-link-btn"
                      onClick={() => router.push(`/admin/shipments/${r.batchId}`)}
                    >
                      <strong>{batchShipmentLabel(batch, r.batchNumber)}</strong>
                      <span className="shp-muted" style={{ display: "block", fontSize: "0.7rem" }}>
                        {r.batchNumber}
                      </span>
                    </button>
                  </td>
                  <td className="shp-col-code">{r.customerCode ?? "—"}</td>
                  <td className="shp-col-customer">{r.customerName ?? "—"}</td>
                  <td className="shp-col-phone">{r.customerPhone ?? "—"}</td>
                  <td className="shp-col-address" title={formatAddress(r)}>
                    {formatAddress(r)}
                  </td>
                  <td className="shp-col-zone">{r.zoneName ?? "—"}</td>
                  <td className="shp-col-boxes">{r.boxes ?? "—"}</td>
                  <td className="shp-col-fee">{fmtIls(r.deliveryFeeIls ?? r.deliveryFeeAmount)}</td>
                  <td className="shp-col-pay-date">{formatPaymentDate(r)}</td>
                  <td className="shp-col-status">
                    <span className={`shp-badge shp-badge--${r.status.toLowerCase()}`}>
                      {SHIPMENT_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SyncedTableScroll>
    </div>
  );
}
