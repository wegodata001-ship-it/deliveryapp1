"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { getExchangeProfitWeekSummaryAction } from "@/app/admin/cash-flow/get-exchange-profit-actions";
import type {
  ExchangeProfitPeriodFilter,
  ExchangeProfitWeekSummaryDto,
} from "@/app/admin/cash-flow/exchange-profit-types";
import { ExchangeProfitTable } from "./ExchangeProfitTable";
import { ExchangeProfitOrderModal } from "./ExchangeProfitOrderModal";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";
import { orderMatchesProfitPeriod } from "@/lib/flow-control/exchange-profit-period";

export type ExchangeProfitModalProps = {
  open: boolean;
  week: string;
  onClose: () => void;
  /** סינון מנקודה בגרף (יום / שבוע / חודש) */
  periodFilter?: ExchangeProfitPeriodFilter | null;
};

function fmtYmdHe(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function Skeleton() {
  return (
    <div className="xp-skeleton" aria-busy>
      <div className="xp-skeleton__row">
        <div className="xp-skeleton__block" />
        <div className="xp-skeleton__block" />
        <div className="xp-skeleton__block" />
      </div>
      <div className="xp-skeleton__block xp-skeleton__block--tall" />
    </div>
  );
}

export function ExchangeProfitModal({
  open,
  week,
  onClose,
  periodFilter = null,
}: ExchangeProfitModalProps) {
  const [summary, setSummary] = useState<ExchangeProfitWeekSummaryDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !week) {
      setSummary(null);
      setOrderId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getExchangeProfitWeekSummaryAction(week).then((res) => {
      if (cancelled) return;
      if (!res) setError("לא ניתן לטעון סיכום מט״ח");
      setSummary(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, week]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !orderId) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, orderId, onClose]);

  const openOrder = useCallback((id: string) => setOrderId(id), []);

  const filteredOrders = useMemo(() => {
    if (!summary) return [];
    if (!periodFilter) return summary.orders;
    return summary.orders.filter((o) =>
      orderMatchesProfitPeriod(o.dateYmd, periodFilter.period, periodFilter.key),
    );
  }, [summary, periodFilter]);

  const filteredNet = useMemo(() => {
    let n = 0;
    for (const o of filteredOrders) n += fcNum(o.netIls);
    return Math.round(n * 100) / 100;
  }, [filteredOrders]);

  if (!open) return null;

  const net = periodFilter ? filteredNet : summary ? fcNum(summary.netIls) : 0;
  const periodLabel =
    periodFilter?.period === "day"
      ? `יום ${periodFilter.label}`
      : periodFilter?.period === "week"
        ? `שבוע ${periodFilter.label}`
        : periodFilter?.period === "month"
          ? `חודש ${periodFilter.label}`
          : null;

  return (
    <>
      <div className="xp-overlay" role="presentation" onClick={onClose}>
        <div
          className="xp-modal xp-modal--week"
          role="dialog"
          aria-modal="true"
          aria-label="רווח — פירוט לפי הזמנות"
          dir="rtl"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="xp-modal__head">
            <div>
              <h2>פירוט רווח לפי הזמנות</h2>
              <p className="xp-modal__sub">
                שבוע <span dir="ltr">{week}</span>
                {summary ? (
                  <>
                    {" · "}
                    <span dir="ltr">
                      {fmtYmdHe(summary.fromYmd)} - {fmtYmdHe(summary.toYmd)}
                    </span>
                  </>
                ) : null}
                {periodLabel ? (
                  <>
                    {" · "}
                    <strong>{periodLabel}</strong>
                  </>
                ) : null}
              </p>
            </div>
            <button type="button" className="xp-iconbtn" onClick={onClose} aria-label="סגור">
              <X size={22} />
            </button>
          </header>

          <div className="xp-modal__body">
            {loading ? <Skeleton /> : null}
            {error ? <p className="xp-error">{error}</p> : null}

            {!loading && summary ? (
              <>
                <div className={`xp-hero xp-hero--${net > 0.005 ? "profit" : net < -0.005 ? "loss" : "flat"}`}>
                  <span>
                    {periodFilter
                      ? "סה״כ רווח בתקופה שנבחרה"
                      : "סה״כ רווח השבוע"}
                  </span>
                  <strong dir="ltr">{fmtDailyMoney("ILS", net)}</strong>
                </div>

                <p className="xp-muted xp-hint">
                  לחצו על שורת הזמנה לפירוט מלא של החישוב · מיון לפי רווחיות (גבוה לנמוך)
                </p>

                <section className="xp-section">
                  <h3>
                    הזמנות שהרכיבו את הרווח
                    {periodFilter ? ` · ${periodLabel}` : ""}
                    {` (${filteredOrders.length})`}
                  </h3>
                  <ExchangeProfitTable orders={filteredOrders} onOpenOrder={openOrder} />
                </section>
              </>
            ) : null}

            {!loading && summary && filteredOrders.length === 0 && !error ? (
              <div className="xp-empty">
                <p>
                  {periodFilter
                    ? "אין הזמנות עם רווח/הפסד מט״ח בתקופה שנבחרה."
                    : "אין רווח/הפסד מט״ח להזמנות בשבוע זה."}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ExchangeProfitOrderModal
        open={!!orderId}
        week={week}
        orderId={orderId}
        onClose={() => setOrderId(null)}
      />
    </>
  );
}

export default ExchangeProfitModal;
