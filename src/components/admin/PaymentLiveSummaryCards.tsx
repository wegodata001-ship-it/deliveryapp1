"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  LIVE_PAYMENT_KPI_CARDS,
  liveKpiBucket,
  type LivePaymentFormKpis,
  type LivePaymentKpiCardId,
} from "@/lib/payment-intake-live-kpi";
import {
  calculateLineTotalPaymentUsd,
  linePaymentMethod,
  normalizePaymentLine,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";
import { formatIlsDisplay, formatUsdDisplay, formatUsdPlain } from "@/lib/money-format";

export type OrderSummaryForCards = {
  /** סה"כ הזמנה (USD) */
  totalUsd: number;
  /** שווי בש"ח */
  ilsValue: number;
  /** סה"כ שולם (DB + הקלדה נוכחית) */
  paidUsd: number;
  /** חוב פתוח לפני התשלום הנוכחי (total − dbPaid) */
  openDebtBeforeUsd: number;
  /** יתרה לתשלום אחרי ההקלדה — 0 כשאין חוב או שיש עודף */
  remainingUsd: number;
  /**
   * עודף תשלום חי:
   * overpayment = enteredPayment − openDebtBefore (כשחיובי).
   */
  overpaymentUsd: number;
};

type Props = {
  kpis: LivePaymentFormKpis;
  /** סה״כ יתרות פתוחות על הזמנות (DB) */
  openDebtUsd?: number;
  onOpenDebtClick?: () => void;
  /** Part 1 — כרטיס סיכום הזמנה מרכזי */
  orderSummary?: OrderSummaryForCards | null;
  /** Part 3 — שורות התשלום הנוכחיות, לצורך Drill-down */
  lines?: PaymentLine[];
  rate?: number;
};

const CARD_ID_TO_METHOD: Record<Exclude<LivePaymentKpiCardId, "total">, PaymentLineMethod> = {
  cash: "CASH",
  bank_transfer: "BANK_TRANSFER",
  credit: "CREDIT",
  checks: "CHECK",
  other: "OTHER",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function totalEnteredIls(kpis: LivePaymentFormKpis): number {
  return (
    kpis.cash.enteredIls +
    kpis.bankTransfer.enteredIls +
    kpis.credit.enteredIls +
    kpis.checks.enteredIls +
    kpis.other.enteredIls
  );
}

/**
 * תצוגה נקייה לכל אמצעי תשלום:
 * - מספר גדול אחד: "דולר בפועל".
 * - תיבת המרה בולטת (רקע כחול בהיר): ₪ סכום מקור → $ סכום לאחר המרה.
 */
function KpiMethodAmounts({
  ils,
  convertedUsd,
  actualUsd,
}: {
  ils: number;
  convertedUsd: number;
  actualUsd: number;
}) {
  const hasConversion = ils > 0.005;
  return (
    <div className="payment-modal-live-kpi__amounts payment-modal-live-kpi__amounts--method">
      <div className="payment-modal-live-kpi__big">
        <span className="payment-modal-live-kpi__big-k">דולר בפועל</span>
        <AnimatedMoneyValue
          className="payment-modal-live-kpi__big-v payment-modal-live-kpi__big-v--usd"
          dir="ltr"
          value={formatUsdDisplay(actualUsd)}
        />
      </div>
      {hasConversion ? (
        <div
          className="payment-modal-live-kpi__convbox"
          dir="ltr"
          title={`המרה לדולר: ${formatIlsDisplay(ils)} → ${formatUsdDisplay(convertedUsd)}`}
        >
          <span className="payment-modal-live-kpi__convbox-ils">{formatIlsDisplay(ils)}</span>
          <span className="payment-modal-live-kpi__convbox-arrow" aria-hidden>→</span>
          <span className="payment-modal-live-kpi__convbox-usd">{formatUsdDisplay(convertedUsd)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function PaymentLiveSummaryCards({
  kpis,
  openDebtUsd = 0,
  onOpenDebtClick,
  orderSummary = null,
  lines,
  rate = 0,
}: Props) {
  const showOpenDebt = openDebtUsd > 0.01;
  const methodCards = LIVE_PAYMENT_KPI_CARDS.filter((c) => !c.isTotal);
  const canDrill = Array.isArray(lines) && lines.length > 0;
  const hasOverpayment = (orderSummary?.overpaymentUsd ?? 0) > 0.01;
  const hasRemaining = (orderSummary?.remainingUsd ?? 0) > 0.01;

  const [drill, setDrill] = useState<{ title: string; method: PaymentLineMethod | null } | null>(null);

  const openDrill = (title: string, method: PaymentLineMethod | null) => {
    if (!canDrill) return;
    setDrill({ title, method });
  };

  return (
    <div className="payment-modal-live-kpis-wrap" dir="rtl">
      <div className="payment-modal-live-total-banner" role="status" aria-live="polite">
        <span className="payment-modal-live-total-banner__lbl">סה״כ תשלום נוכחי</span>
        <AnimatedMoneyValue
          className="payment-modal-live-total-banner__usd"
          dir="ltr"
          value={formatUsdDisplay(kpis.totalPaymentUsd)}
        />
        <AnimatedMoneyValue
          className="payment-modal-live-total-banner__ils"
          dir="ltr"
          value={formatIlsDisplay(rate > 0 ? kpis.totalPaymentUsd * rate : totalEnteredIls(kpis))}
        />
      </div>

      <div
        className={[
          "payment-modal-live-kpis",
          "payment-modal-live-kpis--inline-row",
          showOpenDebt ? "payment-modal-live-kpis--with-open-debt" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="region"
        aria-label="סיכום תשלום לפי אמצעי תשלום"
        aria-live="polite"
        dir="rtl"
      >
      {methodCards.map((card) => {
        const bucket = liveKpiBucket(kpis, card.id);
        const enteredIls = bucket?.enteredIls ?? 0;
        const enteredUsd = bucket?.enteredUsd ?? 0;
        const bucketTotalUsd = bucket?.totalUsd ?? 0;
        const convertedUsd = round2(bucketTotalUsd - enteredUsd);
        const method = CARD_ID_TO_METHOD[card.id as Exclude<LivePaymentKpiCardId, "total">];
        const clickable = canDrill && bucketTotalUsd > 0.005;
        return (
          <div
            key={card.id}
            className={[
              "payment-modal-live-kpi",
              `payment-modal-live-kpi--${card.id}`,
              clickable ? "payment-modal-live-kpi--clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => openDrill(card.label, method) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDrill(card.label, method);
                    }
                  }
                : undefined
            }
            title={clickable ? "לחץ לפירוט התשלומים" : undefined}
          >
            <div className="payment-modal-live-kpi__lbl">{card.label}</div>
            <KpiMethodAmounts ils={enteredIls} convertedUsd={convertedUsd} actualUsd={bucketTotalUsd} />
          </div>
        );
      })}

      {showOpenDebt ? (
        <button
          type="button"
          className="payment-modal-live-kpi payment-modal-live-kpi--open-debt"
          onClick={onOpenDebtClick}
          title="לחץ לפירוט חובות פתוחים"
        >
          <div className="payment-modal-live-kpi__lbl">חוב פתוח</div>
          <AnimatedMoneyValue
            className="payment-modal-live-kpi__amount-v payment-modal-live-kpi__amount-v--usd payment-modal-live-kpi__amount-v--solo"
            dir="ltr"
            value={formatUsdPlain(openDebtUsd)}
          />
          <span className="payment-modal-live-kpi__hint">לחץ לפירוט</span>
        </button>
      ) : null}

      {orderSummary ? (
        <div
          className={[
            "payment-modal-live-kpi",
            "payment-modal-live-kpi--order-summary",
            "payment-modal-live-kpi--order-summary--last",
            hasOverpayment ? "payment-modal-live-kpi--order-summary--surplus" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="payment-modal-live-kpi__lbl">
            {hasOverpayment ? "עודף תשלום" : "נשאר לתשלום"}
          </div>
          <AnimatedMoneyValue
            className={[
              "payment-modal-live-kpi__hero-v",
              hasOverpayment
                ? "payment-modal-live-kpi__hero-v--surplus"
                : hasRemaining
                  ? "payment-modal-live-kpi__hero-v--due"
                  : "payment-modal-live-kpi__hero-v--ok",
            ].join(" ")}
            dir="ltr"
            value={
              hasOverpayment
                ? `+${formatUsdDisplay(orderSummary.overpaymentUsd)}`
                : formatUsdDisplay(orderSummary.remainingUsd)
            }
          />
          <div className="payment-modal-live-kpi__sub">
            <span>
              שולם עד כה: <strong dir="ltr">{formatUsdDisplay(orderSummary.paidUsd)}</strong>
            </span>
            <span>
              חוב מקורי: <strong dir="ltr">{formatUsdDisplay(orderSummary.totalUsd)}</strong>
            </span>
            {hasOverpayment ? (
              <span>
                חוב לפני תשלום:{" "}
                <strong dir="ltr">{formatUsdDisplay(orderSummary.openDebtBeforeUsd)}</strong>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {drill && canDrill ? (
        <PaymentSummaryDrillModal
          title={drill.title}
          method={drill.method}
          lines={lines!}
          rate={rate}
          onClose={() => setDrill(null)}
        />
      ) : null}
      </div>
    </div>
  );
}

/** Part 3 — חלון פירוט: כל שורות התשלום המרכיבות סכום בסיכום */
function PaymentSummaryDrillModal({
  title,
  method,
  lines,
  rate,
  onClose,
}: {
  title: string;
  method: PaymentLineMethod | null;
  lines: PaymentLine[];
  rate: number;
  onClose: () => void;
}) {
  const rows = lines
    .map((raw, idx) => {
      const p = normalizePaymentLine(raw);
      const m = linePaymentMethod(p);
      if (method && m !== method) return null;
      const ils = typeof p.ilsAmount === "number" && p.ilsAmount > 0 ? p.ilsAmount : 0;
      const directUsd = typeof p.usdAmount === "number" && p.usdAmount > 0 ? p.usdAmount : 0;
      const totalUsd = round2(calculateLineTotalPaymentUsd(raw, rate));
      const convertedUsd = round2(totalUsd - directUsd);
      if (ils <= 0 && totalUsd <= 0) return null;
      return { idx: idx + 1, method: m, ils, convertedUsd, totalUsd };
    })
    .filter((r): r is { idx: number; method: PaymentLineMethod; ils: number; convertedUsd: number; totalUsd: number } => r !== null);

  const totalIls = rows.reduce((a, r) => a + r.ils, 0);
  const totalConverted = round2(rows.reduce((a, r) => a + r.convertedUsd, 0));
  const totalUsd = round2(rows.reduce((a, r) => a + r.totalUsd, 0));
  const methodLabel = (m: PaymentLineMethod): string => {
    const card = LIVE_PAYMENT_KPI_CARDS.find((c) => CARD_ID_TO_METHOD[c.id as Exclude<LivePaymentKpiCardId, "total">] === m);
    return card?.label ?? m;
  };

  return (
    <div className="payment-drill-backdrop" role="presentation" onClick={onClose}>
      <div className="payment-drill-modal" dir="rtl" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="payment-drill-head">
          <h4>פירוט תשלומים — {title}</h4>
          <button type="button" className="payment-drill-x" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </div>
        <div className="payment-drill-body">
          {rows.length === 0 ? (
            <div className="payment-drill-empty">אין תשלומים מרכיבים את הסכום הזה.</div>
          ) : (
            <table className="payment-drill-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  {method === null ? <th>אמצעי</th> : null}
                  <th>תשלום בש&quot;ח</th>
                  <th>המרה לדולר</th>
                  <th>דולר בפועל</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.idx}>
                    <td>{r.idx}</td>
                    {method === null ? <td>{methodLabel(r.method)}</td> : null}
                    <td dir="ltr">{formatIlsDisplay(r.ils)}</td>
                    <td dir="ltr">{formatUsdDisplay(r.convertedUsd)}</td>
                    <td dir="ltr" className="payment-drill-strong">{formatUsdDisplay(r.totalUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={method === null ? 2 : 1}>סה&quot;כ</td>
                  <td dir="ltr">{formatIlsDisplay(totalIls)}</td>
                  <td dir="ltr">{formatUsdDisplay(totalConverted)}</td>
                  <td dir="ltr" className="payment-drill-strong">{formatUsdDisplay(totalUsd)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
