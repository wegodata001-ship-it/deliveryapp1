"use client";

import type { Ref } from "react";
import {
  calculatePaymentLine,
  derivePaymentAmountSlots,
  linePaymentMethod,
  normalizePaymentLine,
  paymentSlotsToAmounts,
  roundMoney2,
  type PaymentAmountSlot,
  type PaymentLine,
  type PaymentLineCheck,
  type PaymentLineCurrency,
  type PaymentLineMethod,
  type PaymentLineVatMode,
} from "@/lib/payment-updated";
import { DEFAULT_VAT_RATE } from "@/lib/payment-updated";
import { formatVatPercentLabel } from "@/lib/vat";
import { formatMoneyAmount, formatIlsDisplay, formatUsdDisplay, sanitizeMoneyInput } from "@/lib/money-format";
import { MoneyInput } from "@/components/ui/MoneyInput";

const fmtFooterAmount = formatMoneyAmount;

function paymentMethodLabel(m: PaymentLineMethod): string {
  if (m === "CREDIT") return "אשראי";
  if (m === "BANK_TRANSFER") return "העברה בנקאית";
  if (m === "CASH") return "מזומן";
  if (m === "CHECK") return "צ׳ק";
  return "אחר";
}

function vatModeLabel(v: PaymentLineVatMode): string {
  if (v === "EXEMPT") return "פטור ממע״מ";
  if (v === "BEFORE_VAT") return "לפני מע״מ (לא כולל)";
  return "כולל מע״מ";
}

function lineNote(line: PaymentLine): string {
  const n = normalizePaymentLine(line);
  return (n.note ?? n.usdNote ?? n.ilsNote ?? "").trim();
}

function sanitizeCheckNumberInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 24);
}

function checkFieldMissingNumber(ch: PaymentLineCheck): boolean {
  return !String(ch.checkNumber ?? "").trim();
}

function checkFieldMissingDue(ch: PaymentLineCheck): boolean {
  const y = (ch.dueDateYmd ?? "").trim();
  return !y || !/^\d{4}-\d{2}-\d{2}$/.test(y);
}

function checkFieldMissingAmount(ch: PaymentLineCheck): boolean {
  const a = typeof ch.amount === "number" && Number.isFinite(ch.amount) ? ch.amount : NaN;
  return !Number.isFinite(a) || a <= 0;
}

type CheckBlockProps = {
  currencySym: string;
  checks: PaymentLineCheck[];
  highlightInvalid: boolean;
  onAdd: () => void;
  onRemove: (checkId: string) => void;
  onUpdate: (checkId: string, patch: Partial<PaymentLineCheck>) => void;
};

