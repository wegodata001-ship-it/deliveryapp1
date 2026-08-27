"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeftRight, Sparkles, X } from "lucide-react";
import {
  applyPaymentMethodAutoAdjustmentAction,
  loadPaymentMethodAdjustmentBootstrapAction,
  previewPaymentMethodAutoAdjustmentAction,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import {
  PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS,
  type PaymentMethodAdjustmentPreview,
  type PaymentMethodAdjustmentReasonCode,
} from "@/lib/payment-method-auto-adjustment";
import type { MethodBalanceCard, PaymentBalanceCurrency } from "@/lib/payment-method-captured-balances";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";

const METHOD_OPTIONS = ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK"] as const;

function fmtMoney(currency: PaymentBalanceCurrency, n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const formatted = safe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "ILS" ? `₪${formatted}` : `$${formatted}`;
}

function fmtUsd(n: number): string {
  return fmtMoney("USD", n);
}

type Props = {
  open: boolean;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  openDebtUsd: number;
  weekCode: string;
  workCountry: string;
  exchangeRate?: string | null;
  onClose: () => void;
  onApplied: (result: { adjustmentId: string; affectedOrders: number }) => void;
};

function BalanceCard({
  card,
  tone,
  subtitle,
}: {
  card: MethodBalanceCard;
  tone: "captured" | "planned";
  subtitle: string;
}) {
  const currencies = (["USD", "ILS"] as const).filter((c) => (card.byCurrency[c] ?? 0) > 0.001);
  if (currencies.length === 0) return null;

  return (
    <article className={`pm-adjust-balance-card pm-adjust-balance-card--${tone}`}>
      <header className="pm-adjust-balance-card__head">
        <span className="pm-adjust-balance-card__icon" aria-hidden>{card.icon}</span>
        <div>
          <strong>{card.methodLabel}</strong>
          <span>{subtitle}</span>
        </div>
      </header>
      <div className="pm-adjust-balance-card__amounts">
        {currencies.map((currency) => (
          <div key={currency} className="pm-adjust-balance-card__row">
            <span className="pm-adjust-balance-card__cur">{currency}</span>
            <strong dir="ltr">{fmtMoney(currency, card.byCurrency[currency] ?? 0)}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function MethodBadge({ label, tone }: { label: string; tone: "from" | "to" }) {
  return <span className={`payment-method-adjust-modal__method-badge payment-method-adjust-modal__method-badge--${tone}`}>{label}</span>;
}

export function PaymentMethodAutoAdjustModal({
  open,
  customerId,
  customerName,
  customerCode,
  openDebtUsd,
  weekCode,
  workCountry,
  exchangeRate,
  onClose,
  onApplied,
}: Props) {
  const [fromPaymentMethod, setFromPaymentMethod] = useState("CASH");
  const [toPaymentMethod, setToPaymentMethod] = useState("BANK_TRANSFER");
  const [currency, setCurrency] = useState<PaymentBalanceCurrency>("USD");
  const [amountNative, setAmountNative] = useState("");
  const [reasonCode, setReasonCode] = useState<PaymentMethodAdjustmentReasonCode>("CUSTOMER_REQUEST");
  const [reasonText, setReasonText] = useState("");
  const [bootstrap, setBootstrap] = useState<{
    capturedCards: MethodBalanceCard[];
    plannedCards: MethodBalanceCard[];
    capturedTotalUsd: number;
    suggestion: PaymentMethodAdjustmentPreview["suggestion"];
  } | null>(null);
  const [preview, setPreview] = useState<PaymentMethodAdjustmentPreview | null>(null);
  const [busy, setBusy] = useState<"bootstrap" | "preview" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rateN = useMemo(() => {
    const raw = (exchangeRate ?? "").replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [exchangeRate]);

  const amountNumber = useMemo(() => Number(amountNative.replace(/,/g, "")) || 0, [amountNative]);
  const fromLabel = PAYMENT_METHOD_LABELS[fromPaymentMethod] ?? fromPaymentMethod;
  const toLabel = PAYMENT_METHOD_LABELS[toPaymentMethod] ?? toPaymentMethod;
  const canProceed = reasonText.trim().length >= 5;
  const initialLoadRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initialLoadRef.current = false;
      setPreview(null);
      setBootstrap(null);
      setErr(null);
      setConfirmOpen(false);
      setReasonText("");
      setReasonCode("CUSTOMER_REQUEST");
      setAmountNative("");
      setFromPaymentMethod("CASH");
      setToPaymentMethod("BANK_TRANSFER");
      setCurrency("USD");
      return;
    }

    const isInitial = !initialLoadRef.current;
    initialLoadRef.current = true;
    setBusy("bootstrap");
    void loadPaymentMethodAdjustmentBootstrapAction({
      customerId,
      weekCode,
      workCountry,
      exchangeRate: rateN,
      fromPaymentMethod,
      toPaymentMethod,
      currency,
    }).then((res) => {
      setBusy(null);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setBootstrap({
        capturedCards: res.capturedCards,
        plannedCards: res.plannedCards,
        capturedTotalUsd: res.capturedTotalUsd,
        suggestion: res.suggestion,
      });
      if (isInitial && res.suggestion) {
        setAmountNative(String(res.suggestion.amount));
        setCurrency(res.suggestion.currency);
      }
    });
  }, [open, customerId, weekCode, workCountry, rateN, fromPaymentMethod, toPaymentMethod, currency]);

  if (!open) return null;

  async function runPreview(override?: { amount?: number; cur?: PaymentBalanceCurrency }) {
    setBusy("preview");
    setErr(null);
    setConfirmOpen(false);

    const cur = override?.cur ?? currency;
    const amt = override?.amount ?? amountNumber;
    const amountUsd = cur === "USD" ? amt : rateN ? amt / rateN : amt;

    const res = await previewPaymentMethodAutoAdjustmentAction({
      customerId,
      weekCode,
      workCountry,
      fromPaymentMethod,
      toPaymentMethod,
      amountUsd,
      currency: cur,
      amountNative: amt,
      exchangeRate: rateN,
    });
    setBusy(null);
    if (!res.ok) {
      setPreview(null);
      setErr(res.error);
      return;
    }
    setPreview(res.preview);
    if (override) {
      setAmountNative(String(override.amount));
      setCurrency(override.cur!);
    } else if (res.preview.suggestion && !amountNative.trim()) {
      setAmountNative(String(res.preview.suggestion.amount));
      setCurrency(res.preview.suggestion.currency);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy("apply");
    setErr(null);
    const res = await applyPaymentMethodAutoAdjustmentAction({
      customerId,
      weekCode,
      workCountry,
      fromPaymentMethod,
      toPaymentMethod,
      amountUsd: preview.requestedAmountUsd,
      currency: preview.currency,
      amountNative: preview.amountNative,
      exchangeRate: rateN,
      reasonCode,
      reasonText,
    });
    setBusy(null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setConfirmOpen(false);
    onApplied({ adjustmentId: res.adjustmentId, affectedOrders: res.affectedOrders });
  }

  const capturedCards = preview?.capturedCards ?? bootstrap?.capturedCards ?? [];
  const plannedCards = preview?.plannedCards ?? bootstrap?.plannedCards ?? [];
  const capturedTotalUsd = preview?.capturedTotalUsd ?? bootstrap?.capturedTotalUsd ?? 0;

  return (
    <div className="adm-cash-modal-backdrop pm-adjust-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal payment-method-adjust-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-method-adjust-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-method-adjust-modal__head">
          <div>
            <h3 id="payment-method-adjust-title">התאמה אוטומטית של אמצעי תשלום</h3>
            <p>צפייה במצב הקופות בפועל, חישוב התאמה, ואישור לפני ביצוע</p>
          </div>
          <button type="button" className="payment-method-adjust-modal__close" aria-label="סגור" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="payment-method-adjust-modal__body">
          {/* אזור א — לקוח */}
          <section className="pm-adjust-zone pm-adjust-zone--customer">
            <div className="pm-adjust-customer-stat">
              <span>לקוח</span>
              <strong>{customerName || "—"}</strong>
            </div>
            <div className="pm-adjust-customer-stat">
              <span>קוד</span>
              <strong dir="ltr">{customerCode || "—"}</strong>
            </div>
            <div className="pm-adjust-customer-stat">
              <span>חוב פתוח</span>
              <strong dir="ltr">{fmtUsd(openDebtUsd)}</strong>
            </div>
            <div className="pm-adjust-customer-stat">
              <span>סה״כ תשלומים שנקלטו</span>
              <strong dir="ltr">{fmtUsd(capturedTotalUsd)}</strong>
            </div>
          </section>

          {/* אזור ב — מצב קופות */}
          <section className="pm-adjust-zone pm-adjust-zone--balances">
            <div className="pm-adjust-zone__title-row">
              <h4>מצב הקופות</h4>
              <p>סכומים לפי מטבע מקור — ללא המרה</p>
            </div>
            <div className="pm-adjust-balances-grid">
              <div className="pm-adjust-balances-col">
                <h5>בפועל — תשלומים שנקלטו</h5>
                <div className="pm-adjust-balance-cards">
                  {busy === "bootstrap" ? (
                    <p className="pm-adjust-loading">טוען מצב קופות...</p>
                  ) : capturedCards.length > 0 ? (
                    capturedCards.map((card) => (
                      <BalanceCard key={`c-${card.methodKey}`} card={card} tone="captured" subtitle="נקלט בפועל" />
                    ))
                  ) : (
                    <p className="pm-adjust-empty">אין תשלומים שנקלטו</p>
                  )}
                </div>
              </div>
              <div className="pm-adjust-balances-col">
                <h5>לפי הזמנות — יתרה מתוכננת פתוחה</h5>
                <div className="pm-adjust-balance-cards">
                  {plannedCards.length > 0 ? (
                    plannedCards.map((card) => (
                      <BalanceCard key={`p-${card.methodKey}`} card={card} tone="planned" subtitle="יתרה פתוחה" />
                    ))
                  ) : (
                    <p className="pm-adjust-empty">אין יתרה פתוחה מתוכננת</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* אזור ג — התאמה */}
          <section className="pm-adjust-zone pm-adjust-zone--adjust">
            <div className="pm-adjust-zone__title-row">
              <h4>הגדרת התאמה</h4>
            </div>
            <div className="pm-adjust-form-grid">
              <label className="adm-field">
                <span>מאמצעי תשלום</span>
                <select value={fromPaymentMethod} onChange={(e) => { setFromPaymentMethod(e.target.value); setPreview(null); }}>
                  {METHOD_OPTIONS.map((value) => (
                    <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value] ?? value}</option>
                  ))}
                </select>
              </label>
              <label className="adm-field">
                <span>לאמצעי תשלום</span>
                <select value={toPaymentMethod} onChange={(e) => { setToPaymentMethod(e.target.value); setPreview(null); }}>
                  {METHOD_OPTIONS.map((value) => (
                    <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value] ?? value}</option>
                  ))}
                </select>
              </label>
              <label className="adm-field">
                <span>מטבע</span>
                <select value={currency} onChange={(e) => { setCurrency(e.target.value as PaymentBalanceCurrency); setPreview(null); }}>
                  <option value="USD">USD — דולר</option>
                  <option value="ILS">ILS — שקל</option>
                </select>
              </label>
              <label className="adm-field">
                <span>סכום לשינוי ({currency})</span>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={amountNative}
                  onChange={(e) => { setAmountNative(e.target.value); setPreview(null); }}
                  placeholder={currency === "USD" ? "15000" : "45000"}
                />
              </label>
              <button
                type="button"
                className="adm-btn adm-btn--primary pm-adjust-calc-btn"
                disabled={busy != null}
                onClick={() => void runPreview()}
              >
                {busy === "preview" ? "מחשב התאמה..." : "חשב התאמה"}
              </button>
            </div>

            <div className="payment-method-adjust-modal__direction" aria-live="polite">
              <MethodBadge label={fromLabel} tone="from" />
              <ArrowLeftRight size={18} aria-hidden />
              <MethodBadge label={toLabel} tone="to" />
              <span className="payment-method-adjust-modal__impact-note">
                {currency} · {preview ? `${preview.affectedOrdersCount} הזמנות יושפעו` : "לחצי חשב התאמה לקבלת הצעה"}
              </span>
            </div>
          </section>

          {err ? <p className="payment-method-adjust-modal__err">{err}</p> : null}

          {preview?.suggestion && !confirmOpen ? (
            <section className="pm-adjust-suggestion-card">
              <Sparkles size={16} aria-hidden />
              <div>
                <strong>הצעה אוטומטית</strong>
                <p>{preview.suggestion.reason}</p>
                <p dir="ltr">
                  {preview.suggestion.fromLabel} → {preview.suggestion.toLabel}: {fmtMoney(preview.suggestion.currency, preview.suggestion.amount)}
                </p>
              </div>
              <button
                type="button"
                className="adm-btn adm-btn--ghost"
                onClick={() => {
                  const s = preview.suggestion!;
                  void runPreview({ amount: s.amount, cur: s.currency });
                }}
              >
                השתמש בהצעה
              </button>
            </section>
          ) : bootstrap?.suggestion && !preview ? (
            <section className="pm-adjust-suggestion-card">
              <Sparkles size={16} aria-hidden />
              <div>
                <strong>הצעה אוטומטית</strong>
                <p>{bootstrap.suggestion.reason}</p>
                <p dir="ltr">
                  {bootstrap.suggestion.fromLabel} → {bootstrap.suggestion.toLabel}: {fmtMoney(bootstrap.suggestion.currency, bootstrap.suggestion.amount)}
                </p>
              </div>
              <button
                type="button"
                className="adm-btn adm-btn--ghost"
                onClick={() => {
                  const s = bootstrap.suggestion!;
                  void runPreview({ amount: s.amount, cur: s.currency });
                }}
              >
                חשב לפי הצעה
              </button>
            </section>
          ) : null}

          {preview ? (
            <>
              {/* לפני → שינוי → אחרי */}
              <section className="pm-adjust-flow-card">
                <h4>תצוגת לפני / אחרי</h4>
                <div className="pm-adjust-flow-grid">
                  <div className="pm-adjust-flow-col">
                    <span className="pm-adjust-flow-label">לפני — יתרה מתוכננת</span>
                    <div className="pm-adjust-flow-row">
                      <span>{preview.fromLabel}</span>
                      <strong dir="ltr">{fmtMoney(preview.currency, preview.currentFromOpenNative)}</strong>
                    </div>
                    <div className="pm-adjust-flow-row">
                      <span>{preview.toLabel}</span>
                      <strong dir="ltr">{fmtMoney(preview.currency, preview.currentToOpenNative)}</strong>
                    </div>
                  </div>

                  <div className="pm-adjust-flow-arrow" aria-hidden>
                    <ArrowDown size={20} />
                    <div className="pm-adjust-flow-change">
                      <span>{preview.fromLabel} → {preview.toLabel}</span>
                      <strong dir="ltr">-{fmtMoney(preview.currency, preview.amountNative)}</strong>
                      {preview.currency === "ILS" && preview.exchangeRate ? (
                        <small dir="ltr">שער {preview.exchangeRate.toFixed(4)} · ≈ {fmtUsd(preview.requestedAmountUsd)}</small>
                      ) : null}
                    </div>
                    <ArrowDown size={20} />
                  </div>

                  <div className="pm-adjust-flow-col pm-adjust-flow-col--after">
                    <span className="pm-adjust-flow-label">אחרי — יתרה מתוכננת</span>
                    <div className="pm-adjust-flow-row">
                      <span>{preview.fromLabel}</span>
                      <strong dir="ltr">{fmtMoney(preview.currency, preview.afterFromOpenNative)}</strong>
                    </div>
                    <div className="pm-adjust-flow-row">
                      <span>{preview.toLabel}</span>
                      <strong dir="ltr">{fmtMoney(preview.currency, preview.afterToOpenNative)}</strong>
                    </div>
                  </div>
                </div>

                <p className="pm-adjust-total-note">
                  סה״כ תשלומים שנקלטו נשאר <strong dir="ltr">{fmtUsd(preview.capturedTotalUsd)}</strong> — משתנה רק שיוך אמצעי התשלום בהזמנות
                </p>
              </section>

              <section className="payment-method-adjust-modal__table-card">
                <div className="payment-method-adjust-modal__table-head">
                  <div>
                    <h4>Preview — הזמנות שיושפעו</h4>
                    <p>
                      סה״כ: <strong dir="ltr">{fmtMoney(preview.currency, preview.amountNative)}</strong>
                      {preview.currency === "ILS" ? <> · <strong dir="ltr">≈ {fmtUsd(preview.requestedAmountUsd)}</strong></> : null}
                    </p>
                  </div>
                  <span className="payment-method-adjust-modal__table-count">{preview.affectedOrdersCount} הזמנות</span>
                </div>
                <div className="payment-method-adjust-modal__table-wrap">
                  <table className="payment-method-adjust-modal__table">
                    <thead>
                      <tr>
                        <th>הזמנה</th>
                        <th>יתרה לפני</th>
                        <th>שינוי</th>
                        <th>אמצעי קודם</th>
                        <th>אמצעי חדש</th>
                        <th>יתרה לאחר</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.affectedOrders.map((row) => (
                        <tr key={row.orderId}>
                          <td className="payment-method-adjust-modal__order-cell" dir="ltr">{row.orderNumber}</td>
                          <td dir="ltr">{fmtUsd(row.availableUsd)}</td>
                          <td className="payment-method-adjust-modal__money-strong" dir="ltr">{fmtUsd(row.moveUsd)}</td>
                          <td><MethodBadge label={row.currentMethodLabel} tone="from" /></td>
                          <td><MethodBadge label={row.newMethodLabel} tone="to" /></td>
                          <td dir="ltr">{fmtUsd(row.sourceRemainingAfterUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {confirmOpen ? (
                <section className="payment-method-adjust-modal__reason-card">
                  <h4>אישור וביצוע</h4>
                  <label className="adm-field">
                    <span>סיבת השינוי <em>חובה</em></span>
                    <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as PaymentMethodAdjustmentReasonCode)}>
                      {PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.map((row) => (
                        <option key={row.code} value={row.code}>{row.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="adm-field">
                    <span>פירוט <em>חובה</em></span>
                    <textarea
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      rows={4}
                      placeholder="לדוגמה: הלקוח שילם במזומן אך ההזמנות מתוכננות להעברה — מעבירים שיוך"
                    />
                  </label>
                  <section className="payment-method-adjust-modal__confirm-card is-ready">
                    <Sparkles size={16} aria-hidden />
                    <div>
                      <strong>
                        שינוי <span dir="ltr">{fmtMoney(preview.currency, preview.amountNative)}</span> מ{preview.fromLabel} ל{preview.toLabel}
                      </strong>
                      <p>לא ייווצרו תשלומים חדשים — רק שיוך אמצעי תשלום בהזמנות</p>
                    </div>
                  </section>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="payment-method-adjust-modal__footer">
          <button type="button" className="adm-btn" disabled={busy != null} onClick={onClose}>
            ביטול
          </button>
          {preview ? (
            confirmOpen ? (
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={busy === "apply" || !canProceed}
                onClick={() => void apply()}
              >
                {busy === "apply" ? "מבצע התאמה..." : "אישור וביצוע"}
              </button>
            ) : (
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                onClick={() => setConfirmOpen(true)}
              >
                המשך לאישור
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
