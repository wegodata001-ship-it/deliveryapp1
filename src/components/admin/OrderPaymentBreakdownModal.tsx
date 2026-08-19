"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  type BreakdownCurrency,
  type OrderBreakdownLineInput,
  validateBreakdown,
  breakdownLineUsd,
} from "@/lib/payment-breakdown-shared";
import { PM } from "@/lib/payment-method-slugs";

type MethodOption = { value: string; label: string };

type Props = {
  open: boolean;
  /** סך ההזמנה לתשלום ב-USD (עסקה + עמלה) */
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  const defaultMethod = methodOptions[0]?.value ?? PM.CASH;
  const [lines, setLines] = useState<OrderBreakdownLineInput[]>([]);

  useEffect(() => {
    if (!open) return;
    const preferCurrency: BreakdownCurrency =
      availableUsd > EPS ? "USD" : availableIls > EPS ? "ILS" : "USD";
    setLines(
      initialLines.length > 0
        ? initialLines.map((l) => ({ ...l }))
        : [{ ...blankLine(defaultMethod), currency: preferCurrency }],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validation = useMemo(
    () => validateBreakdown(lines, payableTotalUsd, nisPerUsd),
    [lines, payableTotalUsd, nisPerUsd],
  );

  const allocatedUsd = validation.sumUsd;
  const remainingUsd = round2(Math.max(0, payableTotalUsd - allocatedUsd));

  const usdCap = availableUsd > EPS ? round2(availableUsd) : null;
  const ilsCap = availableIls > EPS ? round2(availableIls) : null;

  let allocatedNative = { usd: 0, ils: 0 };
  for (const line of lines) {
    const amt = parseAmount(line.amount);
    if (amt <= 0) continue;
    if (line.currency === "ILS") allocatedNative.ils += amt;
    else allocatedNative.usd += amt;
  }
  allocatedNative = { usd: round2(allocatedNative.usd), ils: round2(allocatedNative.ils) };

  const usdRemaining = usdCap != null ? round2(usdCap - allocatedNative.usd) : null;
  const ilsRemaining = ilsCap != null ? round2(ilsCap - allocatedNative.ils) : null;

  const usdOver = usdCap != null && allocatedNative.usd > usdCap + EPS;
  const ilsOver = ilsCap != null && allocatedNative.ils > ilsCap + EPS;

  const currencyErrors = useMemo(() => {
    const errs: string[] = [];
    if (usdOver && usdCap != null) {
      errs.push(
        `חריגה בדולר: חולק ${fmtUsd(allocatedNative.usd)} מתוך ${fmtUsd(usdCap)} הזמינים (עודף ${fmtUsd(allocatedNative.usd - usdCap)})`,
      );
    }
    if (ilsOver && ilsCap != null) {
      errs.push(
        `חריגה בשקל: חולק ${fmtIls(allocatedNative.ils)} מתוך ${fmtIls(ilsCap)} הזמינים (עודף ${fmtIls(allocatedNative.ils - ilsCap)})`,
      );
    }
    return errs;
  }, [usdOver, ilsOver, usdCap, ilsCap, allocatedNative.usd, allocatedNative.ils]);

  const canConfirm = validation.ok && !usdOver && !ilsOver;
  const splitDisabled = remainingUsd < EPS || !Number.isFinite(remainingUsd);
  const rateOk = Number.isFinite(nisPerUsd) && nisPerUsd > 0;
  const ilsFillDisabled = splitDisabled || !rateOk;

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

  const fillRemainingCashUsd = () => {
    if (splitDisabled) return;
    const s = remainingUsd.toFixed(2);
    setLines((cur) => {
      const idx = cur.findIndex((r) => r.paymentMethod === PM.CASH && !r.amount.trim());
      if (idx >= 0) {
        return cur.map((r, i) => (i === idx ? { ...r, currency: "USD", amount: s } : r));
      }
      return [...cur, { paymentMethod: PM.CASH, currency: "USD", amount: s }];
    });
  };

  const fillRemainingCashIls = () => {
    if (ilsFillDisabled) return;
    const nis = round2(remainingUsd * nisPerUsd);
    if (nis <= 0) return;
    const s = nis.toFixed(2);
    setLines((cur) => {
      const idx = cur.findIndex((r) => r.paymentMethod === PM.CASH && !r.amount.trim());
      if (idx >= 0) {
        return cur.map((r, i) => (i === idx ? { ...r, currency: "ILS", amount: s } : r));
      }
      return [...cur, { paymentMethod: PM.CASH, currency: "ILS", amount: s }];
    });
  };

  const splitRemainingHalfCashCredit = () => {
    if (splitDisabled) return;
    const rem = remainingUsd;
    const half = round2(rem / 2);
    const other = round2(rem - half);
    setLines((cur) => [
      ...cur,
      { paymentMethod: PM.CASH, currency: "USD", amount: half.toFixed(2) },
      { paymentMethod: PM.CREDIT, currency: "USD", amount: other.toFixed(2) },
    ]);
  };

  const diff = validation.diffUsd;
  let diffMsg: { text: string; tone: "ok" | "short" | "over" };
  if (Math.abs(diff) <= 0.01) diffMsg = { text: "החלוקה תואמת לסך ההזמנה", tone: "ok" };
  else if (diff < 0) diffMsg = { text: `חסר ${fmtUsd(Math.abs(diff))}`, tone: "short" };
  else diffMsg = { text: `עודף ${fmtUsd(diff)}`, tone: "over" };

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
          <div>
            <h4 id={`${idPrefix}-pbd-title`}>תשלום מורכב</h4>
            <p className="adm-pbd-subtitle">חלוקת סכום ההזמנה בין מספר אמצעי תשלום</p>
          </div>
          <button type="button" className="adm-pbd-x" aria-label="סגירה" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="adm-pbd-totals-bar" aria-live="polite">
          <div className="adm-pbd-totals-bar__item">
            <span>סה״כ לתשלום</span>
            <strong dir="ltr">{fmtUsd(payableTotalUsd)}</strong>
          </div>
          <div className="adm-pbd-totals-bar__item">
            <span>שולם בחלוקה</span>
            <strong dir="ltr">{fmtUsd(allocatedUsd)}</strong>
          </div>
          <div className="adm-pbd-totals-bar__item">
            <span>נשאר לחלוקה</span>
            <strong dir="ltr" className={remainingUsd > EPS ? "adm-pbd-neg" : ""}>
              {fmtUsd(remainingUsd)}
            </strong>
          </div>
        </div>

        {(usdCap != null || ilsCap != null) && (
          <div className="adm-pbd-avail" aria-label="סכומים זמינים לחלוקה">
            {usdCap != null ? (
              <div className={`adm-pbd-avail-card${usdOver ? " adm-pbd-avail-card--err" : ""}`}>
                <div className="adm-pbd-avail-card__title">דולר (USD)</div>
                <div className="adm-pbd-avail-card__row">
                  <span>סה״כ</span>
                  <strong>{fmtUsd(usdCap)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>חולק</span>
                  <strong>{fmtUsd(allocatedNative.usd)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>נותר</span>
                  <strong className={usdRemaining != null && usdRemaining < -EPS ? "adm-pbd-neg" : ""}>
                    {fmtUsd(usdRemaining ?? 0)}
                  </strong>
                </div>
              </div>
            ) : null}
            {ilsCap != null ? (
              <div className={`adm-pbd-avail-card${ilsOver ? " adm-pbd-avail-card--err" : ""}`}>
                <div className="adm-pbd-avail-card__title">שקל (ILS)</div>
                <div className="adm-pbd-avail-card__row">
                  <span>סה״כ</span>
                  <strong>{fmtIls(ilsCap)}</strong>
                </div>
                <div className="adm-pbd-avail-card__row">
                  <span>חולק</span>
                  <strong>{fmtIls(allocatedNative.ils)}</strong>
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

        <div className="adm-pbd-table-scroll">
          <table className="adm-pbd-table">
            <thead>
              <tr>
                <th>אמצעי תשלום</th>
                <th>מטבע</th>
                <th>סכום</th>
                <th>שווי בדולר</th>
                <th aria-label="פעולות" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const amt = parseAmount(line.amount);
                const usdEq = breakdownLineUsd(line, nisPerUsd);
                const ilsHint =
                  line.currency === "ILS" && rateOk && amt > 0
                    ? `${fmtIls(amt)} = ${fmtUsd(usdEq ?? 0)} לפי שער ${nisPerUsd.toFixed(2)}`
                    : null;
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
                      <select
                        className="adm-pbd-inp adm-pbd-inp--cur"
                        value={line.currency}
                        onChange={(e) =>
                          setLine(idx, { currency: e.target.value as BreakdownCurrency })
                        }
                      >
                        <option value="USD">USD</option>
                        <option value="ILS">ILS</option>
                      </select>
                    </td>
                    <td>
                      <div className="adm-pbd-amount-wrap">
                        <input
                          className="adm-pbd-inp adm-pbd-inp--num"
                          inputMode="decimal"
                          value={line.amount}
                          placeholder={line.currency === "ILS" ? "0.00 ₪" : "0.00 $"}
                          dir="ltr"
                          onChange={(e) => setLine(idx, { amount: e.target.value })}
                        />
                        {ilsHint ? (
                          <span className="adm-pbd-amount-hint" dir="ltr">
                            {ilsHint}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td dir="ltr" className="adm-pbd-usd-eq">
                      {usdEq != null && amt > 0 ? fmtUsd(usdEq) : "—"}
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
        </div>

        <button type="button" className="adm-pbd-add" onClick={addLine}>
          <Plus size={15} /> הוסף אמצעי תשלום
        </button>

        <div className="adm-pbd-split-tools">
          <span className="adm-pbd-split-tools__lbl">חלוקה מהירה</span>
          <div className="adm-pbd-split-btns">
            <button
              type="button"
              className="adm-btn adm-btn--dense adm-pay-split-btn"
              disabled={splitDisabled}
              onClick={fillRemainingCashUsd}
            >
              מלא לפי דולר
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--dense adm-pay-split-btn"
              disabled={ilsFillDisabled}
              onClick={fillRemainingCashIls}
            >
              מלא לפי שקל
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--dense adm-pay-split-btn"
              disabled={splitDisabled}
              onClick={splitRemainingHalfCashCredit}
            >
              חצי חצי
            </button>
          </div>
        </div>

        {currencyErrors.length > 0 ? (
          <div className="adm-pbd-currency-errors" role="alert">
            {currencyErrors.map((msg) => (
              <div key={msg}>{msg}</div>
            ))}
          </div>
        ) : null}

        <div className="adm-pbd-summary">
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
            אישור חלוקת תשלום
          </button>
        </div>
      </div>
    </div>
  );
}
