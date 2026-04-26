"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import {
  capturePaymentAction,
  fetchOrderForPaymentContextAction,
  type OrderPaymentContextPayload,
} from "@/app/admin/capture/actions";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import type { SerializedFinancial } from "@/lib/financial-settings";

const STANDALONE_METHODS = [PaymentMethod.CREDIT, PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER] as const;

const METHOD_LABELS: Partial<Record<PaymentMethod, string>> = {
  BANK_TRANSFER: "העברה בנקאית",
  CASH: "מזומן",
  CREDIT: "אשראי",
};

function parseFinalRate(financial: SerializedFinancial | null | undefined): number {
  const raw = financial?.finalDollarRate?.replace(",", ".");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 3.5;
}

function estimatePayUsd(amountStr: string, currency: "ILS" | "USD", rate: number): number | null {
  const v = Number(amountStr.trim().replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  return currency === "USD" ? v : v / rate;
}

type Props = {
  onClose: () => void;
  onToast: (msg: string) => void;
  financial?: SerializedFinancial | null;
  /** When set, reset fields whenever this value changes (e.g. URL modal reopen). */
  resetOnKey?: string | number;
};

export function CapturePaymentForm({ onClose, onToast, financial = null, resetOnKey }: Props) {
  const router = useRouter();
  const rate = useMemo(() => parseFinalRate(financial), [financial]);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"ILS" | "USD">("ILS");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CREDIT);
  const [receivedToday, setReceivedToday] = useState(true);
  const [paymentDateYmd, setPaymentDateYmd] = useState(formatLocalYmd(new Date()));
  const [paymentTimeHm, setPaymentTimeHm] = useState(() => formatLocalHm(new Date()));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [orderNumberDraft, setOrderNumberDraft] = useState("");
  const [orderCtx, setOrderCtx] = useState<OrderPaymentContextPayload | null>(null);
  const [orderLoadErr, setOrderLoadErr] = useState<string | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);

  const resetAll = useCallback(() => {
    setAmount("");
    setCurrency("ILS");
    setPaymentMethod(PaymentMethod.CREDIT);
    setReceivedToday(true);
    setPaymentDateYmd(formatLocalYmd(new Date()));
    setPaymentTimeHm(formatLocalHm(new Date()));
    setNotes("");
    setErr(null);
    setOrderNumberDraft("");
    setOrderCtx(null);
    setOrderLoadErr(null);
  }, []);

  useEffect(() => {
    if (resetOnKey === undefined) return;
    resetAll();
  }, [resetOnKey, resetAll]);

  const loadOrder = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) {
        setOrderCtx(null);
        setOrderLoadErr(null);
        return;
      }
      setLoadBusy(true);
      setOrderLoadErr(null);
      const res = await fetchOrderForPaymentContextAction(q);
      setLoadBusy(false);
      if (!res.ok) {
        setOrderCtx(null);
        setOrderLoadErr(res.error);
        return;
      }
      setOrderCtx(res.data);
      const rem = Number(res.data.remainingUsd.replace(",", "."));
      if (Number.isFinite(rem) && rem > 0.01 && amount.trim() === "") {
        setAmount(res.data.remainingUsd.replace(/,/g, ""));
        setCurrency("USD");
      }
    },
    [amount],
  );

  useEffect(() => {
    if (receivedToday) {
      setPaymentDateYmd(formatLocalYmd(new Date()));
    }
  }, [receivedToday]);

  const payUsdPreview = useMemo(() => estimatePayUsd(amount, currency, rate), [amount, currency, rate]);

  /** remaining = totalOrder - totalPaid - currentPayment (בהערכת USD לשורת הסכום הנוכחי) */
  const remainingAfterCurrent = useMemo(() => {
    if (!orderCtx) return null;
    const totalOrder = Number(orderCtx.totalUsd.replace(",", "."));
    const totalPaid = Number(orderCtx.paidUsd.replace(",", "."));
    if (!Number.isFinite(totalOrder) || !Number.isFinite(totalPaid)) return null;
    const currentPayment =
      payUsdPreview != null && Number.isFinite(payUsdPreview) && payUsdPreview > 0 ? payUsdPreview : 0;
    return totalOrder - totalPaid - currentPayment;
  }, [orderCtx, payUsdPreview]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await capturePaymentAction({
      amount,
      currency,
      paymentMethod,
      paymentDateYmd: receivedToday ? formatLocalYmd(new Date()) : paymentDateYmd,
      paymentTimeHm,
      receivedToday,
      notes,
      orderId: orderCtx?.orderId ?? null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onToast("תשלום נקלט");
    router.refresh();
    onClose();
  }

  return (
    <form className="adm-modal-form adm-capture-payment-form" onSubmit={onSubmit}>
      {err ? <div className="adm-error">{err}</div> : null}
      <div className="payment-layout">
        <div className="card">
          <h3>פרטי תשלום</h3>
          <div className="adm-field">
            <label htmlFor="cp-amount">סכום</label>
            <input id="cp-amount" required type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="adm-field">
            <label htmlFor="cp-cur">מטבע</label>
            <select id="cp-cur" value={currency} onChange={(e) => setCurrency(e.target.value as "ILS" | "USD")}>
              <option value="ILS">שקל</option>
              <option value="USD">דולר</option>
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="cp-method">אמצעי תשלום</label>
            <select
              id="cp-method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            >
              {STANDALONE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="cp-date">תאריך תשלום</label>
            <input
              id="cp-date"
              type="date"
              value={receivedToday ? formatLocalYmd(new Date()) : paymentDateYmd}
              readOnly={receivedToday}
              onChange={(e) => setPaymentDateYmd(e.target.value)}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="cp-time">שעה</label>
            <input id="cp-time" type="time" value={paymentTimeHm} onChange={(e) => setPaymentTimeHm(e.target.value)} />
          </div>
          <div className="adm-field adm-check">
            <input
              id="cp-today"
              type="checkbox"
              checked={receivedToday}
              onChange={(e) => {
                const on = e.target.checked;
                setReceivedToday(on);
                if (on) {
                  setPaymentDateYmd(formatLocalYmd(new Date()));
                  setPaymentTimeHm(formatLocalHm(new Date()));
                }
              }}
            />
            <label htmlFor="cp-today">התקבל היום</label>
          </div>
          <div className="adm-field">
            <label htmlFor="cp-notes">הערות</label>
            <textarea id="cp-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="payment-notes" />
          </div>
        </div>

        <div className="card">
          <h3>סיכום הזמנה</h3>
          {orderCtx ? (
            <>
              <div className="payment-line">
                סה״כ הזמנה: <strong>${orderCtx.totalUsd}</strong>
              </div>
              <div className="payment-line">
                שולם עד כה: <strong>${orderCtx.paidUsd}</strong>
              </div>
              <div className="payment-line remaining">
                נשאר לתשלום: <strong>${orderCtx.remainingUsd}</strong>
              </div>
              {payUsdPreview != null && payUsdPreview > 0 && remainingAfterCurrent != null && Number.isFinite(remainingAfterCurrent) ? (
                <div className="payment-line payment-after">
                  אחרי תשלום זה (הערכה ב־USD): <strong>${remainingAfterCurrent.toFixed(2)}</strong>
                </div>
              ) : null}
              {remainingAfterCurrent != null && Number.isFinite(remainingAfterCurrent) ? (
                Math.abs(remainingAfterCurrent) <= 0.01 ? (
                  <div className="adm-pay-success" role="status">
                    ✔ שולם במלואו
                  </div>
                ) : (
                  <div className="adm-pay-warning" role="status">
                    ❗ תשלום חלקי
                  </div>
                )
              ) : null}
            </>
          ) : (
            <p className="payment-summary-hint">הזינו מספר הזמנה בעמודה השלישית כדי לראות סיכום ויתרה.</p>
          )}
        </div>

        <div className="card">
          <h3>הזמנה</h3>
          <div className="adm-field">
            <label htmlFor="cp-order-num">מספר הזמנה</label>
            <input
              id="cp-order-num"
              type="text"
              value={orderNumberDraft}
              onChange={(e) => setOrderNumberDraft(e.target.value)}
              onBlur={() => void loadOrder(orderNumberDraft)}
              placeholder="למשל AH-118-0001"
            />
          </div>
          <div className="adm-field">
            <button type="button" className="adm-btn" disabled={loadBusy} onClick={() => void loadOrder(orderNumberDraft)}>
              {loadBusy ? "טוען…" : "טען נתונים"}
            </button>
          </div>
          {orderLoadErr ? <div className="adm-error payment-order-err">{orderLoadErr}</div> : null}
          {orderCtx ? (
            <div className="order-preview">
              <div>
                לקוח: <strong>{orderCtx.customerLabel}</strong>
              </div>
              <div>
                סכום: <strong>${orderCtx.totalUsd}</strong>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="adm-modal-actions">
        <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onClose}>
          ביטול
        </button>
        <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
          שמירה
        </button>
      </div>
    </form>
  );
}
