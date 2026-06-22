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
  /** סך ההזמנה לתשלום ב-USD (עסקה + עמלה) */
  payableTotalUsd: number;
  /** שער ₪ ל-$ להמרת שורות בשקלים */
  nisPerUsd: number;
  methodOptions: MethodOption[];
  initialLines: OrderBreakdownLineInput[];
  idPrefix: string;
  onClose: () => void;
  onConfirm: (lines: OrderBreakdownLineInput[]) => void;
};

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function blankLine(defaultMethod: string): OrderBreakdownLineInput {
  return { paymentMethod: defaultMethod, amount: "", currency: "USD" };
}

export default function OrderPaymentBreakdownModal({
  open,
  payableTotalUsd,
  nisPerUsd,
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
    setLines(
      initialLines.length > 0
        ? initialLines.map((l) => ({ ...l }))
        : [blankLine(defaultMethod), blankLine(defaultMethod)],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validation = useMemo(
    () => validateBreakdown(lines, payableTotalUsd, nisPerUsd),
    [lines, payableTotalUsd, nisPerUsd],
  );

  if (!open) return null;

  const setLine = (idx: number, patch: Partial<OrderBreakdownLineInput>) =>
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addLine = () => setLines((cur) => [...cur, blankLine(defaultMethod)]);
  const removeLine = (idx: number) => setLines((cur) => (cur.length <= 1 ? cur : cur.filter((_, i) => i !== idx)));

  const diff = validation.diffUsd;
  let diffMsg: { text: string; tone: "ok" | "short" | "over" };
  if (Math.abs(diff) <= 0.01) diffMsg = { text: "החלוקה תואמת לסך ההזמנה", tone: "ok" };
  else if (diff < 0) diffMsg = { text: `חסר ${fmtUsd(Math.abs(diff))}`, tone: "short" };
  else diffMsg = { text: `עודף ${fmtUsd(diff)}`, tone: "over" };

  return (
    <div className="adm-pbd-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-pbd-modal"
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
            {lines.map((line, idx) => (
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
                  <input
                    className="adm-pbd-inp adm-pbd-inp--num"
                    inputMode="decimal"
                    value={line.amount}
                    placeholder="0.00"
                    onChange={(e) => setLine(idx, { amount: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="adm-pbd-inp adm-pbd-inp--cur"
                    value={line.currency}
                    onChange={(e) => setLine(idx, { currency: e.target.value as BreakdownCurrency })}
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
            ))}
          </tbody>
        </table>

        <button type="button" className="adm-pbd-add" onClick={addLine}>
          <Plus size={15} /> הוסף אמצעי תשלום
        </button>

        <div className="adm-pbd-summary">
          <div className="adm-pbd-summary-row">
            <span>סה"כ הזמנה</span>
            <strong>{fmtUsd(payableTotalUsd)}</strong>
          </div>
          <div className="adm-pbd-summary-row">
            <span>סה"כ חלוקה</span>
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
            disabled={!validation.ok}
            onClick={() => {
              if (!validation.ok) return;
              const clean = lines.filter((l) => (l.amount || "").trim() !== "" && Number(l.amount.replace(",", ".")) > 0);
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
