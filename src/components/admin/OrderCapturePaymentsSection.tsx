"use client";

import { PaymentMethod, OrderStatus } from "@prisma/client";
import { Plus, Trash2 } from "lucide-react";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";

export type OrderCapturePaymentLineCurrency = "USD" | "ILS";

export type OrderCapturePaymentRow = {
  id: string;
  paymentMethod: PaymentMethod;
  /** מטבע הסכום בשורה — USD או ₪ (המרה ל-USD בשרת לפי שער ההזמנה) */
  currency: OrderCapturePaymentLineCurrency;
  amount: string;
};

type Props = {
  idPrefix: string;
  disabled: boolean;
  rows: OrderCapturePaymentRow[];
  onAddRow: () => void;
  onChangeRow: (
    id: string,
    patch: Partial<Pick<OrderCapturePaymentRow, "paymentMethod" | "amount" | "currency">>,
  ) => void;
  onRemoveRow: (id: string) => void;
  formPaymentsUsd: number;
  existingPaidUsd: number;
  orderTotalUsd: number | null;
  validationError: string | null;
  orderStatus: OrderStatus;
  onOrderStatusChange: (s: OrderStatus) => void;
  orderStatusLabels: Record<OrderStatus, string>;
  onFillRemainingCash: () => void;
  /** מילוי היתרה במזומן בשקלים (לפי שער ₪/USD) */
  onFillRemainingCashIls?: () => void;
  onSplitRemainingHalfCashCredit: () => void;
  /** שער להצגת שווי USD בשורות ₪ ולחישוב כפתור «נותר ב-₪» */
  rateNisPerUsd?: number | null;
  /** כאשר מוצג סטטוס הזמנה מחוץ לרכיב (למשל סרגל צד בפריסת legacy) */
  hideOrderStatus?: boolean;
};

