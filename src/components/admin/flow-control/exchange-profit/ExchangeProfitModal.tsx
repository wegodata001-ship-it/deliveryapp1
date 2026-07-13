"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { getExchangeProfitWeekSummaryAction } from "@/app/admin/cash-flow/get-exchange-profit-actions";
import type { ExchangeProfitWeekSummaryDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { ExchangeProfitTable } from "./ExchangeProfitTable";
import { ExchangeProfitOrderModal } from "./ExchangeProfitOrderModal";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export type ExchangeProfitModalProps = {
  open: boolean;
  week: string;
  onClose: () => void;
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

export function ExchangeProfitModal({ open, week, onClose }: ExchangeProfitModalProps) {
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

  if (!open) return null;

  const net = summary ? fcNum(summary.netIls) : 0;

  return (
    <>
      <div className="xp-overlay" role="presentation" onClick={onClose}>
        <div
          className="xp-modal xp-modal--week"
          role="dialog"
          aria-modal="true"
          aria-label="רווח מט״ח — פירוט שבוע"
          dir="rtl"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="xp-modal__head">
            <div>
              <h2>רווח מט״ח</h2>
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
                  <span>סה״כ רווח מט״ח השבוע</span>
                  <strong dir="ltr">{fmtDailyMoney("ILS", net)}</strong>
                </div>

                <div className="xp-stat-grid">
                  <article className="xp-stat">
                    <span>מספר הזמנות</span>
                    <strong>{summary.orderCount}</strong>
                  </article>
                  <article className="xp-stat">
                    <span>סה״כ תקבולים בדולר</span>
                    <strong dir="ltr">{fmtDailyMoney("USD", fcNum(summary.totalReceivedUsd))}</strong>
                  </article>
                  <article className="xp-stat">
                    <span>סה״כ תשלומים לספקים</span>
                    <strong dir="ltr">{fmtDailyMoney("USD", fcNum(summary.totalPaidUsd))}</strong>
                  </article>
                  <article className="xp-stat">
                    <span>סה״כ המרות מט״ח</span>
                    <strong dir="ltr">
                      {summary.fxConversionCount} · {fmtDailyMoney("ILS", fcNum(summary.fxConversionIls))}
                    </strong>
                  </article>
                  <article className="xp-stat xp-stat--profit">
                    <span>סה״כ רווח</span>
                    <strong dir="ltr">{fmtDailyMoney("ILS", fcNum(summary.totalProfitIls))}</strong>
                  </article>
                  <article className="xp-stat xp-stat--loss">
                    <span>סה״כ הפסד</span>
                    <strong dir="ltr">{fmtDailyMoney("ILS", fcNum(summary.totalLossIls))}</strong>
                  </article>
                  <article className="xp-stat xp-stat--net">
                    <span>רווח נטו</span>
                    <strong dir="ltr">{fmtDailyMoney("ILS", fcNum(summary.netIls))}</strong>
                  </article>
                </div>

                <section className="xp-section">
                  <h3>הזמנות שתרמו לרווח/הפסד</h3>
                  <ExchangeProfitTable orders={summary.orders} onOpenOrder={openOrder} />
                </section>
              </>
            ) : null}

            {!loading && summary && summary.orders.length === 0 && !error ? (
              <div className="xp-empty">
                <p>אין רווח/הפסד מט״ח להזמנות בשבוע זה.</p>
                <p className="xp-muted">
                  יוצגו הזמנות עם תשלומים שיש להן שער קבלה ושער הזמנה להשוואה.
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
