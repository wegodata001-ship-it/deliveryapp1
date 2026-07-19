"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, TrendingDown, TrendingUp } from "lucide-react";
import type { CashCurrency } from "@/app/admin/cash-control/constants";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import {
  expenseToDailyMethodId,
  type CashExpensePaymentMethod,
} from "@/lib/cash-expense-payment-method";
import {
  cashControlStatusLabel,
  formatVarianceShort,
  previewExpenseVarianceImpact,
  type CashVarianceLineDto,
} from "@/lib/cash-control-variance";

export type CashExpenseVarianceImpactProps = {
  lines: CashVarianceLineDto[] | null;
  currency: CashCurrency;
  paymentMethod: CashExpensePaymentMethod;
  amount: string;
  loading?: boolean;
};

function ImpactBadge({
  kind,
  message,
}: {
  kind: ReturnType<typeof previewExpenseVarianceImpact>["messageKind"];
  message: string;
}) {
  if (kind === "closes") {
    return (
      <p className="ce-impact__badge is-matched">
        <CheckCircle2 size={15} aria-hidden />
        <span>
          <strong>תקין</strong> — {message}
        </span>
      </p>
    );
  }
  if (kind === "reduces") {
    return (
      <p className="ce-impact__badge is-shortage">
        <TrendingDown size={15} aria-hidden />
        <span>{message}</span>
      </p>
    );
  }
  if (kind === "still_open") {
    return (
      <p className="ce-impact__badge is-shortage">
        <AlertTriangle size={15} aria-hidden />
        <span>{message}</span>
      </p>
    );
  }
  if (kind === "surplus") {
    return (
      <p className="ce-impact__badge is-surplus">
        <TrendingUp size={15} aria-hidden />
        <span>{message}</span>
      </p>
    );
  }
  if (kind === "no_count") {
    return (
      <p className="ce-impact__badge is-waiting">
        <Clock size={15} aria-hidden />
        <span>
          {message} <strong>ממתין לספירה</strong>
        </span>
      </p>
    );
  }
  return (
    <p className="ce-impact__badge is-neutral">
      <Info size={15} aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function moneyCell(currency: CashCurrency, value: number | null): string {
  if (value == null) return "—";
  return fmtDailyMoney(currency, value);
}

export function CashExpenseVarianceImpact({
  lines,
  currency,
  paymentMethod,
  amount,
  loading,
}: CashExpenseVarianceImpactProps) {
  const dailyMethod = useMemo(
    () => expenseToDailyMethodId(paymentMethod, currency),
    [currency, paymentMethod],
  );

  const preview = useMemo(() => {
    if (!lines?.length) return null;
    const amt = Number(amount.replace(",", "."));
    return previewExpenseVarianceImpact(
      lines,
      currency,
      Number.isFinite(amt) ? amt : 0,
      dailyMethod,
    );
  }, [amount, currency, dailyMethod, lines]);

  if (loading) {
    return (
      <section className="ce-impact" aria-label="השפעה על בקרת הקופה">
        <h4 className="ce-impact__title">השפעה על בקרת הקופה</h4>
        <p className="cc-muted">טוען מצב קופה…</p>
      </section>
    );
  }

  if (!preview || preview.messageKind === "no_cash_line") {
    return null;
  }

  const hasAmount = preview.proposedExpenseAmount !== 0;
  const showAfter = hasAmount;
  const cur = preview.currency;

  const beforeExpenses = preview.currentExpensesAmount;
  const afterExpenses = showAfter ? preview.afterExpensesAmount : beforeExpenses;
  const beforeNet = preview.currentExpectedNet;
  const afterNet = showAfter ? preview.afterExpectedNet : beforeNet;
  const beforeVar = preview.currentVariance;
  const afterVar = showAfter ? preview.afterVariance : beforeVar;

  return (
    <section className="ce-impact" aria-label="השפעה על בקרת הקופה">
      <h4 className="ce-impact__title">השפעה על בקרת הקופה</h4>
      <p className="ce-impact__channel">
        ערוץ מושפע: <strong>{preview.channelLabel}</strong>
      </p>

      <div className="ce-impact__table-wrap">
        <table className="ce-impact__table">
          <thead>
            <tr>
              <th>נתון</th>
              <th>לפני</th>
              {showAfter ? <th>אחרי</th> : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>התקבל</td>
              <td dir="ltr">{moneyCell(cur, preview.currentExpectedAmount)}</td>
              {showAfter ? (
                <td dir="ltr">{moneyCell(cur, preview.currentExpectedAmount)}</td>
              ) : null}
            </tr>
            <tr>
              <td>הוצאות קופה</td>
              <td dir="ltr">{moneyCell(cur, beforeExpenses)}</td>
              {showAfter ? <td dir="ltr">{moneyCell(cur, afterExpenses)}</td> : null}
            </tr>
            <tr>
              <td>צפוי נטו</td>
              <td dir="ltr">{moneyCell(cur, beforeNet)}</td>
              {showAfter ? <td dir="ltr">{moneyCell(cur, afterNet)}</td> : null}
            </tr>
            <tr>
              <td>ספירת מנהל</td>
              <td dir="ltr">{moneyCell(cur, preview.currentCounted)}</td>
              {showAfter ? <td dir="ltr">{moneyCell(cur, preview.currentCounted)}</td> : null}
            </tr>
            <tr className="ce-impact__row--var">
              <td>הפרש</td>
              <td dir="ltr">{formatVarianceShort(cur, beforeVar)}</td>
              {showAfter ? <td dir="ltr">{formatVarianceShort(cur, afterVar)}</td> : null}
            </tr>
          </tbody>
        </table>
      </div>

      {showAfter && preview.currentCounted != null ? (
        <p className="ce-impact__status-line">
          סטטוס לאחר שמירה:{" "}
          <strong>{cashControlStatusLabel(preview.afterStatus)}</strong>
        </p>
      ) : null}

      <ImpactBadge kind={preview.messageKind} message={preview.message} />
    </section>
  );
}

export default CashExpenseVarianceImpact;
