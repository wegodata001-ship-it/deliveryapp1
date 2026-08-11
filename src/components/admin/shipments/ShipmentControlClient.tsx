"use client";

import { Fragment, useState, useMemo, useCallback, useTransition, useEffect } from "react";
import {
  Truck, RefreshCw, Filter, ChevronDown, ChevronUp,
  AlertTriangle, Users, MapPin, Package, Banknote,
  CheckCircle, XCircle, Clock, RotateCcw, FileText,
  TrendingUp, BarChart3, FileSpreadsheet, Search, X, Plus,
} from "lucide-react";
import { getShipmentControlDataAction } from "@/app/admin/shipments/control/actions";
import type {
  ShipmentControlPayload,
  ShipmentControlFilter,
  ShipmentControlRecord,
  ShipmentBatchExpenseDto,
  ShipmentBatchExpenseSummary,
  ShipmentRecordExpenseDto,
  CourierSummary,
  ZoneSummary,
  ShipmentException,
} from "@/app/admin/shipments/control/types";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/app/admin/shipments/types";
import type { ShipmentStatus } from "@/app/admin/shipments/types";
import {
  ShipmentControlKpiModal,
  type KpiDrillKey,
} from "@/components/admin/shipments/ShipmentControlKpiModal";
import { ShipmentControlShipmentsModal } from "@/components/admin/shipments/ShipmentControlShipmentsModal";
import {
  ShipmentBatchExpenseFormModal,
  ShipmentBatchExpensesDetailModal,
  fmtExpenseTotals,
} from "@/components/admin/shipments/ShipmentBatchExpenseModals";
import { ShipmentExpensesManageModal } from "@/components/admin/shipments/ShipmentExpensesManageModal";
import {
  exportShipmentReportExcel,
  exportShipmentReportPdf,
} from "@/lib/shipment-report-export";

type Tab = "overview" | "payments" | "couriers" | "zones" | "exceptions";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "סיכום", icon: <BarChart3 size={15} /> },
  { id: "payments", label: "בקרת תשלומים", icon: <Banknote size={15} /> },
  { id: "couriers", label: "לפי שליח", icon: <Users size={15} /> },
  { id: "zones", label: "לפי אזור", icon: <MapPin size={15} /> },
  { id: "exceptions", label: "חריגות", icon: <AlertTriangle size={15} /> },
];

const MONTHS = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

function fmtIls(n: number | null | undefined) {
  if (n == null) return "—";
  return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color, icon, onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`sc-kpi-card${onClick ? " sc-kpi-card--clickable" : ""}`}
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? `פתח פירוט: ${label}` : undefined}
    >
      {icon && <div className="sc-kpi-card__icon" style={{ color: color ?? "#2563eb" }}>{icon}</div>}
      <div className="sc-kpi-card__value" style={{ color: color ?? "#1e293b" }}>{value}</div>
      <div className="sc-kpi-card__label">{label}</div>
      {sub && <div className="sc-kpi-card__sub">{sub}</div>}
    </button>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls = `shp-badge shp-badge--${status.toLowerCase()}`;
  return <span className={cls}>{SHIPMENT_STATUS_LABELS[status as ShipmentStatus] ?? status}</span>;
}

function PayBadge({ status }: { status: string }) {
  const cls = `shp-badge shp-badge--${status.toLowerCase()}`;
  return <span className={cls}>{SHIPMENT_PAYMENT_STATUS_LABELS[status as "UNPAID" | "PARTIAL" | "PAID"] ?? status}</span>;
}

// ─── Expandable row ───────────────────────────────────────────────────────────