function fmtUsd(n: number) {
  return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtIlsPlain(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
}

function parseDec(s: string): number {
  const t = s.replace(",", ".").trim();
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function OrderCapturePaymentsSection({
  idPrefix,
  disabled,
  rows,
  onAddRow,
  onChangeRow,
  onRemoveRow,
  formPaymentsUsd,
  existingPaidUsd,
  orderTotalUsd,
  validationError,
  orderStatus,
  onOrderStatusChange,
  orderStatusLabels,
  onFillRemainingCash,
  onFillRemainingCashIls,
  onSplitRemainingHalfCashCredit,
  rateNisPerUsd,
  hideOrderStatus = false,
}: Props) {
  const splitHintText = "מילוי מהיר של היתרה שנותרה לתשלום.";

  const totalPaidAll = existingPaidUsd + formPaymentsUsd;
  const remainingUsd =
    orderTotalUsd != null && Number.isFinite(orderTotalUsd) ? Math.max(0, orderTotalUsd - totalPaidAll) : null;

  const hasOrderTotal = orderTotalUsd != null && Number.isFinite(orderTotalUsd) && orderTotalUsd > 0;
  const progressPct =
    hasOrderTotal && orderTotalUsd! > 0 ? Math.min(100, Math.max(0, (totalPaidAll / orderTotalUsd!) * 100)) : 0;

  const showUnderpay =
    hasOrderTotal && remainingUsd != null && remainingUsd > 0.01 && Number.isFinite(remainingUsd);
  const showPaidFull =
    hasOrderTotal && remainingUsd != null && remainingUsd <= 0.01 && totalPaidAll > 0 && !showUnderpay;

  const splitDisabled = disabled || remainingUsd == null || remainingUsd < 0.01 || !Number.isFinite(remainingUsd);
  const rateOk = rateNisPerUsd != null && Number.isFinite(rateNisPerUsd) && rateNisPerUsd > 0;
  const ilsFillDisabled = splitDisabled || !rateOk || !onFillRemainingCashIls;

  return (
    <section className="adm-capture-sec adm-cap-sec-splitpay adm-pay-unified-section" aria-labelledby={`${idPrefix}-pay-sec`}>
      <div className="adm-pay-unified-card">
        <h3 id={`${idPrefix}-pay-sec`} className="adm-pay-unified-title">
          תשלום
        </h3>

        {!hideOrderStatus ? (
          <div className="adm-pay-meta-row">
            <div className="adm-field adm-field--capture">
              <label htmlFor={`${idPrefix}-status`}>סטטוס הזמנה</label>
              <select
                id={`${idPrefix}-status`}
                value={orderStatus}
                disabled={disabled}
                onChange={(e) => onOrderStatusChange(e.target.value as OrderStatus)}
              >
                {Object.values(OrderStatus).map((s) => (
                  <option key={s} value={s}>
                    {orderStatusLabels[s] ?? s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        <div className="adm-pay-order-total-line" aria-live="polite">
          {hasOrderTotal ? (
            <>
              <span className="adm-pay-order-total-lbl">סה״כ להזמנה</span>
              <strong className="adm-pay-order-total-val" dir="ltr">
                {fmtUsd(orderTotalUsd!)}
              </strong>
            </>
          ) : (
            <span className="adm-pay-order-total-muted">הזינו סכום בסעיף «סכומים» כדי לחשב סה״כ ויתרה.</span>
          )}
        </div>

        {hasOrderTotal ? (
          <div className="adm-pay-progress" aria-hidden={!hasOrderTotal}>
            <div className="adm-pay-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        ) : null}

        {existingPaidUsd > 0 ? (
          <p className="adm-pay-existing-line" dir="ltr">
            שולם כבר במערכת: <strong>{fmtUsd(existingPaidUsd)}</strong>
          </p>
        ) : null}

        {formPaymentsUsd > 0 && hasOrderTotal ? (
          <p className="adm-pay-form-equiv-line" dir="ltr">
            שווי סכום השורות בטופס: <strong>{fmtUsd(formPaymentsUsd)}</strong>
            {rateOk ? (
              <span className="adm-pay-form-equiv-ils"> · ≈ {fmtIlsPlain(formPaymentsUsd * rateNisPerUsd!)}</span>
            ) : null}
          </p>
        ) : null}

        <h4 className="adm-pay-split-heading">תשלומים</h4>

        <div className="adm-pay-table-scroll adm-pay-table-scroll--when-needed">
          <table className="adm-pay-compact-table adm-pay-table--split-currency">
            <thead>
              <tr>
                <th scope="col" className="adm-pay-col-method">
                  אמצעי
                </th>
                <th scope="col" className="adm-pay-col-curr">
                  מטבע
                </th>
                <th scope="col" className="adm-pay-col-amt-only">
                  סכום
                </th>
                <th scope="col" className="adm-pay-col-act" aria-label="פעולות" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const ilsAmt = row.currency === "ILS" && rateOk ? parseDec(row.amount) : NaN;
                const ilsToUsdHint =
                  row.currency === "ILS" && rateOk && Number.isFinite(ilsAmt) && ilsAmt > 0
                    ? ilsAmt / rateNisPerUsd!
                    : null;
                return (
                <tr key={row.id}>
                  <td>
                    <select
                      id={`${idPrefix}-pm-${row.id}`}
                      value={row.paymentMethod}
                      disabled={disabled}
                      onChange={(e) => onChangeRow(row.id, { paymentMethod: e.target.value as PaymentMethod })}
                      className="adm-pay-cell-select"
                      aria-label={`אמצעי תשלום שורה ${i + 1}`}
                    >
                      {ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((m) => (
                        <option key={m.value} value={String(m.value)}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      id={`${idPrefix}-cur-${row.id}`}
                      value={row.currency ?? "USD"}
                      disabled={disabled}
                      onChange={(e) =>
                        onChangeRow(row.id, { currency: e.target.value as OrderCapturePaymentLineCurrency })
                      }
                      className="adm-pay-cell-select adm-pay-cell-select--curr"
                      aria-label={`מטבע שורת תשלום ${i + 1}`}
                    >
                      <option value="USD">USD</option>
                      <option value="ILS">₪ ILS</option>
                    </select>
                  </td>
                  <td>
                    <div className="adm-pay-amt-cell">
                      <input
                        id={`${idPrefix}-amt-${row.id}`}
                        type="text"
                        inputMode="decimal"
                        placeholder={row.currency === "ILS" ? "0.00 ₪" : "0.00 $"}
                        disabled={disabled}
                        value={row.amount}
                        onChange={(e) => onChangeRow(row.id, { amount: e.target.value })}
                        dir="ltr"
                        className="adm-pay-cell-input"
                        aria-label={`סכום שורת תשלום ${i + 1} (${row.currency === "ILS" ? "שקלים" : "דולר"})`}
                      />
                      {ilsToUsdHint != null ? (
                        <div className="adm-pay-row-usd-hint" dir="ltr">
                          ≈ {fmtUsd(ilsToUsdHint)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="adm-pay-col-act">
                    <button
                      type="button"
                      className="adm-btn adm-btn--ghost adm-btn--dense adm-pay-row-remove adm-pay-remove-icon"
                      disabled={disabled}
                      onClick={() => onRemoveRow(row.id)}
                      aria-label={`הסרת שורת תשלום ${i + 1}`}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>

        <div className="adm-pay-remaining-block" aria-live="polite">
          <span className="adm-pay-remaining-lbl">נשאר לתשלום (USD)</span>
          <strong className={showUnderpay ? "adm-pay-remaining-val adm-pay-remaining-val--warn" : "adm-pay-remaining-val"} dir="ltr">
            {remainingUsd != null ? fmtUsd(remainingUsd) : "—"}
          </strong>
        </div>

        {showUnderpay ? (
          <div className="adm-pay-warning" role="status">
            ⚠ לא שולם במלואו — נותר <span dir="ltr">{fmtUsd(remainingUsd!)}</span>
          </div>
        ) : null}

        {showPaidFull ? (
          <div className="adm-pay-success" role="status">
            ✔ שולם במלואו
          </div>
        ) : null}

        <div className="adm-pay-toolbar-row">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={disabled} onClick={onAddRow}>
            <Plus size={14} aria-hidden />+ הוסף תשלום
          </button>
        </div>

        <div className="adm-pay-split-tools">
          <div className="adm-pay-split-btns">
            <button
              type="button"
              className="adm-btn adm-btn--dense adm-pay-split-btn"
              disabled={splitDisabled}
              onClick={onFillRemainingCash}
              title={splitHintText}
            >
              מלא לפי דולר
            </button>
            {onFillRemainingCashIls ? (
              <button
                type="button"
                className="adm-btn adm-btn--dense adm-pay-split-btn"
                disabled={ilsFillDisabled}
                onClick={onFillRemainingCashIls}
                title={splitHintText}
              >
                מלא לפי שקל
              </button>
            ) : null}
            <button
              type="button"
              className="adm-btn adm-btn--dense adm-pay-split-btn"
              disabled={splitDisabled}
              onClick={onSplitRemainingHalfCashCredit}
              title={splitHintText}
            >
              חצי חצי
            </button>
          </div>
        </div>

        {validationError ? <div className="adm-error adm-error--compact adm-pay-err">{validationError}</div> : null}
      </div>
    </section>
  );
}
