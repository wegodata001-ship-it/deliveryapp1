"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  type BreakdownCurrency,
  type OrderBreakdownLineInput,
  validateBreakdown,
} from "@/lib/payment-breakdown-shared";

type MethodOption = { value: string; label: string };

type Props = {
  open: boolean;
  /** סך ההזמנה לתשלום ב-USD (עסקה + עמלה) — לוגיקת אישור קיימת */
  payableTotalUsd: number;
  /** שער ₪ ל-$ להמרת שורות בשקלים */
  nisPerUsd: number;
  /**
   * סכומים זמינים לחלוקה במטבע מקורי — כפי שהוזנו בקליטה (כולל עמלה יחסית).
   * 0 = המטבע לא הוזן; לא נאכפת תקרה על מטבע שלא הוזן (תאימות להמרה).
   */
  availableUsd: number;
  availableIls: number;
  methodOptions: MethodOption[];
  initialLines: OrderBreakdownLineInput[];
  idPrefix: string;
  onClose: () => void;
  onConfirm: (lines: OrderBreakdownLineInput[]) => void;
};

const EPS = 0.01;

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtIls = (n: number) =>
  `₪${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function blankLine(defaultMethod: string): OrderBreakdownLineInput {
  return { paymentMethod: defaultMethod, amount: "", currency: "USD" };
}

function parseAmount(raw: string): number {
  const n = Number((raw || "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sumAllocatedByCurrency(lines: OrderBreakdownLineInput[]): { usd: number; ils: number } {
  let usd = 0;
  let ils = 0;
  for (const line of lines) {
    const amt = parseAmount(line.amount);
    if (amt <= 0) continue;
    if (line.currency === "ILS") ils += amt;
    else usd += amt;
  }
  return {
    usd: Math.round(usd * 100) / 100,
    ils: Math.round(ils * 100) / 100,
  };
}

export default function OrderPaymentBreakdownModal({
  open,
  payableTotalUsd,
  nisPerUsd,
  availableUsd,
  availableIls,
  methodOptions,
  initialLines,
  idPrefix,
  onClose,
  onConfirm,
}: Props) {
  const defaultMethod = methodOptions[0]?.value ?? "CASH";
  const [lines, setLines] = useState<OrderBreakdownLineInput[]>([]);

  useEffect(() => {
    if (!open) return;
    const preferCurrency: BreakdownCurrency =
      availableUsd > EPS ? "USD" : availableIls > EPS ? "ILS" : "USD";
    setLines(
      initialLines.length > 0
        ? initialLines.map((l) => ({ ...l }))
        : [
            { ...blankLine(defaultMethod), currency: preferCurrency },
            { ...blankLine(defaultMethod), currency: preferCurrency },
          ],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validation = useMemo(
    () => validateBreakdown(lines, payableTotalUsd, nisPerUsd),
    [lines, payableTotalUsd, nisPerUsd],
  );

  const allocated = useMemo(() => sumAllocatedByCurrency(lines), [lines]);

  const usdCap = availableUsd > EPS ? Math.round(availableUsd * 100) / 100 : null;
  const ilsCap = availableIls > EPS ? Math.round(availableIls * 100) / 100 : null;

  const usdRemaining = usdCap != null ? Math.round((usdCap - allocated.usd) * 100) / 100 : null;
  const ilsRemaining = ilsCap != null ? Math.round((ilsCap - allocated.ils) * 100) / 100 : null;

  const usdOver = usdCap != null && allocated.usd > usdCap + EPS;
  const ilsOver = ilsCap != null && allocated.ils > ilsCap + EPS;

  const currencyErrors = useMemo(() => {
    const errs: string[] = [];
    if (usdOver && usdCap != null) {
      errs.push(
        `חריגה בדולר: חולק ${fmtUsd(allocated.usd)} מתוך ${fmtUsd(usdCap)} הזמינים (עודף ${fmtUsd(allocated.usd - usdCap)})`,
      );
    }
    if (ilsOver && ilsCap != null) {
      errs.push(
        `חריגה בשקל: חולק ${fmtIls(allocated.ils)} מתוך ${fmtIls(ilsCap)} הזמינים (עודף ${fmtIls(allocated.ils - ilsCap)})`,
      );
    }
    return errs;
  }, [usdOver, ilsOver, usdCap, ilsCap, allocated.usd, allocated.ils]);

  const canConfirm = validation.ok && !usdOver && !ilsOver;

  if (!open) return null;

  const setLine = (idx: number, patch: Partial<OrderBreakdownLineInput>) =>
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addLine = () => {
    const preferCurrency: BreakdownCurrency =
      availableUsd > EPS ? "USD" : availableIls > EPS ? "ILS" : "USD";
    setLines((cur) => [...cur, { ...blankLine(defaultMethod), currency: preferCurrency }]);
  };
  const removeLine = (idx: number) =>
    setLines((cur) => (cur.length <= 1 ? cur : cur.filter((_, i) => i !== idx)));

  const diff = validation.diffUsd;
  let diffMsg: { text: string; tone: "ok" | "short" | "over" };
  if (Math.abs(diff) <= 0.01) diffMsg = { text: "החלוקה תואמת לסך ההזמנה", tone: "ok" };
  else if (diff < 0) diffMsg = { text: `חסר ${fmtUsd(Math.abs(diff))}`, tone: "short" };
  else diffMsg = { text: `עודף ${fmtUsd(diff)}`, tone: "over" };

  const showUsdCard = usdCap != null;
  const showIlsCard = ilsCap != null;

  function remainingHint(currency: BreakdownCurrency): string | null {
    if (currency === "USD" && usdRemaining != null) {
      return `נותר לחלוקה: ${fmtUsd(Math.max(0, usdRemaining))}`;
    }
    if (currency === "ILS" && ilsRemaining != null) {
      return `נותר לחלוקה: ${fmtIls(Math.max(0, ilsRemaining))}`;
    }
    return null;
  }

  return (
    <div className="adm-pbd-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-pbd-modal adm-pbd-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-pbd-title`}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="adm-pbd-head">
          <h4 id={`${idPrefix}-pbd-title`}>חלוקת תשלום</h4>
          <button type="button" className="adm-pbd-x" aria-label="סגירה" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {(showUsdCard || showIlsCard) && (
          <div className="adm-pbd-avail" aria-label="סכומים זמינים לחלוקה">
            {showUsdCard ? (
              <div className={`adm-pbd-avail-card${usdOver ? " adm-pbd-avail-card--err" : ""}`}>
                <div className="adm-pbd-avail-card__title">דולר (USD)</div>
                <div className="adm-pbd-avail-card__row">
                  <span>סה״כ</span>
                  <strong>{fmtUsd(usdCap ?? 0)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>חולק</span>
                  <strong>{fmtUsd(allocated.usd)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>נותר</span>
                  <strong className={usdRemaining != null && usdRemaining < -EPS ? "adm-pbd-neg" : ""}>
                    {fmtUsd(usdRemaining ?? 0)}
                  </strong>
                </div>
              </div>
            ) : null}
            {showIlsCard ? (
              <div className={`adm-pbd-avail-card${ilsOver ? " adm-pbd-avail-card--err" : ""}`}>
                <div className="adm-pbd-avail-card__title">שקל (ILS)</div>
                <div className="adm-pbd-avail-card__row">
                  <span>סה״כ</span>
                  <strong>{fmtIls(ilsCap ?? 0)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>חולק</span>
                  <strong>{fmtIls(allocated.ils)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>נותר</span>
                  <strong className={ilsRemaining != null && ilsRemaining < -EPS ? "adm-pbd-neg" : ""}>
                    {fmtIls(ilsRemaining ?? 0)}
                  </strong>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <table className="adm-pbd-table">
          <thead>
            <tr>
              <th>אמצעי תשלום</th>
              <th>סכום</th>
              <th>מטבע</th>
              <th aria-label="פעולות" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const hint = remainingHint(line.currency);
              return (
                <tr key={idx}>
                  <td>
                    <select
                      className="adm-pbd-inp"
                      value={line.paymentMethod}
                      onChange={(e) => setLine(idx, { paymentMethod: e.target.value })}
                    >
                      {methodOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="adm-pbd-amount-wrap">
                      <input
                        className="adm-pbd-inp adm-pbd-inp--num"
                        inputMode="decimal"
                        value={line.amount}
                        placeholder="0.00"
                        onChange={(e) => setLine(idx, { amount: e.target.value })}
                        aria-describedby={hint ? `${idPrefix}-hint-${idx}` : undefined}
                      />
                      {hint ? (
                        <span id={`${idPrefix}-hint-${idx}`} className="adm-pbd-amount-hint">
                          {hint}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <select
                      className="adm-pbd-inp adm-pbd-inp--cur"
                      value={line.currency}
                      onChange={(e) =>
                        setLine(idx, { currency: e.target.value as BreakdownCurrency })
                      }
                    >
                      <option value="USD">$</option>
                      <option value="ILS">₪</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="adm-pbd-del"
                      aria-label="הסר שורה"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(idx)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button type="button" className="adm-pbd-add" onClick={addLine}>
          <Plus size={15} /> הוסף אמצעי תשלום
        </button>

        {currencyErrors.length > 0 ? (
          <div className="adm-pbd-currency-errors" role="alert">
            {currencyErrors.map((msg) => (
              <div key={msg}>{msg}</div>
            ))}
          </div>
        ) : null}

        <div className="adm-pbd-summary">
          <div className="adm-pbd-summary-row">
            <span>סה&quot;כ הזמנה</span>
            <strong>{fmtUsd(payableTotalUsd)}</strong>
          </div>
          <div className="adm-pbd-summary-row">
            <span>סה&quot;כ חלוקה</span>
            <strong>{fmtUsd(validation.sumUsd)}</strong>
          </div>
          <div className={`adm-pbd-diff adm-pbd-diff--${diffMsg.tone}`}>{diffMsg.text}</div>
        </div>

        <div className="adm-pbd-actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary adm-btn--dense"
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) return;
              const clean = lines.filter(
                (l) => (l.amount || "").trim() !== "" && Number(l.amount.replace(",", ".")) > 0,
              );
              onConfirm(clean);
            }}
          >
            שמירת חלוקה
          </button>
        </div>
      </div>
    </div>
  );
}
