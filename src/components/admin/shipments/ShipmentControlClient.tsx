"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import {
  Truck, RefreshCw, Filter, ChevronDown, ChevronUp,
  AlertTriangle, Users, MapPin, Package, Banknote,
  CheckCircle, XCircle, Clock, RotateCcw, FileText,
  TrendingUp, BarChart3, Download, FileSpreadsheet,
} from "lucide-react";
import { getShipmentControlDataAction } from "@/app/admin/shipments/control/actions";
import type {
  ShipmentControlPayload,
  ShipmentControlFilter,
  ShipmentControlRecord,
  CourierSummary,
  ZoneSummary,
  ShipmentException,
} from "@/app/admin/shipments/control/types";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@/app/admin/shipments/types";
import type { ShipmentStatus } from "@/app/admin/shipments/types";
import {
  ShipmentControlKpiModal,
  type KpiDrillKey,
} from "@/components/admin/shipments/ShipmentControlKpiModal";
import { ShipmentReportExportModal } from "@/components/admin/shipments/ShipmentReportExportModal";
import type {
  ShipmentReportFormat,
  ShipmentReportKind,
} from "@/lib/shipment-report-export";

type Tab = "overview" | "payments" | "couriers" | "zones" | "exceptions" | "reports";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "סיכום", icon: <BarChart3 size={15} /> },
  { id: "payments", label: "בקרת תשלומים", icon: <Banknote size={15} /> },
  { id: "couriers", label: "לפי שליח", icon: <Users size={15} /> },
  { id: "zones", label: "לפי אזור", icon: <MapPin size={15} /> },
  { id: "exceptions", label: "חריגות", icon: <AlertTriangle size={15} /> },
  { id: "reports", label: "דוחות", icon: <Download size={15} /> },
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
                <div><span className="sc-expand-label">טלפון:</span> {r.customerPhone || "—"}</div>
                <div><span className="sc-expand-label">כתובת:</span> {r.address || "—"}, {r.city || ""}</div>
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
  const [containerNumber, setContainerNumber] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [courierName, setCourierName] = useState("");
  const [batchId, setBatchId] = useState("");

  // Courier/zone drill
  const [selectedCourier, setSelectedCourier] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<KpiDrillKey | null>(null);

  const currentFilter = useCallback((): ShipmentControlFilter => ({
    year: year ? parseInt(year) : undefined,
    month: month ? parseInt(month) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    containerNumber: containerNumber || undefined,
    zoneId: zoneId || undefined,
    courierName: courierName || undefined,
    batchId: batchId || undefined,
  }), [year, month, dateFrom, dateTo, containerNumber, zoneId, courierName, batchId]);

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
    setContainerNumber(""); setZoneId(""); setCourierName(""); setBatchId("");
    refresh({});
  }

  function refreshCurrent() {
    refresh(currentFilter());
  }

  const { kpis, records, byCourier, byZone, exceptions, batches, zones, couriers } = data;
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
          placeholder="קונטיינר..."
          value={containerNumber}
          onChange={(e) => setContainerNumber(e.target.value)}
          style={{ width: 110 }}
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
        {/* Shipments group */}
        <div className="sc-kpi-group">
          <div className="sc-kpi-group__title"><Package size={14} /> משלוחים</div>
          <div className="sc-kpi-row">
            <KpiCard label="סה״כ" value={kpis.total} icon={<Package size={18} />} onClick={() => setActiveKpi("all")} />
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
                <CourierDetail c={selectedCourierData} records={records.filter((r) => (r.courierName ?? "—ללא שליח—") === selectedCourierData.courierName)} />
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

      {/* ── Tab: Reports ────────────────────────────────────────────────────── */}
      {activeTab === "reports" && (
        <ReportsTab
          records={records}
          zones={zones}
          couriers={couriers}
          filter={currentFilter()}
          generatedBy={generatedBy}
        />
      )}

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
    </div>
  );
}

// ─── Courier detail panel ─────────────────────────────────────────────────────