function PaymentCheckBlock({
  currencySym,
  checks,
  highlightInvalid,
  onAdd,
  onRemove,
  onUpdate,
}: CheckBlockProps) {
  return (
    <div className="payment-upd-checks" dir="rtl">
      <div className="payment-upd-checks-header">
        <span className="payment-upd-checks-header-icon" aria-hidden>
          💳
        </span>
        <span className="payment-upd-checks-header-title">פרטי צ׳יקים</span>
      </div>
      {checks.length === 0 ? (
        <button type="button" className="payment-upd-check-add-row" onClick={onAdd}>
          + הוסף צ׳יק
        </button>
      ) : (
        <>
          <div className="payment-upd-check-cards">
            {checks.map((ch, chi) => (
              <div className="payment-upd-check-card" key={ch.id}>
                <div className="payment-upd-check-card-head">
                  <span className="payment-upd-check-card-title">צ׳יק #{chi + 1}</span>
                  {checks.length > 1 ? (
                    <button
                      type="button"
                      className="payment-upd-check-card-remove"
                      aria-label="הסר צ׳יק"
                      onClick={() => onRemove(ch.id)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
                <div className="payment-upd-check-card-body">
                  <label className="payment-upd-check-field">
                    <span className="payment-upd-check-field-lbl">מס׳ צ׳יק</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      className={[
                        "payment-upd-check-inp",
                        highlightInvalid && checkFieldMissingNumber(ch) ? "payment-upd-check-inp--err" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      value={ch.checkNumber}
                      onChange={(e) =>
                        onUpdate(ch.id, { checkNumber: sanitizeCheckNumberInput(e.target.value) })
                      }
                      autoComplete="off"
                    />
                  </label>
                  <label className="payment-upd-check-field">
                    <span className="payment-upd-check-field-lbl">תאריך פרעון</span>
                    <input
                      type="date"
                      dir="ltr"
                      className={[
                        "payment-upd-check-inp payment-upd-check-inp--date",
                        highlightInvalid && checkFieldMissingDue(ch) ? "payment-upd-check-inp--err" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      value={ch.dueDateYmd}
                      onChange={(e) => onUpdate(ch.id, { dueDateYmd: e.target.value })}
                    />
                  </label>
                  <label className="payment-upd-check-field">
                    <span className="payment-upd-check-field-lbl">סכום צ׳יק</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      className={[
                        "payment-upd-check-inp",
                        highlightInvalid && checkFieldMissingAmount(ch) ? "payment-upd-check-inp--err" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      value={ch.amount === "" ? "" : String(ch.amount)}
                      onChange={(e) => {
                        const raw = sanitizeMoneyInput(e.target.value);
                        if (!raw) onUpdate(ch.id, { amount: "" });
                        else onUpdate(ch.id, { amount: Number(raw) });
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="payment-upd-check-add-row" onClick={onAdd}>
            + הוסף צ׳יק נוסף
          </button>
          <div className="payment-upd-checks-summary" dir="rtl">
            <span className="payment-upd-checks-summary-lbl">סה״כ צ׳יקים</span>
            <span className="payment-upd-checks-summary-val" dir="ltr">
              {currencySym}{" "}
              {fmtFooterAmount(
                roundMoney2(
                  checks.reduce((acc, c) => {
                    const n = typeof c.amount === "number" && Number.isFinite(c.amount) ? c.amount : 0;
                    return acc + n;
                  }, 0),
                ),
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export type PaymentLineDualCardProps = {
  line: PaymentLine;
  ordinal: number;
  isLatest: boolean;
  rateN: number;
  highlightInvalidChecks: boolean;
  firstAmountInputRef?: Ref<HTMLInputElement>;
  onUpdate: (patch: Partial<PaymentLine>) => void;
  onRemove: () => void;
  onEnterInFirstAmount?: () => void;
};

export function PaymentLineDualCard({
  line,
  ordinal,
  isLatest,
  rateN,
  highlightInvalidChecks,
  firstAmountInputRef,
  onUpdate,
  onRemove,
  onEnterInFirstAmount,
}: PaymentLineDualCardProps) {
  const p = normalizePaymentLine(line);
  const calc = calculatePaymentLine(p, rateN, DEFAULT_VAT_RATE);
  const sharedNote = lineNote(p);
  const payMethod = linePaymentMethod(p);
  const [slot1, slot2] = derivePaymentAmountSlots(p);

  const applySlots = (s1: PaymentAmountSlot, s2: PaymentAmountSlot) => {
    onUpdate(paymentSlotsToAmounts(s1, s2));
  };

  const updateSlot = (index: 1 | 2, patch: Partial<PaymentAmountSlot>) => {
    if (index === 1) applySlots({ ...slot1, ...patch }, slot2);
    else applySlots(slot1, { ...slot2, ...patch });
  };

  const patchChecks = (
    side: "usd" | "ils",
    updater: (checks: PaymentLineCheck[]) => PaymentLineCheck[],
  ) => {
    const key = side === "usd" ? "usdChecks" : "ilsChecks";
    const cur = (side === "usd" ? p.usdChecks : p.ilsChecks) ?? [];
    onUpdate({ [key]: updater(cur) } as Partial<PaymentLine>);
  };

  const ensureCheckRow = (side: "usd" | "ils") => {
    const key = side === "usd" ? "usdChecks" : "ilsChecks";
    const cur = (side === "usd" ? p.usdChecks : p.ilsChecks) ?? [];
    const id = `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    onUpdate({
      [key]: [...cur, { id, checkNumber: "", dueDateYmd: "", amount: "" }],
    } as Partial<PaymentLine>);
  };

  const setPaymentMethod = (m: PaymentLineMethod) => {
    const patch: Partial<PaymentLine> = {
      paymentMethod: m,
      usdPaymentMethod: m,
      ilsPaymentMethod: m,
    };
    const usdAmt = typeof p.usdAmount === "number" && p.usdAmount > 0;
    const ilsAmt = typeof p.ilsAmount === "number" && p.ilsAmount > 0;
    if (m === "CHECK") {
      if (usdAmt && !(p.usdChecks?.length ?? 0)) {
        patch.usdChecks = [{ id: `chk_${Date.now()}`, checkNumber: "", dueDateYmd: "", amount: "" }];
      }
      if (ilsAmt && !(p.ilsChecks?.length ?? 0)) {
        patch.ilsChecks = [{ id: `chk_${Date.now()}`, checkNumber: "", dueDateYmd: "", amount: "" }];
      }
    } else {
      patch.usdChecks = undefined;
      patch.ilsChecks = undefined;
    }
    onUpdate(patch);
  };

  const hasUsd = calc.usd.hasAmount;
  const hasIls = calc.ils.hasAmount;
  const hasCalc = hasUsd || hasIls;
  const usdEntered = typeof p.usdAmount === "number" && p.usdAmount > 0;
  const ilsEntered = typeof p.ilsAmount === "number" && p.ilsAmount > 0;

  return (
    <div className={`payment-upd-linecard${isLatest ? " payment-upd-linecard--latest" : ""}`}>
      <div className="payment-upd-linecard-head">
        <div className="payment-upd-linecard-title">
          תשלום {ordinal}
          {isLatest ? <span className="payment-upd-linecard-tag">חדש</span> : null}
        </div>
        <button type="button" className="payment-upd-del" aria-label="מחיקת תשלום" onClick={onRemove}>
          ✕
        </button>
      </div>

      <div className="payment-upd-grid">
        <label className="payment-modal-lbl payment-upd-lbl">
          סכום 1
          <MoneyInput
            ref={firstAmountInputRef}
            className="payment-modal-inp payment-modal-inp--num payment-modal-inp--amount"
            value={slot1.amount === "" ? null : slot1.amount}
            onChange={(n) => updateSlot(1, { amount: n == null ? "" : n })}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              onEnterInFirstAmount?.();
            }}
          />
        </label>
        <label className="payment-modal-lbl payment-upd-lbl">
          מטבע
          <select
            className="payment-modal-inp"
            value={slot1.currency}
            onChange={(e) => updateSlot(1, { currency: e.target.value as PaymentLineCurrency })}
          >
            <option value="USD">$ דולרים</option>
            <option value="ILS">₪ שקלים</option>
          </select>
        </label>

        <label className="payment-modal-lbl payment-upd-lbl payment-upd-lbl--slot2">
          סכום 2
          <MoneyInput
            className="payment-modal-inp payment-modal-inp--num payment-modal-inp--amount"
            value={slot2.amount === "" ? null : slot2.amount}
            onChange={(n) => updateSlot(2, { amount: n == null ? "" : n })}
          />
        </label>
        <label className="payment-modal-lbl payment-upd-lbl payment-upd-lbl--slot2">
          מטבע
          <select
            className="payment-modal-inp"
            value={slot2.currency}
            onChange={(e) => updateSlot(2, { currency: e.target.value as PaymentLineCurrency })}
          >
            <option value="USD">$ דולרים</option>
            <option value="ILS">₪ שקלים</option>
          </select>
        </label>

        <label className="payment-modal-lbl payment-upd-lbl">
          מע״מ
          <select
            className="payment-modal-inp"
            value={p.vatMode}
            onChange={(e) => onUpdate({ vatMode: e.target.value as PaymentLineVatMode })}
          >
            <option value="INCLUDING_VAT">{vatModeLabel("INCLUDING_VAT")}</option>
            <option value="BEFORE_VAT">{vatModeLabel("BEFORE_VAT")}</option>
            <option value="EXEMPT">{vatModeLabel("EXEMPT")}</option>
          </select>
        </label>
        <label className="payment-modal-lbl payment-upd-lbl">
          צורת תשלום
          <select
            className="payment-modal-inp"
            value={payMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentLineMethod)}
          >
            <option value="CREDIT">{paymentMethodLabel("CREDIT")}</option>
            <option value="BANK_TRANSFER">{paymentMethodLabel("BANK_TRANSFER")}</option>
            <option value="CASH">{paymentMethodLabel("CASH")}</option>
            <option value="CHECK">{paymentMethodLabel("CHECK")}</option>
            <option value="OTHER">{paymentMethodLabel("OTHER")}</option>
          </select>
        </label>

        {payMethod === "CHECK" && usdEntered ? (
          <PaymentCheckBlock
            currencySym="$"
            checks={p.usdChecks ?? []}
            highlightInvalid={highlightInvalidChecks}
            onAdd={() => ensureCheckRow("usd")}
            onRemove={(id) =>
              patchChecks("usd", (cur) => (cur.length > 1 ? cur.filter((c) => c.id !== id) : cur))
            }
            onUpdate={(id, patch) =>
              patchChecks("usd", (cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)))
            }
          />
        ) : null}

        {payMethod === "CHECK" && ilsEntered ? (
          <PaymentCheckBlock
            currencySym="₪"
            checks={p.ilsChecks ?? []}
            highlightInvalid={highlightInvalidChecks}
            onAdd={() => ensureCheckRow("ils")}
            onRemove={(id) =>
              patchChecks("ils", (cur) => (cur.length > 1 ? cur.filter((c) => c.id !== id) : cur))
            }
            onUpdate={(id, patch) =>
              patchChecks("ils", (cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)))
            }
          />
        ) : null}

        <label className="payment-modal-lbl payment-upd-lbl payment-upd-lbl--full">
          הערה
          <textarea
            className="payment-modal-ta"
            rows={2}
            value={sharedNote}
            onChange={(e) => onUpdate({ note: e.target.value, usdNote: "", ilsNote: "" })}
            placeholder="הערה קצרה…"
          />
        </label>
      </div>

      {hasCalc ? (
        <div className="payment-upd-calc" dir="rtl" aria-live="polite">
          {hasUsd ? (
            <>
              <div className="payment-upd-calc-row">
                <span>הוזן</span>
                <span dir="ltr">
                  ${" "}
                  {fmtFooterAmount(typeof p.usdAmount === "number" ? p.usdAmount : 0)}
                </span>
              </div>
              <div className="payment-upd-calc-row">
                <span>בסיס לפני מע״מ</span>
                <span dir="ltr">${fmtFooterAmount(calc.usd.baseAmount)}</span>
              </div>
              <div className="payment-upd-calc-row">
                <span>{formatVatPercentLabel()}</span>
                <span dir="ltr">${fmtFooterAmount(calc.usd.vatAmount)}</span>
              </div>
            </>
          ) : null}
          {hasIls ? (
            <>
              <div className="payment-upd-calc-row">
                <span>הוזן (שקל)</span>
                <span dir="ltr">
                  ₪{fmtFooterAmount(typeof p.ilsAmount === "number" ? p.ilsAmount : 0)}
                </span>
              </div>
              <div className="payment-upd-calc-row">
                <span>בסיס לפני מע״מ (שקל)</span>
                <span dir="ltr">₪{fmtFooterAmount(calc.ils.baseAmount)}</span>
              </div>
              <div className="payment-upd-calc-row">
                <span>{formatVatPercentLabel()} (שקל)</span>
                <span dir="ltr">₪{fmtFooterAmount(calc.ils.vatAmount)}</span>
              </div>
            </>
          ) : null}
          <div
            className="payment-upd-calc-row payment-upd-calc-row--net"
            title="סכום לתשלום אחרי מע״מ"
          >
            <span>סכום סופי לתשלום</span>
            <span dir="ltr">
              {hasUsd ? formatUsdDisplay(calc.finalUsd) : null}
              {hasUsd && hasIls ? " · " : null}
              {hasIls ? formatIlsDisplay(calc.finalIls) : null}
            </span>
          </div>
          {calc.finalUsd > 0 ? (
            <div className="payment-upd-calc-row payment-upd-calc-row--usd">
              <span>סכום סופי בדולר</span>
              <span dir="ltr">{formatUsdDisplay(calc.finalUsd)}</span>
            </div>
          ) : null}
          {calc.finalIls > 0 ? (
            <div className="payment-upd-calc-row payment-upd-calc-row--ils">
              <span>סכום סופי בשקל</span>
              <span dir="ltr">{formatIlsDisplay(calc.finalIls)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
