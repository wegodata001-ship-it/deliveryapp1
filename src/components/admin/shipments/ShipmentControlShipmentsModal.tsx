"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type {
  ShipmentControlRecord,
  ShipmentRecordExpenseDto,
} from "@/app/admin/shipments/control/types";
import {
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/app/admin/shipments/types";
import {
  ShipmentExpenseFormModal,
  ShipmentExpensesListModal,
} from "@/components/admin/shipments/ShipmentRecordExpenseModals";

type Props = {
  records: ShipmentControlRecord[];
  onClose: () => void;
  onChanged: () => void;
};

function fmtIls(n: number | null | undefined) {
  if (n == null) return "—";
  return (
    "₪" +
    n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function addressLine(r: ShipmentControlRecord) {
  return [r.address, r.city].filter(Boolean).join(", ") || "—";
}

export function ShipmentControlShipmentsModal({
  records: initialRecords,
  onClose,
  onChanged,
}: Props) {
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [addFor, setAddFor] = useState<ShipmentControlRecord | null>(null);
  const [listFor, setListFor] = useState<ShipmentControlRecord | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const hay = [
        r.batchNumber,
        r.customerCode,
        r.customerName,
        r.customerPhone,
        r.customerPhone2,
        r.address,
        r.city,
        r.zoneName,
        r.courierName,
        r.containerNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, search]);

  const expensesTotal = useMemo(
    () => filtered.reduce((s, r) => s + (r.expensesTotalIls ?? 0), 0),
    [filtered],
  );

  function applyExpenses(recordId: string, expenses: ShipmentRecordExpenseDto[]) {
    const total =
      Math.round(expenses.reduce((s, e) => s + e.amountIls, 0) * 100) / 100;
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? {
              ...r,
              expenses,
              expensesTotalIls: total,
              expensesCount: expenses.length,
            }
          : r,
      ),
    );
    setListFor((prev) =>
      prev && prev.id === recordId
        ? {
            ...prev,
            expenses,
            expensesTotalIls: total,
            expensesCount: expenses.length,
          }
        : prev,
    );
    onChanged();
  }

  return (
    <>
      <div
        className="shp-modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="shp-modal shp-modal--kpi" dir="rtl">
          <div className="shp-modal__header">
            פירוט משלוחים
            <span className="sc-kpi-modal-count">{filtered.length}</span>
            <button type="button" className="shp-modal__header-close" onClick={onClose}>
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
                  placeholder="חיפוש: מספר משלוח / קוד לקוח / שם / טלפון / כתובת…"
                />
              </div>
              <div className="sc-kpi-modal-summary">
                <span>
                  סה״כ הוצאות: <strong>{fmtIls(expensesTotal)}</strong>
                </span>
              </div>
            </div>

            <div className="shp-table-wrap sc-kpi-modal-table">
              <table className="shp-table shp-table--compact sc-shipments-detail-table">
                <thead>
                  <tr>
                    <th>מספר משלוח</th>
                    <th>קוד לקוח</th>
                    <th>שם לקוח</th>
                    <th>טלפון</th>
                    <th>כתובת</th>
                    <th>אזור חלוקה</th>
                    <th>שליח</th>
                    <th>קרטונים</th>
                    <th>דמי משלוח</th>
                    <th>סכום לתשלום</th>
                    <th>סכום ששולם</th>
                    <th>יתרה</th>
                    <th>סטטוס</th>
                    <th>הוצאות משלוח</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={14} style={{ textAlign: "center", padding: 28, color: "#94a3b8" }}>
                        אין משלוחים להצגה
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => {
                    const fee = r.deliveryFeeIls ?? r.deliveryFeeAmount ?? 0;
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>
                          {r.batchNumber}
                          <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>#{r.rowIndex}</div>
                        </td>
                        <td>{r.customerCode || "—"}</td>
                        <td style={{ fontWeight: 600 }}>{r.customerName || "—"}</td>
                        <td dir="ltr" style={{ textAlign: "right" }}>
                          {r.customerPhone || "—"}{r.customerPhone2 ? ` / ${r.customerPhone2}` : ""}
                        </td>
                        <td>
                          <span className="shp-trunc" title={addressLine(r)}>
                            {addressLine(r)}
                          </span>
                        </td>
                        <td>{r.zoneName || "—"}</td>
                        <td>{r.courierName || "—"}</td>
                        <td className="shp-daily-center">{r.boxes ?? "—"}</td>
                        <td>{fmtIls(fee)}</td>
                        <td>{fmtIls(fee)}</td>
                        <td>{fmtIls(r.paidAmountIls)}</td>
                        <td
                          style={{
                            fontWeight: 600,
                            color: r.remainingFeeIls > 0.01 ? "#b91c1c" : "#15803d",
                          }}
                        >
                          {fmtIls(r.remainingFeeIls)}
                        </td>
                        <td>
                          {SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}
                        </td>
                        <td>
                          <div className="sc-expense-cell">
                            {r.expensesCount > 0 ? (
                              <button
                                type="button"
                                className="sc-expense-chip"
                                title="פירוט הוצאות"
                                onClick={() => setListFor(r)}
                              >
                                {fmtIls(r.expensesTotalIls)}{" "}
                                <span>({r.expensesCount})</span>
                              </button>
                            ) : (
                              <span className="sc-expense-empty">—</span>
                            )}
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm"
                              title="הוסף הוצאה"
                              onClick={() => setAddFor(r)}
                            >
                              <Plus size={12} />
                              הוסף הוצאה
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="shp-modal__footer">
            <button type="button" className="shp-btn" onClick={onClose}>
              סגור
            </button>
          </div>
        </div>
      </div>

      {addFor && (
        <ShipmentExpenseFormModal
          shipmentRecordId={addFor.id}
          shipmentLabel={addFor.batchNumber}
          onClose={() => setAddFor(null)}
          onSaved={(expense) => {
            const recordId = addFor.id;
            setRecords((prev) => {
              const current = prev.find((r) => r.id === recordId);
              const next = [expense, ...(current?.expenses ?? [])];
              const total =
                Math.round(next.reduce((s, e) => s + e.amountIls, 0) * 100) / 100;
              return prev.map((r) =>
                r.id === recordId
                  ? {
                      ...r,
                      expenses: next,
                      expensesTotalIls: total,
                      expensesCount: next.length,
                    }
                  : r,
              );
            });
            onChanged();
            setAddFor(null);
          }}
        />
      )}

      {listFor && (
        <ShipmentExpensesListModal
          shipmentRecordId={listFor.id}
          shipmentLabel={listFor.batchNumber}
          expenses={listFor.expenses ?? []}
          onClose={() => setListFor(null)}
          onChanged={(expenses) => applyExpenses(listFor.id, expenses)}
        />
      )}
    </>
  );
}
