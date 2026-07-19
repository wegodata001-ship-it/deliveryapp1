"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, FileText, X } from "lucide-react";
import type {
  ShipmentControlFilter,
  ShipmentControlRecord,
} from "@/app/admin/shipments/control/types";
import { getShipmentControlDataAction } from "@/app/admin/shipments/control/actions";
import {
  SHIPMENT_STATUS_LABELS,
} from "@/app/admin/shipments/types";
import type { ShipmentStatus } from "@/app/admin/shipments/types";
import {
  exportShipmentReportExcel,
  exportShipmentReportPdf,
  filterShipmentReportRecords,
  shipmentReportKindLabel,
  type ShipmentReportFilters,
  type ShipmentReportFormat,
  type ShipmentReportKind,
} from "@/lib/shipment-report-export";

type Props = {
  kind: ShipmentReportKind;
  format: ShipmentReportFormat;
  records: ShipmentControlRecord[];
  zones: { id: string; name: string }[];
  couriers: string[];
  initialFilter: ShipmentControlFilter;
  generatedBy: string;
  onClose: () => void;
};

const STATUSES = Object.keys(SHIPMENT_STATUS_LABELS) as ShipmentStatus[];

function initialValues(filter: ShipmentControlFilter): ShipmentReportFilters {
  const year = filter.year;
  const month = filter.month;
  const calculatedFrom = year
    ? `${year}-${String(month ?? 1).padStart(2, "0")}-01`
    : "";
  const calculatedTo = year
    ? (() => {
        const lastMonth = month ?? 12;
        const lastDay = new Date(year, lastMonth, 0).getDate();
        return `${year}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      })()
    : "";
  return {
    dateFrom: filter.dateFrom ?? calculatedFrom,
    dateTo: filter.dateTo ?? calculatedTo,
    containerNumber: filter.containerNumber ?? "",
    zoneId: filter.zoneId ?? "",
    courierName: filter.courierName ?? "",
    status: "",
    paymentScope: "all",
  };
}

export function ShipmentReportExportModal({
  kind,
  format,
  records,
  zones,
  couriers,
  initialFilter,
  generatedBy,
  onClose,
}: Props) {
  const [filters, setFilters] = useState<ShipmentReportFilters>(
    () => initialValues(initialFilter),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = useMemo(
    () => filterShipmentReportRecords(records, filters).length,
    [records, filters],
  );

  function patch<K extends keyof ShipmentReportFilters>(
    key: K,
    value: ShipmentReportFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const fresh = await getShipmentControlDataAction({
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        containerNumber: filters.containerNumber || undefined,
        zoneId: filters.zoneId || undefined,
        courierName: filters.courierName || undefined,
      });
      if (!fresh.ok) throw new Error(fresh.error);
      const params = {
        kind,
        records: fresh.data.records,
        filters,
        meta: {
          companyName: "WEGO ERP",
          generatedBy,
          generatedAt: new Date(),
        },
      };
      if (format === "excel") {
        await exportShipmentReportExcel(params);
      } else {
        await exportShipmentReportPdf(params);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="shp-modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="shp-modal shp-modal--report" dir="rtl">
        <div className="shp-modal__header">
          {format === "excel"
            ? <FileSpreadsheet size={18} color="#15803d" />
            : <FileText size={18} color="#dc2626" />}
          הפקת {shipmentReportKindLabel(kind)} — {format === "excel" ? "Excel" : "PDF"}
          <button className="shp-modal__header-close" onClick={onClose} title="סגור">
            <X size={18} />
          </button>
        </div>

        <div className="shp-modal__body">
          <div className="shp-form-grid sc-report-filter-grid">
            <div className="shp-form-field">
              <label>מתאריך</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => patch("dateFrom", event.target.value)}
              />
            </div>
            <div className="shp-form-field">
              <label>עד תאריך</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) => patch("dateTo", event.target.value)}
              />
            </div>
            <div className="shp-form-field">
              <label>מספר קונטיינר</label>
              <input
                value={filters.containerNumber}
                onChange={(event) => patch("containerNumber", event.target.value)}
                placeholder="כל הקונטיינרים"
              />
            </div>
            <div className="shp-form-field">
              <label>אזור</label>
              <select
                value={filters.zoneId}
                onChange={(event) => patch("zoneId", event.target.value)}
              >
                <option value="">כל האזורים</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>
            <div className="shp-form-field">
              <label>שליח</label>
              <select
                value={filters.courierName}
                onChange={(event) => patch("courierName", event.target.value)}
              >
                <option value="">כל השליחים</option>
                {couriers.map((courier) => (
                  <option key={courier} value={courier}>{courier}</option>
                ))}
              </select>
            </div>
            <div className="shp-form-field">
              <label>סטטוס משלוח</label>
              <select
                value={filters.status}
                onChange={(event) => patch("status", event.target.value)}
              >
                <option value="">כל הסטטוסים</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {SHIPMENT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sc-report-payment-scope">
            <span>תשלום:</span>
            {([
              ["all", "כל המשלוחים"],
              ["paid", "רק שולמו"],
              ["unpaid", "רק לא שולמו"],
            ] as const).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="payment-scope"
                  value={value}
                  checked={filters.paymentScope === value}
                  onChange={() => patch("paymentScope", value)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="shp-alert shp-alert--info sc-report-preview-count">
            הדוח יכלול <strong>{count.toLocaleString("he-IL")}</strong> משלוחים
          </div>
          {error && <div className="shp-alert shp-alert--error">{error}</div>}
        </div>

        <div className="shp-modal__footer">
          <button
            className={`shp-btn ${format === "excel" ? "shp-btn--success" : "shp-btn--primary"}`}
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy && <span className="shp-spinner" />}
            {format === "excel"
              ? <FileSpreadsheet size={15} />
              : <FileText size={15} />}
            {busy ? "מפיק דוח…" : `הפק ${format === "excel" ? "Excel" : "PDF"}`}
          </button>
          <button className="shp-btn shp-btn--secondary" disabled={busy} onClick={onClose}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
