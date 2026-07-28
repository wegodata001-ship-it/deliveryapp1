"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { loadShipmentCashHistoryAction } from "@/app/admin/shipments/cash-control/actions";
import type {
  ShipmentCashControlRow,
  ShipmentCashExpenseDto,
  ShipmentCashHistoryEntry,
} from "@/app/admin/shipments/cash-control/types";
import { SHIPMENT_PAYMENT_STATUS_LABELS } from "@/app/admin/shipments/types";

type Props = {
  row: ShipmentCashControlRow;
  expenses: ShipmentCashExpenseDto[];
  onClose: () => void;
  onIntake: () => void;
  onEditPayments: () => void;
};

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

type TimelineKind = "fee" | "intake" | "expense" | "audit" | "balance";

type TimelineItem = {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  amountIls: number | null;
  userName: string | null;
  detail: string | null;
  notes: string | null;
};

function kindLabel(kind: TimelineKind) {
  switch (kind) {
    case "fee":
      return "דמי משלוח";
    case "intake":
      return "קליטה";
    case "expense":
      return "הוצאה";
    case "balance":
      return "יתרה";
    default:
      return "Audit";
  }
}

export function ShipmentCashDetailModal({
  row,
  expenses,
  onClose,
  onIntake,
  onEditPayments,
}: Props) {
  const [entries, setEntries] = useState<ShipmentCashHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadShipmentCashHistoryAction(row.id).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setEntries(res.entries);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const timeline: TimelineItem[] = [];
  const anchor = row.arrivalDate || row.shippingDate;
  if (anchor) {
    timeline.push({
      id: "fee",
      at: `${anchor}T00:00:00.000Z`,
      kind: "fee",
      title: "דמי משלוח צפויים",
      amountIls: row.deliveryFeeIls,
      userName: null,
      detail: row.shipmentLabel,
      notes: null,
    });
  }

  for (const e of entries) {
    const kind: TimelineKind =
      e.actionType === "SHIPMENT_FEE_INTAKE"
        ? "intake"
        : e.actionType.includes("EXPENSE")
          ? "expense"
          : "audit";
    timeline.push({
      id: e.id,
      at: e.at,
      kind,
      title: e.actionLabel,
      amountIls: e.amountIls,
      userName: e.userName,
      detail: e.detail,
      notes: e.notes,
    });
  }

  for (const ex of expenses) {
    timeline.push({
      id: `day-exp-${ex.id}`,
      at: ex.createdAt,
      kind: "expense",
      title: `הוצאה יומית · ${ex.categoryLabel}`,
      amountIls: ex.amountIls,
      userName: ex.createdByName,
      detail: "הוצאה ליום העבודה (לא מפחיתה דמי משלוח)",
      notes: ex.notes,
    });
  }

  timeline.push({
    id: "balance",
    at: new Date().toISOString(),
    kind: "balance",
    title: "יתרה נוכחית",
    amountIls: row.remainingFeeIls,
    userName: null,
    detail: SHIPMENT_PAYMENT_STATUS_LABELS[row.paymentStatus],
    notes: null,
  });

  timeline.sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="shp-modal-backdrop" onClick={onClose}>
      <div
        className="shp-modal scc-detail-modal"
        style={{ maxWidth: 720, width: "96vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong>פירוט חישוב – {row.shipmentLabel}</strong>
          <button type="button" className="shp-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body">
          <div className="scc-detail-head">
            <div>
              <span>דמי משלוח</span>
              <strong>{fmtIls(row.deliveryFeeIls)}</strong>
            </div>
            <div>
              <span>נקלט</span>
              <strong style={{ color: "#15803d" }}>{fmtIls(row.paidAmountIls)}</strong>
            </div>
            <div>
              <span>יתרה</span>
              <strong style={{ color: row.remainingFeeIls > 0.005 ? "#c2410c" : "#15803d" }}>
                {fmtIls(row.remainingFeeIls)}
              </strong>
            </div>
            <div>
              <span>שליח / אזור</span>
              <strong>
                {row.courierName || "—"} · {row.zoneName || "—"}
              </strong>
            </div>
          </div>

          <h3 className="scc-detail-timeline-title">ציר זמן</h3>
          {loading ? (
            <div style={{ color: "#94a3b8", padding: 16 }}>טוען היסטוריה…</div>
          ) : (
            <ol className="scc-timeline">
              {timeline.map((t) => (
                <li key={t.id} className={`scc-timeline__item scc-timeline__item--${t.kind}`}>
                  <div className="scc-timeline__meta">
                    <span className="scc-timeline__kind">{kindLabel(t.kind)}</span>
                    <span className="scc-timeline__at">{formatDateTime(t.at)}</span>
                  </div>
                  <div className="scc-timeline__title">{t.title}</div>
                  <div className="scc-timeline__row">
                    {t.amountIls != null && (
                      <strong dir="ltr">{fmtIls(t.amountIls)}</strong>
                    )}
                    {t.userName && <span>{t.userName}</span>}
                    {t.detail && <span>{t.detail}</span>}
                    {t.notes && <span className="scc-timeline__notes">{t.notes}</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose}>
            סגור
          </button>
          <button type="button" className="shp-btn" onClick={onEditPayments}>
            עריכת קליטות
          </button>
          <button type="button" className="shp-btn shp-btn--primary" onClick={onIntake}>
            קליטת כסף
          </button>
        </div>
      </div>
    </div>
  );
}
