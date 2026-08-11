"use client";

import { AlertTriangle, Check, Scale } from "lucide-react";
import type { WeekBalanceStateDto } from "@/lib/cash-control/week-balance-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

export type WeekBalanceBannerProps = {
  state: WeekBalanceStateDto | null;
  loading?: boolean;
  dismissed?: boolean;
  canManage?: boolean;
  onDismiss?: () => void;
  onOpenConfirm?: () => void;
};

function primaryDiff(state: WeekBalanceStateDto): { currency: "ILS" | "USD"; diff: number } | null {
  const ils = state.snapshot.ils;
  const usd = state.snapshot.usd;
  if (Math.abs(ils.diff) > CASH_CONTROL_EPS) return { currency: "ILS", diff: ils.diff };
  if (Math.abs(usd.diff) > CASH_CONTROL_EPS) return { currency: "USD", diff: usd.diff };
  return null;
}

function diffMessage(currency: "ILS" | "USD", diff: number): string {
  const amt = fmtDailyMoney(currency, Math.abs(diff));
  if (diff < -CASH_CONTROL_EPS) return `חסר בקופה: ${amt}`;
  if (diff > CASH_CONTROL_EPS) return `עודף בקופה: ${amt}`;
  return "";
}

export function WeekBalanceBanner({
  state,
  loading = false,
  dismissed = false,
  canManage = false,
  onDismiss,
  onOpenConfirm,
}: WeekBalanceBannerProps) {
  if (loading || !state) return null;

  const label = state.weekLabel ?? state.weekCode;

  if (state.status === "BALANCED") {
    return (
      <section className="cc-week-balance cc-week-balance--balanced" aria-label="סטטוס איזון שבוע">
        <div className="cc-week-balance__icon" aria-hidden>
          <Check size={20} />
        </div>
        <div className="cc-week-balance__content">
          <strong>✓ שבוע מאוזן</strong>
          <p>
            {label}
            {state.balancedByName ? ` · אושר על ידי ${state.balancedByName}` : ""}
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "READY" && !dismissed) {
    return (
      <section className="cc-week-balance cc-week-balance--ready" aria-label="מוכן לאיזון">
        <div className="cc-week-balance__icon" aria-hidden>
          <Check size={20} />
        </div>
        <div className="cc-week-balance__content">
          <strong>✓ ההכנסות וההוצאות מאוזנות לשבוע {label}</strong>
          <p>כל נתוני הקופה לשבוע זה נמצאו תקינים.</p>
          {canManage ? (
            <>
              <p className="cc-week-balance__prompt">האם ברצונך לאזן את שבוע {label}?</p>
              <div className="cc-week-balance__actions">
                <button type="button" className="cc-btn cc-btn--ghost" onClick={onDismiss}>
                  לא עכשיו
                </button>
                <button type="button" className="cc-btn cc-btn--accent" onClick={onOpenConfirm}>
                  <Scale size={15} /> ✓ איזון שבוע
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  if (state.status === "NEEDS_BALANCE") {
    const diff = primaryDiff(state);
    return (
      <section className="cc-week-balance cc-week-balance--warn" aria-label="שבוע לא מאוזן">
        <div className="cc-week-balance__icon" aria-hidden>
          <AlertTriangle size={20} />
        </div>
        <div className="cc-week-balance__content">
          <strong>⚠ השבוע עדיין אינו מאוזן</strong>
          {diff ? <p dir="ltr">{diffMessage(diff.currency, diff.diff)}</p> : null}
          <p className="cc-week-balance__hint">
            יש לבדוק הכנסות, הוצאות או את ספירת הקופה לפני איזון השבוע.
          </p>
        </div>
      </section>
    );
  }

  return null;
}
