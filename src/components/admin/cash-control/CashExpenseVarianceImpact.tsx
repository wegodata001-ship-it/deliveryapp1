"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";
import type { CashCurrency } from "@/app/admin/cash-control/constants";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import {
  channelLabel,
  expenseToDailyMethodId,
  type CashExpensePaymentMethod,
} from "@/lib/cash-expense-payment-method";
import {
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

function StatusMsg({
  kind,
  message,
}: {
  kind: ReturnType<typeof previewExpenseVarianceImpact>["messageKind"];
  message: string;
}) {
  if (kind === "closes") {
    return (
      <p className="cc-var-impact__msg is-closes">
        <CheckCircle2 size={14} aria-hidden /> {message}
      </p>
    );
  }
  if (kind === "reduces") {
    return (
      <p className="cc-var-impact__msg is-reduces">
        <AlertTriangle size={14} aria-hidden /> {message}
      </p>
    );
  }
  if (kind === "still_open") {
    return (
      <p className="cc-var-impact__msg is-still_open">
        <AlertTriangle size={14} aria-hidden /> {message}
      </p>
    );
  }
  if (kind === "no_count") {
    return (
      <p className="cc-var-impact__msg is-no_count">
        <Clock size={14} aria-hidden /> {message} <strong>ממתין לספירה</strong>
      </p>
    );
  }
  return (
    <p className="cc-var-impact__msg is-invalid_amount">
      <Info size={14} aria-hidden /> {message}
    </p>
  );
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
      <section className="cc-var-impact" aria-label="השפעה על בקרת הקופה">
        <h4 className="cc-var-impact__title">השפעה על בקרת הקופה</h4>
        <p className="cc-muted">טוען מצב קופה…</p>
      </section>
    );
  }

  if (!preview || preview.messageKind === "no_cash_line") {
    return null;
  }

  const channel = channelLabel(preview.method, preview.currency);

  return (
    <section className="cc-var-impact" aria-label="השפעה על בקרת הקופה">
      <h4 className="cc-var-impact__title">השפעה על בקרת הקופה</h4>

      <p className="cc-var-impact__channel">
        ערוץ: <strong>{channel}</strong>
      </p>

      <ul className="cc-var-impact__list">
        <li>
          <span>התקבל / שולם:</span>
          <strong dir="ltr">{fmtDailyMoney(currency, preview.currentExpectedAmount)}</strong>
        </li>
        <li>
          <span>הוצאות קיימות:</span>
          <strong dir="ltr">{fmtDailyMoney(currency, preview.currentExpensesAmount)}</strong>
        </li>
        {preview.proposedExpenseAmount > 0 ? (
          <li>
            <span>הוצאה חדשה:</span>
            <strong dir="ltr">{fmtDailyMoney(currency, preview.proposedExpenseAmount)}</strong>
          </li>
        ) : null}
        <li>
          <span>צפוי נטו{preview.proposedExpenseAmount > 0 ? " לאחר השמירה" : ""}:</span>
          <strong dir="ltr">
            {fmtDailyMoney(
              currency,
              preview.proposedExpenseAmount > 0 ? preview.afterExpectedNet : preview.currentExpectedNet,
            )}
          </strong>
        </li>
        <li>
          <span>ספירה בפועל:</span>
          <strong dir="ltr">
            {preview.currentCounted != null ? fmtDailyMoney(currency, preview.currentCounted) : "—"}
          </strong>
        </li>
        <li>
          <span>חריגה{preview.proposedExpenseAmount > 0 ? " לאחר השמירה" : " נוכחית"}:</span>
          <strong dir="ltr" className="cc-var-impact__var">
            {formatVarianceShort(
              currency,
              preview.proposedExpenseAmount > 0 ? preview.afterVariance : preview.currentVariance,
            )}
          </strong>
        </li>
      </ul>

      <StatusMsg kind={preview.messageKind} message={preview.message} />
    </section>
  );
}

export default CashExpenseVarianceImpact;
