"use client";

import { X } from "lucide-react";
import type { ShipmentCashControlRow, ShipmentCashExpenseDto } from "@/app/admin/shipments/cash-control/types";
import {
  CASH_KPI_DRILL_TITLES,
  type CashKpiDrillKey,
  filterRowsForKpiDrill,
  summarizeDrill,
} from "@/app/admin/shipments/cash-control/view-helpers";
import { SHIPMENT_PAYMENT_STATUS_LABELS } from "@/app/admin/shipments/types";

type Props = {
  kpiKey: CashKpiDrillKey;
  rows: ShipmentCashControlRow[];
  expenses: ShipmentCashExpenseDto[];
  onClose: () => void;
  onOpenRow: (row: ShipmentCashControlRow) => void;
};

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

export function ShipmentCashKpiDrillModal({
  kpiKey,
  rows,
  expenses,
  onClose,
  onOpenRow,
}: Props) {
  const filtered = filterRowsForKpiDrill(rows, kpiKey);
  const summary = summarizeDrill(filtered, expenses.reduce((s, e) => s + e.amountIls, 0));
  const showExpenses = kpiKey === "expenses";

  return (
    <div className="shp-modal-backdrop" onClick={onClose}>
      <div
        className="shp-modal shp-modal--kpi"
        style={{ maxWidth: 920, width: "96vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong>{CASH_KPI_DRILL_TITLES[kpiKey]}</strong>
          <button type="button" className="shp-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body">
          {!showExpenses && (
            <div className="scc-drill-summary">
              <span>{filtered.length} משלוחים</span>
              <span>דמי משלוח {fmtIls(summary.totalFeeIls)}</span>
              <span>נקלט {fmtIls(summary.collectedIls)}</span>
              <span>יתרה {fmtIls(summary.remainingIls)}</span>
              {kpiKey === "packages" && <span>חבילות {summary.packagesCount}</span>}
            </div>
          )}

          {showExpenses ? (
            expenses.length === 0 ? (
              <div style={{ color: "#94a3b8", padding: 24, textAlign: "center" }}>אין הוצאות</div>
            ) : (
              <table className="shp-table">
                <thead>
                  <tr>
                    <th>קטגוריה</th>
                    <th>סכום</th>
                    <th>הערה</th>
                    <th>משתמש</th>
                    <th>שעה</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{e.categoryLabel}</td>
                      <td>{fmtIls(e.amountIls)}</td>
                      <td>{e.notes || "—"}</td>
                      <td>{e.createdByName || "—"}</td>
                      <td>{formatDate(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : filtered.length === 0 ? (
            <div style={{ color: "#94a3b8", padding: 24, textAlign: "center" }}>אין שורות</div>
          ) : (
            <div className="shp-table-wrap" style={{ maxHeight: "60vh" }}>
              <table className="shp-table shp-batch-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>משלוח</th>
                    <th>שליח</th>
                    <th>אזור</th>
                    <th>חבילות</th>
                    <th>דמי משלוח</th>
                    <th>נקלט</th>
                    <th>יתרה</th>
                    <th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => onOpenRow(r)}
                    >
                      <td>{formatDate(r.arrivalDate || r.shippingDate)}</td>
                      <td style={{ fontWeight: 600 }}>{r.shipmentLabel}</td>
                      <td>{r.courierName || "—"}</td>
                      <td>{r.zoneName || "—"}</td>
                      <td style={{ textAlign: "center" }}>{r.boxes ?? "—"}</td>
                      <td>{fmtIls(r.deliveryFeeIls)}</td>
                      <td style={{ color: "#15803d" }}>{fmtIls(r.paidAmountIls)}</td>
                      <td style={{ color: r.remainingFeeIls > 0 ? "#c2410c" : "#15803d" }}>
                        {fmtIls(r.remainingFeeIls)}
                      </td>
                      <td>{SHIPMENT_PAYMENT_STATUS_LABELS[r.paymentStatus]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