function RecordRow({ r }: { r: ShipmentControlRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="sc-record-row" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <td style={{ width: 28 }}>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </td>
        <td style={{ fontWeight: 600, color: "#1d4ed8", whiteSpace: "nowrap" }}>
          {r.batchNumber}
        </td>
        <td>{r.customerName || "—"}</td>
        <td>{r.zoneName || "—"}</td>
        <td>{r.courierName || "—"}</td>
        <td style={{ textAlign: "center" }}>{r.boxes ?? "—"}</td>
        <td style={{ textAlign: "center" }}>{r.weight != null ? `${r.weight}` : "—"}</td>
        <td style={{ fontWeight: 600 }}>{fmtIls(r.deliveryFeeIls)}</td>
        <td style={{ color: "#15803d", fontWeight: 600 }}>{fmtIls(r.paidAmountIls)}</td>
        <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d", fontWeight: 600 }}>
          {fmtIls(r.remainingFeeIls)}
        </td>
        <td><StatusBadge status={r.status} /></td>
        <td><PayBadge status={r.paymentStatus} /></td>
      </tr>
      {open && (
        <tr className="sc-record-expand">
          <td colSpan={12} style={{ padding: 0 }}>
            <div className="sc-expand-panel">
              <div className="sc-expand-grid">
                <div><span className="sc-expand-label">טלפון:</span> {r.customerPhone || "—"}{r.customerPhone2 ? ` / ${r.customerPhone2}` : ""}</div>
                <div><span className="sc-expand-label">כתובת:</span> {r.address || "—"}, {r.updatedDeliveryLocation || r.city || ""}</div>
                <div><span className="sc-expand-label">הערות:</span> {r.notes || "—"}</div>
                <div><span className="sc-expand-label">קונטיינר:</span> {r.containerNumber || "—"}</div>
                <div><span className="sc-expand-label">נוצר:</span> {formatDate(r.createdAt)}</div>
              </div>
              {r.payments.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="sc-expand-label" style={{ marginBottom: 4 }}>תשלומים:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {r.payments.map((p) => (
                      <span key={p.id} className="sc-payment-chip">
                        {p.methodLabel}: {fmtIls(p.amountIls)}
                        <span style={{ fontSize: "0.7rem", color: "#64748b", marginRight: 4 }}>
                          {formatDate(p.createdAt)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  initialData: ShipmentControlPayload;
  generatedBy: string;
};

export function ShipmentControlClient({ initialData, generatedBy }: Props) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isPending, startTransition] = useTransition();
  const [showCount, setShowCount] = useState(50);

  // Filters
  const now = new Date();
  const [year, setYear] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [courierName, setCourierName] = useState("");
  const [batchId, setBatchId] = useState("");

  // Courier/zone drill
  const [selectedCourier, setSelectedCourier] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<KpiDrillKey | null>(null);
  const [shipmentsModalOpen, setShipmentsModalOpen] = useState(false);
  const [containersModalOpen, setContainersModalOpen] = useState(false);
  const [expensesManageModalOpen, setExpensesManageModalOpen] = useState(false);

  const currentFilter = useCallback((): ShipmentControlFilter => ({
    year: year ? parseInt(year) : undefined,
    month: month ? parseInt(month) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    customerCode: customerCode || undefined,
    zoneId: zoneId || undefined,
    courierName: courierName || undefined,
    batchId: batchId || undefined,
  }), [year, month, dateFrom, dateTo, customerCode, zoneId, courierName, batchId]);

  const refresh = useCallback(
    (filter: ShipmentControlFilter) => {
      startTransition(async () => {
        const res = await getShipmentControlDataAction(filter);
        if (res.ok) { setData(res.data); setShowCount(50); }
      });
    },
    []
  );

  function applyFilter() {
    refresh(currentFilter());
  }

  function clearFilter() {
    setYear(""); setMonth(""); setDateFrom(""); setDateTo("");
    setCustomerCode(""); setZoneId(""); setCourierName(""); setBatchId("");
    refresh({});
  }

  function refreshCurrent() {
    refresh(currentFilter());
  }

  function recalcTotalExpensesIls(
    recs: ShipmentControlRecord[],
    batchExp: ShipmentBatchExpenseSummary[],
  ) {
    const recordIls = recs.reduce((s, r) => s + (r.expensesTotalIls ?? 0), 0);
    const batchIls = batchExp.reduce((s, b) => s + b.totalIls, 0);
    return Math.round((recordIls + batchIls) * 100) / 100;
  }

  const handleBatchExpenseChanged = useCallback(
    (batchId: string, expenses: ShipmentBatchExpenseDto[]) => {
      setData((prev) => {
        let totalIls = 0;
        let totalUsd = 0;
        for (const e of expenses) {
          if (e.currency === "USD") totalUsd += e.amount;
          else totalIls += e.amount;
        }
        totalIls = Math.round(totalIls * 100) / 100;
        totalUsd = Math.round(totalUsd * 100) / 100;

        const summary: ShipmentBatchExpenseSummary = {
          batchId,
          expenses,
          totalIls,
          totalUsd,
          count: expenses.length,
        };
        const newBatchExpenses =
          expenses.length === 0
            ? prev.batchExpenses.filter((b) => b.batchId !== batchId)
            : prev.batchExpenses.some((b) => b.batchId === batchId)
              ? prev.batchExpenses.map((b) => (b.batchId === batchId ? summary : b))
              : [...prev.batchExpenses, summary];

        return {
          ...prev,
          batchExpenses: newBatchExpenses,
          kpis: {
            ...prev.kpis,
            totalExpensesIls: recalcTotalExpensesIls(prev.records, newBatchExpenses),
          },
        };
      });
    },
    [],
  );

  const handleRecordExpenseChanged = useCallback(
    (recordId: string, expenses: ShipmentRecordExpenseDto[]) => {
      setData((prev) => {
        const newRecords = prev.records.map((r) => {
          if (r.id !== recordId) return r;
          const total =
            Math.round(expenses.reduce((s, e) => s + e.amountIls, 0) * 100) / 100;
          return {
            ...r,
            expenses,
            expensesTotalIls: total,
            expensesCount: expenses.length,
          };
        });
        return {
          ...prev,
          records: newRecords,
          kpis: {
            ...prev.kpis,
            totalExpensesIls: recalcTotalExpensesIls(newRecords, prev.batchExpenses),
          },
        };
      });
    },
    [],
  );

  const { kpis, records, byCourier, byZone, exceptions, batches, batchExpenses, zones, couriers } = data;
  const courierOptions = data.courierOptions ?? [];

  const visibleRecords = records.slice(0, showCount);
  const hasMore = records.length > showCount;

  // payment-control tab records (all, sorted by remaining desc)
  const paymentRecords = useMemo(
    () => [...records].sort((a, b) => b.remainingFeeIls - a.remainingFeeIls),
    [records]
  );

  const selectedCourierData = selectedCourier
    ? byCourier.find((c) => c.courierName === selectedCourier) ?? null
    : null;

  const selectedZoneData = selectedZone
    ? byZone.find((z) => z.zoneId === selectedZone || z.zoneName === selectedZone) ?? null
    : null;

  const yearsRange = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="shp-page" dir="rtl">
      {/* Header */}
      <div className="shp-header">
        <Truck size={22} style={{ color: "#2563eb" }} />
        <h1>בקרת משלוחים</h1>
        <div className="shp-header-actions">
          <button
            className="shp-btn shp-btn--secondary shp-btn--sm"
            onClick={refreshCurrent}
            disabled={isPending}
          >
            <RefreshCw size={14} className={isPending ? "sc-spin" : ""} />
            רענון
          </button>
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="sc-filter-bar">
        <Filter size={14} style={{ color: "#64748b", flexShrink: 0 }} />

        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">כל השנים</option>
          {yearsRange.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">כל החודשים</option>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>

        <div className="sc-filter-group">
          <span className="sc-filter-label">מ:</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="sc-filter-label">עד:</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">כל האצוות</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.batchNumber}{b.containerNumber ? ` — ${b.containerNumber}` : ""}
            </option>
          ))}
        </select>

        <input
          placeholder="קוד לקוח..."
          value={customerCode}
          onChange={(e) => setCustomerCode(e.target.value)}
          style={{ width: 120 }}
          aria-label="קוד לקוח"
        />

        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">כל האזורים</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>

        <select value={courierName} onChange={(e) => setCourierName(e.target.value)}>
          <option value="">כל השליחים</option>
          {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <button className="shp-btn shp-btn--primary shp-btn--sm" onClick={applyFilter} disabled={isPending}>
          {isPending ? <span className="shp-spinner" /> : <Filter size={13} />}
          סנן
        </button>
        <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={clearFilter} disabled={isPending}>
          נקה
        </button>
      </div>

      {/* ── KPI Cards row ───────────────────────────────────────────────────── */}
      <div className="sc-kpi-grid">
        {/* Containers group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><Truck size={14} /> משלוחים (קונטיינרים)</div>
          <div className="sc-kpi-row">
            <KpiCard
              label="משלוחים"
              value={batches.length}
              icon={<Truck size={18} />}
              color="#6366f1"
              sub={`${batches.filter((b) => b.containerNumber).length} עם מספר קונטיינר`}
              onClick={() => setContainersModalOpen(true)}
            />
          </div>
        </div>

        {/* Shipments/packages group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><Package size={14} /> חבילות</div>
          <div className="sc-kpi-row">
            <KpiCard
              label="חבילות"
              value={kpis.total}
              icon={<Package size={18} />}
              onClick={() => setShipmentsModalOpen(true)}
            />
            <KpiCard label="נמסרו" value={kpis.delivered} color="#15803d" icon={<CheckCircle size={18} />} onClick={() => setActiveKpi("delivered")} />
            <KpiCard label="בדרך" value={kpis.inTransit} color="#d97706" icon={<Truck size={18} />} onClick={() => setActiveKpi("in_transit")} />
            <KpiCard label="לא נמסרו" value={kpis.notDelivered} color="#dc2626" icon={<XCircle size={18} />} onClick={() => setActiveKpi("not_delivered")} />
            <KpiCard label="חזרו" value={kpis.returned} color="#9d174d" icon={<RotateCcw size={18} />} onClick={() => setActiveKpi("returned")} />
            <KpiCard label="הושלמו" value={kpis.completed} color="#065f46" icon={<CheckCircle size={18} />} onClick={() => setActiveKpi("completed")} />
          </div>
        </div>

        {/* Financial group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><Banknote size={14} /> כספים</div>
          <div className="sc-kpi-row">
            <KpiCard label="לחיוב" value={fmtIls(kpis.totalFeeIls)} icon={<Banknote size={18} />} onClick={() => setActiveKpi("to_charge")} />
            <KpiCard label="נגבה" value={fmtIls(kpis.totalPaidIls)} color="#15803d" icon={<TrendingUp size={18} />} onClick={() => setActiveKpi("collected")} />
            <KpiCard label="יתרה" value={fmtIls(kpis.totalRemainingIls)} color={kpis.totalRemainingIls > 0 ? "#dc2626" : "#15803d"} onClick={() => setActiveKpi("remaining")} />
            <KpiCard
              label="סה״כ הוצאות משלוחים"
              value={fmtIls(kpis.totalExpensesIls ?? 0)}
              color="#b45309"
              icon={<Banknote size={18} />}
              onClick={() => setExpensesManageModalOpen(true)}
            />
            {kpis.totalCreditIls > 0 && (
              <KpiCard label="יתרת זכות" value={fmtIls(kpis.totalCreditIls)} color="#7c3aed" onClick={() => setActiveKpi("credit")} />
            )}
          </div>
        </div>

        {/* Distribution group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><Users size={14} /> חלוקה</div>
          <div className="sc-kpi-row">
            <KpiCard label="אזורים" value={kpis.totalZones} icon={<MapPin size={18} />} onClick={() => setActiveKpi("zones")} />
            <KpiCard label="שליחים" value={kpis.totalCouriers} icon={<Users size={18} />} onClick={() => setActiveKpi("couriers")} />
            <KpiCard label="ללא שליח" value={kpis.unassignedCourier} color={kpis.unassignedCourier > 0 ? "#dc2626" : "#15803d"} onClick={() => setActiveKpi("no_courier")} />
            <KpiCard label="ללא אזור" value={kpis.noZone} color={kpis.noZone > 0 ? "#d97706" : "#15803d"} onClick={() => setActiveKpi("no_zone")} />
          </div>
        </div>

        {/* Payments group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><CheckCircle size={14} /> תשלומים</div>
          <div className="sc-kpi-row">
            <KpiCard label="לא שולמו" value={kpis.unpaidCount} color="#dc2626" onClick={() => setActiveKpi("unpaid")} />
            <KpiCard label="חלקי" value={kpis.partialCount} color="#d97706" onClick={() => setActiveKpi("partial")} />
            <KpiCard label="שולמו" value={kpis.paidCount} color="#15803d" onClick={() => setActiveKpi("paid")} />
          </div>
        </div>

        {/* Cartons group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><Package size={14} /> קרטונים</div>
          <div className="sc-kpi-row">
            <KpiCard label="קרטונים" value={kpis.totalBoxes.toLocaleString()} onClick={() => setActiveKpi("boxes")} />
            <KpiCard label={`משקל (ק"ג)`} value={kpis.totalWeightKg.toLocaleString()} onClick={() => setActiveKpi("weight")} />
            <KpiCard label="נמסרו" value={kpis.deliveredBoxes} color="#15803d" onClick={() => setActiveKpi("delivered_boxes")} />
            <KpiCard label="לא נמסרו" value={kpis.notDeliveredBoxes} color="#dc2626" onClick={() => setActiveKpi("not_delivered_boxes")} />
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="shp-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`shp-tab ${activeTab === t.id ? "shp-tab--active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.icon}
            {t.label}
            {t.id === "exceptions" && data.exceptions.length > 0 && (
              <span className="sc-tab-badge">{data.exceptions.reduce((s, e) => s + e.count, 0)}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ───────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
              מציג {visibleRecords.length} מתוך {data.totalRecordCount} משלוחים
            </span>
          </div>
          <div className="shp-table-wrap">
            <table className="shp-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>מספר משלוח</th>
                  <th>לקוח</th>
                  <th>אזור</th>
                  <th>שליח</th>
                  <th>קרטונים</th>
                  <th>משקל</th>
                  <th>דמי משלוח</th>
                  <th>שולם</th>
                  <th>יתרה</th>
                  <th>סטטוס</th>
                  <th>תשלום</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
                      אין נתונים לפי הסינון הנוכחי
                    </td>
                  </tr>
                )}
                {visibleRecords.map((r) => <RecordRow key={r.id} r={r} />)}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button
                className="shp-btn shp-btn--secondary"
                onClick={() => setShowCount((n) => n + 50)}
              >
                טען עוד ({records.length - showCount} נוספים)
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Payments ───────────────────────────────────────────────────── */}
      {activeTab === "payments" && (
        <div>
          {/* Summary row */}
          <div className="sc-payment-summary-bar">
            <div className="sc-psb-item">
              <span className="sc-psb-label">סה״כ לחיוב</span>
              <span className="sc-psb-value">{fmtIls(kpis.totalFeeIls)}</span>
            </div>
            <div className="sc-psb-item">
              <span className="sc-psb-label">נגבה</span>
              <span className="sc-psb-value sc-psb-value--green">{fmtIls(kpis.totalPaidIls)}</span>
            </div>
            <div className="sc-psb-item">
              <span className="sc-psb-label">יתרה פתוחה</span>
              <span className="sc-psb-value sc-psb-value--red">{fmtIls(kpis.totalRemainingIls)}</span>
            </div>
            <div className="sc-psb-separator" />
            <div className="sc-psb-item">
              <span className="sc-psb-label sc-psb-label--red">לא שולם</span>
              <span className="sc-psb-value">{kpis.unpaidCount}</span>
            </div>
            <div className="sc-psb-item">
              <span className="sc-psb-label sc-psb-label--amber">חלקי</span>
              <span className="sc-psb-value">{kpis.partialCount}</span>
            </div>
            <div className="sc-psb-item">
              <span className="sc-psb-label sc-psb-label--green">שולם</span>
              <span className="sc-psb-value">{kpis.paidCount}</span>
            </div>
          </div>

          <div className="shp-table-wrap">
            <table className="shp-table">
              <thead>
                <tr>
                  <th>מספר משלוח</th>
                  <th>לקוח</th>
                  <th>דמי משלוח</th>
                  <th>שולם</th>
                  <th>יתרה</th>
                  <th>אמצעי תשלום</th>
                  <th>תאריך תשלום</th>
                  <th>סטטוס תשלום</th>
                </tr>
              </thead>
              <tbody>
                {paymentRecords.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>אין נתונים</td>
                  </tr>
                )}
                {paymentRecords.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{r.batchNumber}</td>
                    <td>{r.customerName || "—"}</td>
                    <td style={{ fontWeight: 600 }}>{fmtIls(r.deliveryFeeIls)}</td>
                    <td style={{ color: "#15803d", fontWeight: 600 }}>{fmtIls(r.paidAmountIls)}</td>
                    <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d", fontWeight: 600 }}>
                      {fmtIls(r.remainingFeeIls)}
                    </td>
                    <td>
                      {r.payments.length === 0 ? (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {r.payments.map((p) => (
                            <span key={p.id} className="sc-payment-chip sc-payment-chip--sm">
                              {p.methodLabel}: {fmtIls(p.amountIls)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ color: "#64748b", fontSize: "0.78rem" }}>
                      {r.payments.length > 0 ? formatDate(r.payments[r.payments.length - 1].createdAt) : "—"}
                    </td>
                    <td><PayBadge status={r.paymentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Couriers ───────────────────────────────────────────────────── */}
      {activeTab === "couriers" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
            {/* Courier list */}
            <div className="sc-side-list">
              <div className="sc-side-list__title">שליחים ({byCourier.length})</div>
              {byCourier.map((c) => (
                <div
                  key={c.courierName}
                  className={`sc-side-item ${selectedCourier === c.courierName ? "sc-side-item--active" : ""}`}
                  onClick={() => setSelectedCourier(selectedCourier === c.courierName ? null : c.courierName)}
                >
                  <div className="sc-side-item__name">{c.courierName}</div>
                  <div className="sc-side-item__meta">
                    {c.totalShipments} משלוחים · {fmtIls(c.remainingIls)} יתרה
                  </div>
                </div>
              ))}
              {byCourier.length === 0 && (
                <div style={{ color: "#94a3b8", fontSize: "0.85rem", padding: 12 }}>אין שליחים</div>
              )}
            </div>

            {/* Courier detail */}
            <div>
              {selectedCourierData ? (
                <CourierDetail c={selectedCourierData} records={records.filter((r) => (r.courierName ?? "—ללא שליח—") === selectedCourierData.courierName)} zones={zones} />
              ) : (
                <div className="sc-detail-placeholder">
                  <Users size={40} />
                  <div>בחר שליח מהרשימה לצפייה בפרטים</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Zones ──────────────────────────────────────────────────────── */}
      {activeTab === "zones" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
            <div className="sc-side-list">
              <div className="sc-side-list__title">אזורים ({byZone.length})</div>
              {byZone.map((z) => (
                <div
                  key={z.zoneId ?? "__none__"}
                  className={`sc-side-item ${selectedZone === (z.zoneId ?? z.zoneName) ? "sc-side-item--active" : ""}`}
                  onClick={() => setSelectedZone(selectedZone === (z.zoneId ?? z.zoneName) ? null : (z.zoneId ?? z.zoneName))}
                >
                  <div className="sc-side-item__name">{z.zoneName}</div>
                  <div className="sc-side-item__meta">
                    {z.totalShipments} משלוחים · {z.couriers.length} שליחים
                  </div>
                </div>
              ))}
            </div>

            <div>
              {selectedZoneData ? (
                <ZoneDetail z={selectedZoneData} records={records.filter((r) => (r.zoneId ?? "__none__") === (selectedZoneData.zoneId ?? "__none__"))} />
              ) : (
                <div className="sc-detail-placeholder">
                  <MapPin size={40} />
                  <div>בחר אזור מהרשימה לצפייה בפרטים</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Exceptions ─────────────────────────────────────────────────── */}
      {activeTab === "exceptions" && (
        <div>
          {exceptions.length === 0 ? (
            <div className="shp-empty">
              <div className="shp-empty__icon"><CheckCircle size={48} style={{ color: "#15803d" }} /></div>
              <div className="shp-empty__title">אין חריגות!</div>
              <div className="shp-empty__sub">כל המשלוחים תקינים</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {exceptions.map((ex) => (
                <ExceptionCard key={ex.type} ex={ex} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Payment Breakdown Table ─────────────────────────────────────── */}
      <PaymentBreakdownTable records={records} onChanged={refreshCurrent} />

      {activeKpi && (
        <ShipmentControlKpiModal
          kpiKey={activeKpi}
          records={records}
          zones={zones}
          courierOptions={courierOptions}
          canWrite
          onClose={() => setActiveKpi(null)}
          onChanged={refreshCurrent}
        />
      )}

      {shipmentsModalOpen && (
        <ShipmentControlShipmentsModal
          records={records}
          onClose={() => setShipmentsModalOpen(false)}
          onChanged={refreshCurrent}
        />
      )}

      {containersModalOpen && (
        <ContainersModal
          batches={batches}
          records={records}
          batchExpenses={batchExpenses}
          onBatchExpenseChanged={handleBatchExpenseChanged}
          onClose={() => setContainersModalOpen(false)}
        />
      )}

      {expensesManageModalOpen && (
        <ShipmentExpensesManageModal
          batches={batches}
          records={records}
          batchExpenses={batchExpenses}
          totalExpensesIls={kpis.totalExpensesIls ?? 0}
          onClose={() => setExpensesManageModalOpen(false)}
          onBatchExpensesChanged={handleBatchExpenseChanged}
          onRecordExpensesChanged={handleRecordExpenseChanged}
        />
      )}
    </div>
  );
}

// ─── Containers (Batches) Modal ───────────────────────────────────────────────

type BatchSummary = {
  id: string;
  batchNumber: string;
  containerNumber: string | null;
  recordCount: number;
  totalBoxes: number;
  totalFeeIls: number;
  totalPaidIls: number;
  remainingIls: number;
  deliveredCount: number;
  expenseTotalIls: number;
  expenseTotalUsd: number;
  expenses: ShipmentBatchExpenseDto[];
};

function ContainersModal({
  batches,
  records,
  batchExpenses: initialBatchExpenses,
  onBatchExpenseChanged,
  onClose,
}: {
  batches: { id: string; batchNumber: string; containerNumber: string | null }[];
  records: ShipmentControlRecord[];
  batchExpenses: ShipmentBatchExpenseSummary[];
  onBatchExpenseChanged: (batchId: string, expenses: ShipmentBatchExpenseDto[]) => void;
  onClose: () => void;
}) {
  const [batchExpenses, setBatchExpenses] = useState(initialBatchExpenses);
  const [addFor, setAddFor] = useState<BatchSummary | null>(null);
  const [detailFor, setDetailFor] = useState<BatchSummary | null>(null);

  useEffect(() => {
    setBatchExpenses(initialBatchExpenses);
  }, [initialBatchExpenses]);

  const expenseByBatchId = useMemo(() => {
    const map = new Map<string, ShipmentBatchExpenseSummary>();
    for (const b of batchExpenses) map.set(b.batchId, b);
    return map;
  }, [batchExpenses]);

  const summaries: BatchSummary[] = useMemo(() => {
    const byBatch = new Map<string, ShipmentControlRecord[]>();
    for (const r of records) {
      const list = byBatch.get(r.batchId) ?? [];
      list.push(r);
      byBatch.set(r.batchId, list);
    }
    return batches.map((b) => {
      const recs = byBatch.get(b.id) ?? [];
      let totalBoxes = 0, totalFeeIls = 0, totalPaidIls = 0, deliveredCount = 0;
      for (const r of recs) {
        totalBoxes += r.boxes ?? 0;
        totalFeeIls += r.deliveryFeeIls ?? 0;
        totalPaidIls += r.paidAmountIls;
        if (r.status === "DELIVERED" || r.status === "COMPLETED") deliveredCount++;
      }
      const exp = expenseByBatchId.get(b.id);
      return {
        ...b,
        recordCount: recs.length,
        totalBoxes,
        totalFeeIls,
        totalPaidIls,
        remainingIls: totalFeeIls - totalPaidIls,
        deliveredCount,
        expenseTotalIls: exp?.totalIls ?? 0,
        expenseTotalUsd: exp?.totalUsd ?? 0,
        expenses: exp?.expenses ?? [],
      };
    });
  }, [batches, records, expenseByBatchId]);

  const totals = useMemo(() => {
    let recordCount = 0, totalBoxes = 0, totalFeeIls = 0, totalPaidIls = 0, deliveredCount = 0;
    let expenseTotalIls = 0, expenseTotalUsd = 0;
    for (const s of summaries) {
      recordCount += s.recordCount;
      totalBoxes += s.totalBoxes;
      totalFeeIls += s.totalFeeIls;
      totalPaidIls += s.totalPaidIls;
      deliveredCount += s.deliveredCount;
      expenseTotalIls += s.expenseTotalIls;
      expenseTotalUsd += s.expenseTotalUsd;
    }
    return {
      recordCount, totalBoxes, totalFeeIls, totalPaidIls,
      remainingIls: totalFeeIls - totalPaidIls, deliveredCount,
      expenseTotalIls: Math.round(expenseTotalIls * 100) / 100,
      expenseTotalUsd: Math.round(expenseTotalUsd * 100) / 100,
    };
  }, [summaries]);

  function batchLabel(s: BatchSummary) {
    return s.containerNumber
      ? `${s.batchNumber} · ${s.containerNumber}`
      : s.batchNumber;
  }

  function applyExpense(batchId: string, expense: ShipmentBatchExpenseDto) {
    setBatchExpenses((prev) => {
      const existing = prev.find((b) => b.batchId === batchId);
      const expenses = existing
        ? [expense, ...existing.expenses]
        : [expense];
      let totalIls = 0;
      let totalUsd = 0;
      for (const e of expenses) {
        if (e.currency === "USD") totalUsd += e.amount;
        else totalIls += e.amount;
      }
      const summary: ShipmentBatchExpenseSummary = {
        batchId,
        expenses,
        totalIls: Math.round(totalIls * 100) / 100,
        totalUsd: Math.round(totalUsd * 100) / 100,
        count: expenses.length,
      };
      const next = prev.some((b) => b.batchId === batchId)
        ? prev.map((b) => (b.batchId === batchId ? summary : b))
        : [...prev, summary];
      onBatchExpenseChanged(batchId, expenses);
      return next;
    });
    setDetailFor((prev) =>
      prev && prev.id === batchId
        ? {
            ...prev,
            expenses: [expense, ...prev.expenses],
            expenseTotalIls:
              expense.currency === "ILS"
                ? Math.round((prev.expenseTotalIls + expense.amount) * 100) / 100
                : prev.expenseTotalIls,
            expenseTotalUsd:
              expense.currency === "USD"
                ? Math.round((prev.expenseTotalUsd + expense.amount) * 100) / 100
                : prev.expenseTotalUsd,
          }
        : prev,
    );
  }

  function fm(n: number) {
    return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function openExpenseFlow(s: BatchSummary) {
    if (s.expenses.length > 0) setDetailFor(s);
    else setAddFor(s);
  }

  return (
    <>
      <div className="shp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="shp-modal" style={{ maxWidth: 980, width: "96vw" }} dir="rtl" onClick={(e) => e.stopPropagation()}>
          <div className="shp-modal__header">
            <strong>פירוט משלוחים (קונטיינרים)</strong>
            <span style={{ fontSize: "0.82rem", color: "#64748b", marginInlineStart: 8 }}>
              {summaries.length} משלוחים · {totals.recordCount} חבילות
            </span>
            <button type="button" className="shp-icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="shp-modal__body" style={{ maxHeight: "65vh", overflowY: "auto" }}>
            <table className="shp-table" style={{ fontSize: "0.84rem" }}>
              <thead>
                <tr>
                  <th>מספר משלוח</th>
                  <th>מספר קונטיינר</th>
                  <th style={{ textAlign: "center" }}>חבילות</th>
                  <th style={{ textAlign: "center" }}>קרטונים</th>
                  <th style={{ textAlign: "center" }}>נמסרו</th>
                  <th style={{ textAlign: "center" }}>דמי משלוח</th>
                  <th style={{ textAlign: "center" }}>נגבה</th>
                  <th style={{ textAlign: "center" }}>יתרה</th>
                  <th style={{ textAlign: "center", background: "#fff7ed" }}>הוצאות</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 700, color: "#1d4ed8" }}>{s.batchNumber}</td>
                    <td style={{ fontWeight: 600 }}>{s.containerNumber || "—"}</td>
                    <td style={{ textAlign: "center" }}>{s.recordCount}</td>
                    <td style={{ textAlign: "center" }}>{s.totalBoxes}</td>
                    <td style={{ textAlign: "center", color: "#15803d", fontWeight: 600 }}>{s.deliveredCount}</td>
                    <td style={{ textAlign: "center", fontWeight: 600 }}>{fm(s.totalFeeIls)}</td>
                    <td style={{ textAlign: "center", fontWeight: 600, color: "#15803d" }}>{fm(s.totalPaidIls)}</td>
                    <td style={{ textAlign: "center", fontWeight: 700, color: s.remainingIls > 0.01 ? "#dc2626" : "#15803d" }}>{fm(s.remainingIls)}</td>
                    <td style={{ textAlign: "center", background: "#fffbeb" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <button
                          type="button"
                          className="shp-btn shp-btn--link"
                          style={{ padding: "2px 6px", fontWeight: 700, color: "#b45309", whiteSpace: "pre-line" }}
                          onClick={() => openExpenseFlow(s)}
                          title={s.expenses.length > 0 ? "הצג פירוט הוצאות" : "הוסף הוצאה"}
                        >
                          {fmtExpenseTotals(s.expenseTotalIls, s.expenseTotalUsd)}
                        </button>
                        <button
                          type="button"
                          className="shp-btn shp-btn--sm"
                          title="הוסף הוצאה"
                          onClick={() => setAddFor(s)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800, background: "#f1f5f9" }}>
                  <td colSpan={2} style={{ fontWeight: 800 }}>סה״כ ({summaries.length} משלוחים)</td>
                  <td style={{ textAlign: "center" }}>{totals.recordCount}</td>
                  <td style={{ textAlign: "center" }}>{totals.totalBoxes}</td>
                  <td style={{ textAlign: "center", color: "#15803d" }}>{totals.deliveredCount}</td>
                  <td style={{ textAlign: "center" }}>{fm(totals.totalFeeIls)}</td>
                  <td style={{ textAlign: "center", color: "#15803d" }}>{fm(totals.totalPaidIls)}</td>
                  <td style={{ textAlign: "center", color: totals.remainingIls > 0.01 ? "#dc2626" : "#15803d" }}>{fm(totals.remainingIls)}</td>
                  <td style={{ textAlign: "center", fontWeight: 800, color: "#b45309", whiteSpace: "pre-line", background: "#fff7ed" }}>
                    {fmtExpenseTotals(totals.expenseTotalIls, totals.expenseTotalUsd)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="shp-modal__footer">
            <button type="button" className="shp-btn" onClick={onClose}>סגור</button>
          </div>
        </div>
      </div>

      {addFor && (
        <ShipmentBatchExpenseFormModal
          batchId={addFor.id}
          batchLabel={batchLabel(addFor)}
          layer={detailFor ? "nested-deep" : "nested"}
          onClose={() => setAddFor(null)}
          onSaved={(expense) => {
            applyExpense(addFor.id, expense);
            setAddFor(null);
          }}
        />
      )}

      {detailFor && (
        <ShipmentBatchExpensesDetailModal
          batchLabel={batchLabel(detailFor)}
          expenses={detailFor.expenses}
          totalIls={detailFor.expenseTotalIls}
          totalUsd={detailFor.expenseTotalUsd}
          onClose={() => setDetailFor(null)}
          onAdd={() => {
            setAddFor(detailFor);
          }}
        />
      )}
    </>
  );
}

// ─── Payment Breakdown Table ──────────────────────────────────────────────────

const BREAKDOWN_METHODS = [
  { key: "CASH", label: "מזומן" },
  { key: "BANK_TRANSFER", label: "העברה" },
  { key: "CREDIT", label: "אשראי" },
  { key: "CHECK", label: "צ׳ק" },
  { key: "CODE_DEDUCTION", label: "משיכה מהקוד" },
  { key: "CREDIT_NOTE", label: "זיכוי" },
] as const;

type BreakdownRow = {
  record: ShipmentControlRecord;
  fee: number;
  byMethod: Record<string, number>;
  expenses: number;
  toPay: number;
  balance: number;
  lastPayDate: string | null;
};

type DrillTarget = { recordId: string; method: string | null; label: string } | null;

function PaymentBreakdownTable({
  records,
}: {
  records: ShipmentControlRecord[];
  onChanged?: () => void;
}) {
  const [drill, setDrill] = useState<DrillTarget>(null);

  const rows: BreakdownRow[] = useMemo(() => {
    return records.map((r) => {
      const fee = r.deliveryFeeIls ?? 0;
      const byMethod: Record<string, number> = {};
      for (const m of BREAKDOWN_METHODS) byMethod[m.key] = 0;
      let lastPayDate: string | null = null;
      for (const p of r.payments) {
        byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountIls;
        if (!lastPayDate || p.createdAt > lastPayDate) lastPayDate = p.createdAt;
      }
      const expenses = r.expensesTotalIls ?? 0;
      const totalPaid = r.paidAmountIls;
      const toPay = Math.max(0, fee - totalPaid);
      const balance = fee - expenses;
      return { record: r, fee, byMethod, expenses, toPay, balance, lastPayDate };
    });
  }, [records]);

  const totals = useMemo(() => {
    const t = { fee: 0, byMethod: {} as Record<string, number>, expenses: 0, toPay: 0, balance: 0 };
    for (const m of BREAKDOWN_METHODS) t.byMethod[m.key] = 0;
    for (const row of rows) {
      t.fee += row.fee;
      for (const m of BREAKDOWN_METHODS) t.byMethod[m.key] += row.byMethod[m.key] ?? 0;
      t.expenses += row.expenses;
      t.toPay += row.toPay;
      t.balance += row.balance;
    }
    return t;
  }, [rows]);

  const drillRecord = drill ? records.find((r) => r.id === drill.recordId) : null;

  function fm(n: number) {
    return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return (
    <>
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Banknote size={18} style={{ color: "#2563eb" }} />
          בקרת משלוחים
        </h2>
        <div className="shp-table-wrap" style={{ maxHeight: "70vh" }}>
          <table className="shp-table" style={{ fontSize: "0.82rem" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>מספר משלוח</th>
                <th style={{ whiteSpace: "nowrap" }}>תאריך</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "center" }}>סך הכול</th>
                {BREAKDOWN_METHODS.map((m) => (
                  <th key={m.key} style={{ whiteSpace: "nowrap", textAlign: "center" }}>{m.label}</th>
                ))}
                <th style={{ whiteSpace: "nowrap", textAlign: "center", background: "#fff7ed" }}>הוצאות</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "center" }}>יתרה לתשלום</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "center" }}>יתרה</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3 + BREAKDOWN_METHODS.length + 3} style={{ textAlign: "center", padding: 28, color: "#94a3b8" }}>
                    אין נתונים
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.record.id}>
                  <td style={{ fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>
                    {row.record.batchNumber}
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
                    {row.lastPayDate ? formatDate(row.lastPayDate) : formatDate(row.record.createdAt)}
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{fm(row.fee)}</td>
                  {BREAKDOWN_METHODS.map((m) => {
                    const v = row.byMethod[m.key] ?? 0;
                    return (
                      <td key={m.key} style={{ textAlign: "center", fontWeight: 600 }}>
                        <button
                          type="button"
                          className="sc-bd-cell"
                          style={{ color: v > 0 ? "#1e293b" : "#cbd5e1" }}
                          disabled={v === 0}
                          onClick={() => v > 0 && setDrill({ recordId: row.record.id, method: m.key, label: m.label })}
                        >
                          {fm(v)}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "center", fontWeight: 600, background: "#fffbeb" }}>
                    <button
                      type="button"
                      className="sc-bd-cell"
                      style={{ color: row.expenses > 0 ? "#b45309" : "#cbd5e1" }}
                      disabled={row.expenses === 0}
                      onClick={() => row.expenses > 0 && setDrill({ recordId: row.record.id, method: null, label: "הוצאות" })}
                    >
                      {fm(row.expenses)}
                    </button>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: row.toPay > 0.01 ? "#dc2626" : "#15803d" }}>
                    {fm(row.toPay)}
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: row.balance < -0.01 ? "#dc2626" : "#15803d" }}>
                    {fm(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
                <tr style={{ fontWeight: 800, background: "#f1f5f9", fontSize: "0.85rem" }}>
                  <td colSpan={2} style={{ fontWeight: 800 }}>סיכום ({rows.length})</td>
                  <td style={{ textAlign: "center" }}>{fm(totals.fee)}</td>
                  {BREAKDOWN_METHODS.map((m) => (
                    <td key={m.key} style={{ textAlign: "center" }}>{fm(totals.byMethod[m.key] ?? 0)}</td>
                  ))}
                  <td style={{ textAlign: "center", background: "#fff7ed", color: "#b45309" }}>{fm(totals.expenses)}</td>
                  <td style={{ textAlign: "center", color: totals.toPay > 0.01 ? "#dc2626" : "#15803d" }}>{fm(totals.toPay)}</td>
                  <td style={{ textAlign: "center", color: totals.balance < -0.01 ? "#dc2626" : "#15803d" }}>{fm(totals.balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Drill-down modal ── */}
      {drill && drillRecord && (
        <div className="shp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setDrill(null)}>
          <div className="shp-modal" style={{ maxWidth: 640, width: "96vw" }} dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="shp-modal__header">
              <strong>{drill.label}</strong>
              <span style={{ fontSize: "0.8rem", color: "#64748b", marginInlineStart: 8 }}>
                {drillRecord.batchNumber} — {drillRecord.customerName || "—"}
              </span>
              <button type="button" className="shp-icon-btn" onClick={() => setDrill(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="shp-modal__body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {drill.method !== null ? (
                /* Payment drill */
                <table className="shp-table shp-table--compact" style={{ fontSize: "0.82rem" }}>
                  <thead>
                    <tr>
                      <th>לקוח</th>
                      <th>מספר משלוח</th>
                      <th>תאריך תשלום</th>
                      <th>סכום</th>
                      <th>אמצעי תשלום</th>
                      <th>הערה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillRecord.payments
                      .filter((p) => p.method === drill.method)
                      .map((p) => (
                        <tr key={p.id}>
                          <td>{drillRecord.customerName || "—"}</td>
                          <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{drillRecord.batchNumber}</td>
                          <td>{formatDate(p.createdAt)}</td>
                          <td style={{ fontWeight: 700 }}>{fm(p.amountIls)}</td>
                          <td>{p.methodLabel}</td>
                          <td style={{ color: "#64748b", fontSize: "0.78rem" }}>{p.notes || "—"}</td>
                        </tr>
                      ))}
                    {drillRecord.payments.filter((p) => p.method === drill.method).length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: "center", color: "#94a3b8", padding: 20 }}>אין תשלומים</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                /* Expenses drill */
                <table className="shp-table shp-table--compact" style={{ fontSize: "0.82rem" }}>
                  <thead>
                    <tr>
                      <th>סוג הוצאה</th>
                      <th>סכום</th>
                      <th>צורת תשלום</th>
                      <th>תאריך</th>
                      <th>הערה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drillRecord.expenses ?? []).map((e) => (
                      <tr key={e.id}>
                        <td>{e.categoryLabel}</td>
                        <td style={{ fontWeight: 700 }}>{fm(e.amountIls)}</td>
                        <td>{e.paymentMethodLabel}</td>
                        <td>{e.expenseDate}</td>
                        <td style={{ color: "#64748b", fontSize: "0.78rem" }}>{e.notes || "—"}</td>
                      </tr>
                    ))}
                    {(drillRecord.expenses ?? []).length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: "center", color: "#94a3b8", padding: 20 }}>אין הוצאות</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <div className="shp-modal__footer">
              <button type="button" className="shp-btn" onClick={() => setDrill(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Courier detail panel ─────────────────────────────────────────────────────

function weekNumber(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
}

function CourierDetail({
  c,
  records,
  zones,
}: {
  c: CourierSummary;
  records: ShipmentControlRecord[];
  zones: { id: string; name: string }[];
}) {
  function fmtI(n: number) { return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2 }); }

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fWeek, setFWeek] = useState("");
  const [fBatch, setFBatch] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fZone, setFZone] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fPayStatus, setFPayStatus] = useState("");
  const [fPayMethod, setFPayMethod] = useState("");
  const [fCity, setFCity] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    let result = records;
    if (dateFrom) result = result.filter((r) => r.createdAt >= dateFrom);
    if (dateTo) result = result.filter((r) => r.createdAt <= dateTo + "T23:59:59");
    if (fWeek) {
      const wk = Number(fWeek);
      result = result.filter((r) => weekNumber(r.createdAt) === wk);
    }
    if (fBatch) {
      const q = fBatch.toLowerCase();
      result = result.filter((r) => r.batchNumber.toLowerCase().includes(q));
    }
    if (fCustomer) {
      const q = fCustomer.toLowerCase();
      result = result.filter((r) => (r.customerName ?? "").toLowerCase().includes(q) || (r.customerCode ?? "").toLowerCase().includes(q));
    }
    if (fZone) result = result.filter((r) => r.zoneId === fZone);
    if (fStatus) result = result.filter((r) => r.status === fStatus);
    if (fPayStatus) result = result.filter((r) => r.paymentStatus === fPayStatus);
    if (fPayMethod) result = result.filter((r) => r.payments.some((p) => p.method === fPayMethod));
    if (fCity) result = result.filter((r) => (r.updatedDeliveryLocation ?? r.city ?? "").toUpperCase() === fCity);
    if (fSearch.trim()) {
      const q = fSearch.trim().toLowerCase();
      result = result.filter((r) =>
        [r.batchNumber, r.customerName, r.customerCode, r.customerPhone, r.address, r.city, r.updatedDeliveryLocation, r.zoneName, r.containerNumber, r.notes]
          .filter(Boolean).join(" ").toLowerCase().includes(q),
      );
    }
    return result;
  }, [records, dateFrom, dateTo, fWeek, fBatch, fCustomer, fZone, fStatus, fPayStatus, fPayMethod, fCity, fSearch]);

  const kpis = useMemo(() => {
    let shipments = 0, boxes = 0, fee = 0, paid = 0, unpaid = 0, partial = 0, paidCount = 0;
    let delivered = 0, notDelivered = 0, returned = 0;
    for (const r of filtered) {
      shipments++;
      boxes += r.boxes ?? 0;
      fee += r.deliveryFeeIls ?? 0;
      paid += r.paidAmountIls;
      if (r.paymentStatus === "UNPAID") unpaid++;
      else if (r.paymentStatus === "PARTIAL") partial++;
      else if (r.paymentStatus === "PAID") paidCount++;
      if (r.status === "DELIVERED" || r.status === "COMPLETED") delivered++;
      if (r.status === "NOT_DELIVERED") notDelivered++;
      if (r.status === "RETURNED") returned++;
    }
    const remaining = Math.max(0, fee - paid);
    const deliveryRate = shipments > 0 ? Math.round((delivered / shipments) * 100) : 0;
    const collectionRate = fee > 0 ? Math.round((paid / fee) * 100) : 0;
    return { shipments, boxes, fee, paid, remaining, unpaid, partial, paidCount, delivered, notDelivered, returned, deliveryRate, collectionRate };
  }, [filtered]);

  const clearFilters = () => {
    setDateFrom(""); setDateTo(""); setFWeek(""); setFBatch(""); setFCustomer("");
    setFZone(""); setFStatus(""); setFPayStatus(""); setFPayMethod(""); setFCity(""); setFSearch("");
  };

  const hasFilters = dateFrom || dateTo || fWeek || fBatch || fCustomer || fZone || fStatus || fPayStatus || fPayMethod || fCity || fSearch;

  async function handleExportPdf() {
    setExporting(true);
    try {
      await exportShipmentReportPdf({
        kind: "all",
        records: filtered,
        filters: { dateFrom, dateTo, containerNumber: "", zoneId: fZone, courierName: c.courierName, status: fStatus, paymentScope: "all" },
        meta: { companyName: "WEGO", generatedBy: c.courierName, generatedAt: new Date() },
      });
    } finally { setExporting(false); }
  }

  async function handleExportExcel() {
    setExporting(true);
    try {
      await exportShipmentReportExcel({
        kind: "all",
        records: filtered,
        filters: { dateFrom, dateTo, containerNumber: "", zoneId: fZone, courierName: c.courierName, status: fStatus, paymentScope: "all" },
        meta: { companyName: "WEGO", generatedBy: c.courierName, generatedAt: new Date() },
      });
    } finally { setExporting(false); }
  }

  const uniqueZoneIds = useMemo(() => [...new Set(records.map((r) => r.zoneId).filter(Boolean) as string[])], [records]);

  return (
    <div className="sc-detail-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 className="sc-detail-title"><Users size={16} /> {c.courierName}</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="shp-btn shp-btn--sm" disabled={exporting || filtered.length === 0} onClick={() => void handleExportPdf()}>
            <FileText size={13} /> PDF
          </button>
          <button className="shp-btn shp-btn--sm" disabled={exporting || filtered.length === 0} onClick={() => void handleExportExcel()}>
            <FileSpreadsheet size={13} /> Excel
          </button>
        </div>
      </div>

      {/* ── KPI Summary ── */}
      <div className="sc-detail-kpis">
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{kpis.shipments}</div><div className="sc-detail-kpi__l">משלוחים</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{kpis.boxes}</div><div className="sc-detail-kpi__l">חבילות</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#15803d" }}>{kpis.delivered}</div><div className="sc-detail-kpi__l">נמסרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#dc2626" }}>{kpis.notDelivered}</div><div className="sc-detail-kpi__l">לא נמסרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#9d174d" }}>{kpis.returned}</div><div className="sc-detail-kpi__l">חזרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{kpis.deliveryRate}%</div><div className="sc-detail-kpi__l">אחוז מסירה</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{fmtI(kpis.fee)}</div><div className="sc-detail-kpi__l">דמי משלוח</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#15803d" }}>{fmtI(kpis.paid)}</div><div className="sc-detail-kpi__l">נגבה</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: kpis.remaining > 0 ? "#dc2626" : "#15803d" }}>{fmtI(kpis.remaining)}</div><div className="sc-detail-kpi__l">יתרה</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{kpis.collectionRate}%</div><div className="sc-detail-kpi__l">אחוז גבייה</div></div>
      </div>

      {/* ── Payment status counts ── */}
      <div style={{ display: "flex", gap: 12, fontSize: "0.82rem", marginTop: 4, flexWrap: "wrap" }}>
        <span style={{ color: "#15803d" }}>שולמו: <strong>{kpis.paidCount}</strong></span>
        <span style={{ color: "#d97706" }}>חלקי: <strong>{kpis.partial}</strong></span>
        <span style={{ color: "#dc2626" }}>לא שולמו: <strong>{kpis.unpaid}</strong></span>
      </div>

      {/* ── Filter bar ── */}
      <div className="sc-filter-bar" style={{ marginTop: 12, padding: "8px 10px", gap: 6, fontSize: "0.8rem" }}>
        <Filter size={12} style={{ color: "#64748b", flexShrink: 0 }} />
        <div className="sc-filter-group" style={{ gap: 4 }}>
          <span className="sc-filter-label" style={{ fontSize: "0.72rem" }}>מ:</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }} />
          <span className="sc-filter-label" style={{ fontSize: "0.72rem" }}>עד:</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }} />
        </div>
        <input placeholder="שבוע" type="number" min={1} max={53} value={fWeek} onChange={(e) => setFWeek(e.target.value)} style={{ width: 56, fontSize: "0.78rem", padding: "3px 4px" }} />
        <input placeholder="מס׳ משלוח" value={fBatch} onChange={(e) => setFBatch(e.target.value)} style={{ width: 80, fontSize: "0.78rem", padding: "3px 4px" }} />
        <input placeholder="לקוח" value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} style={{ width: 80, fontSize: "0.78rem", padding: "3px 4px" }} />
        <select value={fZone} onChange={(e) => setFZone(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }}>
          <option value="">כל האזורים</option>
          {zones.filter((z) => uniqueZoneIds.includes(z.id)).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }}>
          <option value="">סטטוס</option>
          {(Object.entries(SHIPMENT_STATUS_LABELS) as [string, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={fPayStatus} onChange={(e) => setFPayStatus(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }}>
          <option value="">תשלום</option>
          <option value="PAID">שולם</option>
          <option value="PARTIAL">חלקי</option>
          <option value="UNPAID">לא שולם</option>
        </select>
        <select value={fPayMethod} onChange={(e) => setFPayMethod(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }}>
          <option value="">צורת תשלום</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={fCity} onChange={(e) => setFCity(e.target.value)} style={{ fontSize: "0.78rem", padding: "3px 4px" }}>
          <option value="">עיר</option>
          <option value="PS">PS</option>
          <option value="IL">IL</option>
        </select>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Search size={11} style={{ position: "absolute", insetInlineStart: 6, color: "#94a3b8", pointerEvents: "none" }} />
          <input placeholder="חיפוש חופשי" value={fSearch} onChange={(e) => setFSearch(e.target.value)} style={{ paddingInlineStart: 22, width: 110, fontSize: "0.78rem", padding: "3px 4px 3px 22px" }} />
        </div>
        {hasFilters && (
          <button type="button" className="shp-btn shp-btn--sm" onClick={clearFilters} style={{ fontSize: "0.72rem", padding: "2px 8px" }}>
            נקה
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="shp-table-wrap" style={{ marginTop: 10 }}>
        <table className="shp-table shp-table--compact">
          <thead>
            <tr>
              <th>משלוח</th>
              <th>תאריך</th>
              <th>שבוע</th>
              <th>לקוח</th>
              <th>אזור</th>
              <th>חבילות</th>
              <th>דמי משלוח</th>
              <th>שולם</th>
              <th>יתרה</th>
              <th>סטטוס</th>
              <th>תשלום</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 28, color: "#94a3b8" }}>
                  אין משלוחים להצגה
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{r.batchNumber}</td>
                <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{formatDate(r.createdAt)}</td>
                <td style={{ textAlign: "center", fontSize: "0.78rem" }}>{weekNumber(r.createdAt) ?? "—"}</td>
                <td>{r.customerName || "—"}</td>
                <td>{r.zoneName || "—"}</td>
                <td style={{ textAlign: "center" }}>{r.boxes ?? "—"}</td>
                <td>{r.deliveryFeeIls != null ? fmtI(r.deliveryFeeIls) : "—"}</td>
                <td style={{ color: "#15803d" }}>{r.paidAmountIls > 0 ? fmtI(r.paidAmountIls) : "—"}</td>
                <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d" }}>{r.remainingFeeIls > 0 ? fmtI(r.remainingFeeIls) : "✓"}</td>
                <td><span className={`shp-badge shp-badge--${r.status.toLowerCase()}`}>{SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}</span></td>
                <td><span className={`shp-badge shp-badge--${r.paymentStatus.toLowerCase()}`}>{SHIPMENT_PAYMENT_STATUS_LABELS[r.paymentStatus as "UNPAID" | "PARTIAL" | "PAID"] ?? r.paymentStatus}</span></td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 700, background: "#f1f5f9" }}>
                <td>סיכום ({filtered.length})</td>
                <td />
                <td />
                <td />
                <td />
                <td style={{ textAlign: "center" }}>{kpis.boxes}</td>
                <td>{fmtI(kpis.fee)}</td>
                <td style={{ color: "#15803d" }}>{fmtI(kpis.paid)}</td>
                <td style={{ color: kpis.remaining > 0 ? "#dc2626" : "#15803d" }}>{fmtI(kpis.remaining)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Zone detail panel ────────────────────────────────────────────────────────

function ZoneDetail({ z, records }: { z: ZoneSummary; records: ShipmentControlRecord[] }) {
  function fmtIls(n: number) { return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2 }); }
  return (
    <div className="sc-detail-panel">
      <h3 className="sc-detail-title"><MapPin size={16} /> {z.zoneName}</h3>
      <div className="sc-detail-kpis">
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{z.totalShipments}</div><div className="sc-detail-kpi__l">משלוחים</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#15803d" }}>{z.delivered}</div><div className="sc-detail-kpi__l">נמסרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#dc2626" }}>{z.notDelivered}</div><div className="sc-detail-kpi__l">לא נמסרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{fmtIls(z.totalFeeIls)}</div><div className="sc-detail-kpi__l">לגבות</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#15803d" }}>{fmtIls(z.totalPaidIls)}</div><div className="sc-detail-kpi__l">נגבה</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: z.remainingIls > 0 ? "#dc2626" : "#15803d" }}>{fmtIls(z.remainingIls)}</div><div className="sc-detail-kpi__l">יתרה</div></div>
      </div>
      <div style={{ marginTop: 10, fontSize: "0.85rem", color: "#374151" }}>
        <strong>שליחים:</strong> {z.couriers.length > 0 ? z.couriers.join(", ") : "—"}
      </div>
      <div className="shp-table-wrap" style={{ marginTop: 16 }}>
        <table className="shp-table shp-table--compact">
          <thead>
            <tr><th>משלוח</th><th>לקוח</th><th>שליח</th><th>דמי משלוח</th><th>שולם</th><th>יתרה</th><th>סטטוס</th></tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{r.batchNumber}</td>
                <td>{r.customerName || "—"}</td>
                <td>{r.courierName || "—"}</td>
                <td>{r.deliveryFeeIls != null ? "₪" + r.deliveryFeeIls : "—"}</td>
                <td style={{ color: "#15803d" }}>{r.paidAmountIls > 0 ? "₪" + r.paidAmountIls : "—"}</td>
                <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d" }}>{r.remainingFeeIls > 0 ? "₪" + r.remainingFeeIls : "✓"}</td>
                <td><span className={`shp-badge shp-badge--${r.status.toLowerCase()}`}>{SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Exception card ───────────────────────────────────────────────────────────

const EXCEPTION_COLORS: Record<string, string> = {
  no_courier: "#d97706",
  no_zone: "#d97706",
  no_payment: "#dc2626",
  delivered_not_paid: "#dc2626",
  returned: "#9d174d",
  fee_mismatch: "#7c3aed",
};

function ExceptionCard({ ex }: { ex: ShipmentException }) {
  const [open, setOpen] = useState(false);
  const color = EXCEPTION_COLORS[ex.type] ?? "#64748b";
  return (
    <div className="sc-exception-card" style={{ borderRight: `4px solid ${color}` }}>
      <div className="sc-exception-card__header" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <AlertTriangle size={16} style={{ color }} />
        <span className="sc-exception-card__title" style={{ color }}>{ex.label}</span>
        <span className="sc-exception-card__count" style={{ background: color }}>{ex.count}</span>
        <span style={{ marginRight: "auto", color: "#94a3b8" }}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      {open && (
        <div className="sc-exception-card__body">
          <table className="shp-table shp-table--compact">
            <thead>
              <tr><th>משלוח</th><th>לקוח</th><th>שליח</th><th>אזור</th><th>דמי משלוח</th><th>שולם</th><th>סטטוס</th></tr>
            </thead>
            <tbody>
              {ex.records.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{r.batchNumber}</td>
                  <td>{r.customerName || "—"}</td>
                  <td>{r.courierName || "—"}</td>
                  <td>{r.zoneName || "—"}</td>
                  <td>{r.deliveryFeeIls != null ? "₪" + r.deliveryFeeIls : "—"}</td>
                  <td style={{ color: "#15803d" }}>{r.paidAmountIls > 0 ? "₪" + r.paidAmountIls : "—"}</td>
                  <td><span className={`shp-badge shp-badge--${r.status.toLowerCase()}`}>{SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

