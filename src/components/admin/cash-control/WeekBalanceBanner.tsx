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
  if (diff < -CASH_CONTROL_EPS) return `חוסר: ${amt}`;
  if (diff > CASH_CONTROL_EPS) return `עודף: ${amt}`;
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
          <strong>✓ השבוע מאוזן</strong>
          <p>אין הפרש בין הקופה הצפויה לקופה בפועל</p>
          <p className="cc-week-balance__hint">
            {label}
            {state.balancedByName ? ` · אושר על ידי ${state.balancedByName}` : ""}
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "READY" && !dismissed) {
    return (
      <section className="cc-week-balance cc-week-balance--confirm" aria-label="מוכן לאישור איזון">
        <div className="cc-week-balance__icon" aria-hidden>
          <Scale size={20} />
        </div>
        <div className="cc-week-balance__content">
          <strong>הנתונים תואמים — ניתן לאשר איזון</strong>
          <p>
            שבוע {label}: אין הפרש בין הקופה הצפויה לספירה בפועל.
          </p>
          {canManage ? (
            <>
              <p className="cc-week-balance__prompt">האם ברצונך לאשר את איזון שבוע {label}?</p>
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
    const pendingCounts = state.snapshot.hasPendingCounts;

    if (diff && diff.diff < -CASH_CONTROL_EPS) {
      return (
        <section className="cc-week-balance cc-week-balance--shortage" aria-label="שבוע לא מאוזן — חוסר">
          <div className="cc-week-balance__icon" aria-hidden>
            <AlertTriangle size={20} />
          </div>
          <div className="cc-week-balance__content">
            <strong>⚠ השבוע אינו מאוזן</strong>
            <p dir="ltr">{diffMessage(diff.currency, diff.diff)}</p>
            <p className="cc-week-balance__hint">
              יש לבדוק הכנסות, הוצאות או את ספירת הקופה לפני איזון השבוע.
            </p>
          </div>
        </section>
      );
    }

    if (diff && diff.diff > CASH_CONTROL_EPS) {
      return (
        <section className="cc-week-balance cc-week-balance--surplus" aria-label="שבוע לא מאוזן — עודף">
          <div className="cc-week-balance__icon" aria-hidden>
            <AlertTriangle size={20} />
          </div>
          <div className="cc-week-balance__content">
            <strong>⚠ קיים עודף בקופה</strong>
            <p dir="ltr">{diffMessage(diff.currency, diff.diff)}</p>
            <p className="cc-week-balance__hint">
              יש לבדוק הכנסות, הוצאות או את ספירת הקופה לפני איזון השבוע.
            </p>
          </div>
        </section>
      );
    }

    return (
      <section className="cc-week-balance cc-week-balance--warn" aria-label="שבוע לא מאוזן">
        <div className="cc-week-balance__icon" aria-hidden>
          <AlertTriangle size={20} />
        </div>
        <div className="cc-week-balance__content">
          <strong>⚠ השבוע אינו מאוזן</strong>
          {pendingCounts ? (
            <p>קיימות תנועות (הכנסות או הוצאות) שטרם נספרו בקופה.</p>
          ) : (
            <p>יש לבדוק הכנסות, הוצאות או את ספירת הקופה לפני איזון השבוע.</p>
          )}
        </div>
      </section>
    );
  }

  return null;
}