function CourierDetail({ c, records }: { c: CourierSummary; records: ShipmentControlRecord[] }) {
  function fmtIls(n: number) { return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2 }); }
  const deliveryRate = c.totalShipments > 0 ? Math.round((c.delivered / c.totalShipments) * 100) : 0;
  const collectionRate = c.totalFeeIls > 0 ? Math.round((c.totalPaidIls / c.totalFeeIls) * 100) : 0;

  return (
    <div className="sc-detail-panel">
      <h3 className="sc-detail-title"><Users size={16} /> {c.courierName}</h3>
      <div className="sc-detail-kpis">
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{c.totalShipments}</div><div className="sc-detail-kpi__l">משלוחים</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#15803d" }}>{c.delivered}</div><div className="sc-detail-kpi__l">נמסרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#dc2626" }}>{c.notDelivered}</div><div className="sc-detail-kpi__l">לא נמסרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#9d174d" }}>{c.returned}</div><div className="sc-detail-kpi__l">חזרו</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{deliveryRate}%</div><div className="sc-detail-kpi__l">אחוז מסירה</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{fmtIls(c.totalFeeIls)}</div><div className="sc-detail-kpi__l">לגבות</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: "#15803d" }}>{fmtIls(c.totalPaidIls)}</div><div className="sc-detail-kpi__l">גבה</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v" style={{ color: c.remainingIls > 0 ? "#dc2626" : "#15803d" }}>{fmtIls(c.remainingIls)}</div><div className="sc-detail-kpi__l">חסר</div></div>
        <div className="sc-detail-kpi"><div className="sc-detail-kpi__v">{collectionRate}%</div><div className="sc-detail-kpi__l">אחוז גבייה</div></div>
      </div>

      <div className="shp-table-wrap" style={{ marginTop: 16 }}>
        <table className="shp-table shp-table--compact">
          <thead>
            <tr>
              <th>משלוח</th><th>לקוח</th><th>אזור</th><th>דמי משלוח</th><th>שולם</th><th>יתרה</th><th>סטטוס</th><th>תשלום</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{r.batchNumber}</td>
                <td>{r.customerName || "—"}</td>
                <td>{r.zoneName || "—"}</td>
                <td>{r.deliveryFeeIls != null ? "₪" + r.deliveryFeeIls : "—"}</td>
                <td style={{ color: "#15803d" }}>{r.paidAmountIls > 0 ? "₪" + r.paidAmountIls : "—"}</td>
                <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d" }}>{r.remainingFeeIls > 0 ? "₪" + r.remainingFeeIls : "✓"}</td>
                <td><span className={`shp-badge shp-badge--${r.status.toLowerCase()}`}>{SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}</span></td>
                <td><span className={`shp-badge shp-badge--${r.paymentStatus.toLowerCase()}`}>{SHIPMENT_PAYMENT_STATUS_LABELS[r.paymentStatus as "UNPAID" | "PARTIAL" | "PAID"] ?? r.paymentStatus}</span></td>
              </tr>
            ))}
          </tbody>
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

// ─── Reports tab ──────────────────────────────────────────────────────────────

function ReportsTab({
  records,
  zones,
  couriers,
  filter,
  generatedBy,
}: {
  records: ShipmentControlRecord[];
  zones: { id: string; name: string }[];
  couriers: string[];
  filter: ShipmentControlFilter;
  generatedBy: string;
}) {
  const [exportRequest, setExportRequest] = useState<{
    kind: ShipmentReportKind;
    format: ShipmentReportFormat;
  } | null>(null);
  const courierCount = new Set(records.map((record) => record.courierName).filter(Boolean)).size;
  const zoneCount = new Set(records.map((record) => record.zoneId).filter(Boolean)).size;
  const exceptionCount = records.filter((record) =>
    !record.courierName ||
    !record.zoneId ||
    record.paymentStatus === "UNPAID" ||
    record.remainingFeeIls > 0.01 ||
    record.status === "RETURNED"
  ).length;
  const reportItems: Array<{
    kind: ShipmentReportKind;
    label: string;
    sub: string;
    icon: React.ReactNode;
  }> = [
    { kind: "all", label: "כל המשלוחים", sub: `${records.length} שורות`, icon: <Package size={22} /> },
    { kind: "couriers", label: "משלוחים לפי שליח", sub: `${courierCount} שליחים`, icon: <Users size={22} /> },
    { kind: "zones", label: "משלוחים לפי אזור", sub: `${zoneCount} אזורים`, icon: <MapPin size={22} /> },
    { kind: "exceptions", label: "חריגות", sub: `${exceptionCount} משלוחים`, icon: <AlertTriangle size={22} /> },
  ];

  return (
    <div>
      <div className="shp-alert shp-alert--info" style={{ maxWidth: 500, marginBottom: 20 }}>
        <FileText size={15} />
        הפקת דוחות מקצועיים ב־Excel וב־PDF לפי הנתונים המסוננים.
      </div>
      <div className="sc-report-grid">
        {reportItems.map((item) => (
          <div key={item.kind} className="sc-report-card">
            <div className="sc-report-card__icon">{item.icon}</div>
            <div className="sc-report-card__label">{item.label}</div>
            <div className="sc-report-card__sub">{item.sub}</div>
            <div className="sc-report-card__formats">
              <button
                type="button"
                className="sc-report-card__format sc-report-card__format--excel"
                onClick={() => setExportRequest({ kind: item.kind, format: "excel" })}
              >
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button
                type="button"
                className="sc-report-card__format sc-report-card__format--pdf"
                onClick={() => setExportRequest({ kind: item.kind, format: "pdf" })}
              >
                <FileText size={14} /> PDF
              </button>
            </div>
          </div>
        ))}
      </div>
      {exportRequest && (
        <ShipmentReportExportModal
          kind={exportRequest.kind}
          format={exportRequest.format}
          records={records}
          zones={zones}
          couriers={couriers}
          initialFilter={filter}
          generatedBy={generatedBy}
          onClose={() => setExportRequest(null)}
        />
      )}
    </div>
  );
}
