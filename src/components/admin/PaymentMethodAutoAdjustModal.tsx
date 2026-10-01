"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  loadPaymentMethodAdjustmentBootstrapAction,
  previewPaymentIntentAutoAdjustmentAction,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import type { PaymentBalanceCurrency } from "@/lib/payment-method-captured-balances";
import { intentsFromDraftPaymentLines } from "@/lib/payment-method-payment-intent";
import { calculatePaymentIntentDeduction } from "@/lib/payment-intent-vat";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { UsdBalanceIlsGrossText } from "@/components/admin/UsdBalanceIlsGrossText";

/** רק העברה + מזומן — זה כל ה-INPUT שהמשתמש מזין */
const METHOD_CARDS = [
  {
    key: "BANK_TRANSFER" as const,
    title: "העברה בנקאית",
    prompt: "כמה הלקוח רוצה לשלם בהעברה?",
  },
  {
    key: "CASH" as const,
    title: "מזומן",
    prompt: "כמה הלקוח רוצה לשלם במזומן?",
  },
];

type MethodKey = (typeof METHOD_CARDS)[number]["key"];

function fmtMoney(currency: PaymentBalanceCurrency, n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const formatted = safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "ILS" ? `₪${formatted}` : `$${formatted}`;
}

function fmtUsd(n: number): string {
  return fmtMoney("USD", n);
}

function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type DraftPaymentSeed = {
  usdAmount?: number | "" | null;
  ilsAmount?: number | "" | null;
  usdPaymentMethod?: string | null;
  ilsPaymentMethod?: string | null;
  paymentMethod?: string | null;
};

type IntentDraft = {
  amount: string;
  currency: PaymentBalanceCurrency;
};

type ExcessDestination = "credit" | "commission";

type PreviewState = {
  openDebtUsd: number;
  totalPayUsd: number;
  closesDebtUsd: number;
  overpaymentUsd: number;
  hasOverpayment: boolean;
  existingCreditUsd: number;
  resultingCreditUsd: number;
  existingCommissionUsd: number;
  resultingCommissionUsd: number;
  methodAllocation: Array<{
    method: string;
    label: string;
    currency: PaymentBalanceCurrency;
    amountNative: number;
    amountUsd: number;
    appliedUsd: number;
    excessUsd: number;
    grossIls: number | null;
    vatIls: number;
    netIls: number | null;
  }>;
  intents: Array<{
    method: string;
    currency: PaymentBalanceCurrency;
    amountNative: number;
    amountUsd: number;
    grossIls: number | null;
    vatIls: number;
    netIls: number | null;
  }>;
  moves: Array<{
    fromMethod: string;
    toMethod: string;
    fromLabel: string;
    toLabel: string;
    currency: PaymentBalanceCurrency;
    amountNative: number;
    amountUsd: number;
    exchangeRate: number | null;
  }>;
  orderChanges: Array<{
    orderId: string;
    orderNumber: string;
    dateYmd: string;
    fromMethod: string;
    fromLabel: string;
    toMethod: string;
    toLabel: string;
    moveUsd: number;
    availableUsd: number;
    partial: boolean;
    methodLines: Array<{
      method: string;
      label: string;
      beforeRemainingUsd: number;
      afterRemainingUsd: number;
      changeUsd: number;
    }>;
  }>;
};

type Props = {
  open: boolean;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  openDebtUsd: number;
  creditUsd: number;
  weekCode: string;
  workCountry: string;
  exchangeRate?: string | null;
  /** טיוטת תשלום נוכחית מקליטת התשלום — אם קיימת */
  draftPaymentLines?: DraftPaymentSeed[];
  onClose: () => void;
  onApplied: (result: {
    adjustmentId: string;
    affectedOrders: number;
    intents: PreviewState["intents"];
    hasOverpayment: boolean;
    overpaymentUsd: number;
    closesDebtUsd: number;
    openDebtUsd: number;
    existingCreditUsd: number;
    resultingCreditUsd: number;
    existingCommissionUsd: number;
    resultingCommissionUsd: number;
    surplusDisposition: ExcessDestination | null;
  }) => void | Promise<void | boolean>;
};

function emptyDrafts(): Record<MethodKey, IntentDraft> {
  return {
    BANK_TRANSFER: { amount: "", currency: "ILS" },
    CASH: { amount: "", currency: "USD" },
  };
}

function seedFromDraftLines(lines: DraftPaymentSeed[] | undefined): Record<MethodKey, IntentDraft> {
  const drafts = emptyDrafts();
  if (!lines?.length) return drafts;
  const intents = intentsFromDraftPaymentLines(lines);
  for (const intent of intents) {
    if (intent.method !== "BANK_TRANSFER" && intent.method !== "CASH") continue;
    drafts[intent.method] = {
      amount: String(intent.amountNative),
      currency: intent.currency,
    };
  }
  return drafts;
}

export function PaymentMethodAutoAdjustModal({
  open,
  customerId,
  customerName,
  customerCode,
  openDebtUsd,
  creditUsd,
  weekCode,
  workCountry,
  exchangeRate,
  draftPaymentLines,
  onClose,
  onApplied,
}: Props) {
  const [drafts, setDrafts] = useState<Record<MethodKey, IntentDraft>>(() => emptyDrafts());
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [bootstrapDebt, setBootstrapDebt] = useState(openDebtUsd);
  const [bootstrapCredit, setBootstrapCredit] = useState(creditUsd);
  const [busy, setBusy] = useState<"bootstrap" | "preview" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [excessDestination, setExcessDestination] = useState<ExcessDestination | null>(null);
  const [excessConfirmed, setExcessConfirmed] = useState(false);
  const applyingRef = useRef(false);

  const rateN = useMemo(() => {
    const raw = (exchangeRate ?? "").replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [exchangeRate]);

  const liveLines = useMemo(() => {
    return METHOD_CARDS.map((card) => {
      const draft = drafts[card.key];
      const amount = parseAmount(draft.amount);
      const deduction = calculatePaymentIntentDeduction({
        amountNative: amount,
        currency: draft.currency,
        exchangeRate: rateN,
      });
      return {
        key: card.key,
        title: card.title,
        amount,
        currency: draft.currency,
        grossIls: draft.currency === "ILS" ? deduction.grossNative : null,
        vatIls: deduction.vatIls,
        netIls: draft.currency === "ILS" ? deduction.netNative : null,
        usd: deduction.amountUsd,
        active: amount > 0,
      };
    });
  }, [drafts, rateN]);

  const liveTotalUsd = useMemo(() => {
    let total = 0;
    for (const line of liveLines) {
      if (!line.active) continue;
      if (line.usd == null) return null;
      total += line.usd;
    }
    return Math.round(total * 100) / 100;
  }, [liveLines]);

  const hasIls = liveLines.some((line) => line.active && line.currency === "ILS");
  const canCompute = liveTotalUsd != null && liveTotalUsd > 0 && (!hasIls || rateN != null);
  const liveTotals = useMemo(() => {
    let grossIls = 0;
    let vatIls = 0;
    let netIls = 0;
    let grossUsd = 0;
    for (const line of liveLines) {
      if (!line.active) continue;
      if (line.currency === "ILS") {
        grossIls += line.grossIls ?? 0;
        vatIls += line.vatIls;
        netIls += line.netIls ?? 0;
      } else {
        grossUsd += line.amount;
      }
    }
    return {
      grossIls: Math.round(grossIls * 100) / 100,
      vatIls: Math.round(vatIls * 100) / 100,
      netIls: Math.round(netIls * 100) / 100,
      grossUsd: Math.round(grossUsd * 100) / 100,
    };
  }, [liveLines]);

  const draftLinesRef = useRef(draftPaymentLines);
  draftLinesRef.current = draftPaymentLines;

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setErr(null);
      setDrafts(emptyDrafts());
      setExcessDestination(null);
      setExcessConfirmed(false);
      applyingRef.current = false;
      return;
    }

    setDrafts(seedFromDraftLines(draftLinesRef.current));
    setPreview(null);
    setErr(null);
    setExcessDestination(null);
    setExcessConfirmed(false);
    setBusy("bootstrap");
    void loadPaymentMethodAdjustmentBootstrapAction({
      customerId,
      weekCode,
      workCountry,
      exchangeRate: rateN,
    }).then((res) => {
      setBusy(null);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setBootstrapDebt(res.customerOpenDebtUsd);
      setBootstrapCredit(res.creditUsd);
    });
  }, [open, customerId, weekCode, workCountry, rateN]);

  function updateDraft(key: MethodKey, patch: Partial<IntentDraft>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setPreview(null);
    setErr(null);
  }

  function buildIntents() {
    return METHOD_CARDS.map((card) => ({
      method: card.key,
      currency: drafts[card.key].currency,
      amountNative: parseAmount(drafts[card.key].amount),
    })).filter((row) => row.amountNative > 0);
  }

  async function runCompute() {
    setBusy("preview");
    setErr(null);
    const intents = buildIntents();
    const res = await previewPaymentIntentAutoAdjustmentAction({
      customerId,
      weekCode,
      workCountry,
      exchangeRate: rateN,
      intents,
    });
    setBusy(null);
    if (!res.ok) {
      setPreview(null);
      setErr(res.error);
      return;
    }
    setPreview(res);
    setExcessDestination(null);
    setExcessConfirmed(false);
  }

  function backToEdit() {
    setPreview(null);
    setErr(null);
    setExcessDestination(null);
    setExcessConfirmed(false);
  }

  function appliedPayload(adjustmentId: string, affectedOrders: number) {
    if (!preview) return null;
    return {
      adjustmentId,
      affectedOrders,
      intents: preview.intents,
      hasOverpayment: preview.hasOverpayment,
      overpaymentUsd: preview.overpaymentUsd,
      closesDebtUsd: preview.closesDebtUsd,
      openDebtUsd: preview.openDebtUsd,
      existingCreditUsd: preview.existingCreditUsd,
      resultingCreditUsd: preview.resultingCreditUsd,
      existingCommissionUsd: preview.existingCommissionUsd,
      resultingCommissionUsd: preview.resultingCommissionUsd,
      surplusDisposition: preview.hasOverpayment ? excessDestination : null,
    };
  }

  async function applyAll() {
    if (!preview || applyingRef.current || busy === "apply") return;
    if (preview.hasOverpayment && !excessDestination) {
      setErr("יש לבחור לאן להעביר את העודף");
      return;
    }
    if (preview.hasOverpayment && !excessConfirmed) {
      setErr("יש לאשר במפורש את העברת העודף");
      return;
    }
    applyingRef.current = true;
    setBusy("apply");
    setErr(null);

    const adjustmentId = "";
    const affectedOrders = preview.orderChanges.length;

    const payload = appliedPayload(adjustmentId, affectedOrders);
    if (!payload) {
      applyingRef.current = false;
      setBusy(null);
      return;
    }
    const ok = await onApplied(payload);
    if (ok === false) {
      applyingRef.current = false;
      setBusy(null);
      setErr("לא ניתן היה לשמור את ההתאמה. לא בוצעו שינויים.");
      return;
    }
    setBusy(null);
  }

  if (!open) return null;

  const debt = preview?.openDebtUsd ?? bootstrapDebt ?? openDebtUsd;
  const credit = preview?.existingCreditUsd ?? bootstrapCredit ?? creditUsd;
  const customerLabel = customerCode
    ? `${customerName || "—"} #${customerCode}`
    : customerName || "—";
  return (
    <div className="adm-cash-modal-backdrop pm-adjust-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal payment-method-adjust-modal payment-method-adjust-modal--paynow"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-method-adjust-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-method-adjust-modal__head">
          <div>
            <h3 id="payment-method-adjust-title">התאמה אוטומטית של אמצעי תשלום</h3>
            <p>בדיקת התשלום, סגירת החוב וטיפול בעודף לאחר סגירת החוב</p>
          </div>
          <button type="button" className="payment-method-adjust-modal__close" aria-label="סגור" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="payment-method-adjust-modal__body">
          <div className="pm-paynow-topbar">
            <div className="pm-paynow-stat">
              <span>לקוח</span>
              <strong>{customerLabel}</strong>
            </div>
            <div className={debt <= 0.01 ? "pm-paynow-stat pm-paynow-stat--ok" : "pm-paynow-stat"}>
              <span>חוב פתוח</span>
              <strong dir="ltr">
                {fmtUsd(debt)}
                <UsdBalanceIlsGrossText usd={debt} exchangeRate={rateN ?? 0} className="adm-balances-ils-gross" />
              </strong>
            </div>
            <div className={credit > 0.01 ? "pm-paynow-stat pm-paynow-stat--ok" : "pm-paynow-stat"}>
              <span>יתרת זכות</span>
              <strong dir="ltr">{credit > 0.01 ? `+${fmtUsd(credit)}` : fmtUsd(0)}</strong>
            </div>
            {rateN ? (
              <div className="pm-paynow-stat">
                <span>שער דולר</span>
                <strong dir="ltr">{rateN.toFixed(4)}</strong>
              </div>
            ) : null}
          </div>

          {!preview ? (
            <section className="pm-paynow-panel">
              <h4>כמה הלקוח רוצה לשלם?</h4>

              <div className="pm-paynow-cards">
                {METHOD_CARDS.map((card) => {
                  const draft = drafts[card.key];
                  return (
                    <article key={card.key} className="pm-paynow-card">
                      <header>
                        <strong>{card.title}</strong>
                        <span>{card.prompt}</span>
                      </header>
                      <div className="pm-paynow-card__row">
                        <label className="pm-paynow-amount">
                          <span className="sr-only">סכום {card.title}</span>
                          <span className="pm-paynow-amount__prefix" aria-hidden>
                            {draft.currency === "ILS" ? "₪" : "$"}
                          </span>
                          <input
                            dir="ltr"
                            inputMode="decimal"
                            value={draft.amount}
                            placeholder="סכום"
                            disabled={busy != null}
                            onChange={(e) => updateDraft(card.key, { amount: e.target.value })}
                          />
                        </label>
                        <select
                          value={draft.currency}
                          disabled={busy != null}
                          onChange={(e) =>
                            updateDraft(card.key, { currency: e.target.value as PaymentBalanceCurrency })
                          }
                          aria-label={`מטבע ${card.title}`}
                        >
                          <option value="USD">$ USD</option>
                          <option value="ILS">₪ ILS</option>
                        </select>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="pm-paynow-totals">
                {rateN ? <div dir="ltr">שער דולר: {rateN.toFixed(4)}</div> : null}
                {liveLines
                  .filter((line) => line.active)
                  .map((line) => (
                    <div key={line.key} className="pm-paynow-totals__line">
                      <span>{line.title}:</span>
                      <span dir="ltr">
                        {fmtMoney(line.currency, line.amount)}
                        {line.currency === "ILS" && line.usd != null
                          ? ` כולל מע"מ → ${fmtMoney("ILS", line.netIls ?? 0)} נטו → ${fmtUsd(line.usd)}`
                          : null}
                        {line.currency === "ILS" && line.usd == null ? " — נדרש שער דולר" : null}
                      </span>
                    </div>
                  ))}
                {liveTotals.grossIls > 0 ? (
                  <>
                    <div className="pm-paynow-totals__line">
                      <span>סה״כ הלקוח מוסר בשקלים:</span>
                      <span dir="ltr">{fmtMoney("ILS", liveTotals.grossIls)}</span>
                    </div>
                    <div className="pm-paynow-totals__line">
                      <span>סה״כ מע״מ 18% שנוטרל:</span>
                      <span dir="ltr">-{fmtMoney("ILS", liveTotals.vatIls)}</span>
                    </div>
                    <div className="pm-paynow-totals__line">
                      <span>סה״כ נטו לפני מע״מ:</span>
                      <span dir="ltr">{fmtMoney("ILS", liveTotals.netIls)}</span>
                    </div>
                  </>
                ) : null}
                {liveTotals.grossUsd > 0 ? (
                  <div className="pm-paynow-totals__line">
                    <span>סה״כ הלקוח מוסר בדולר:</span>
                    <span dir="ltr">{fmtMoney("USD", liveTotals.grossUsd)}</span>
                  </div>
                ) : null}
                <div className="pm-paynow-totals__sum">
                  <span>סה״כ בדולר לקיזוז מהחוב:</span>
                  <strong dir="ltr">{liveTotalUsd != null ? fmtUsd(liveTotalUsd) : "—"}</strong>
                </div>
              </div>

              {err ? <p className="payment-method-adjust-modal__err">{err}</p> : null}

              <div className="pm-paynow-compute">
                <button
                  type="button"
                  className="adm-btn adm-btn--primary"
                  disabled={busy != null || !canCompute}
                  onClick={() => void runCompute()}
                >
                  {busy === "preview" ? "מחשב התאמה..." : "חשב התאמה"}
                </button>
              </div>
            </section>
          ) : (
            <section className="pm-paynow-panel pm-paynow-panel--preview">
              {preview.hasOverpayment ? (
                <div className="pm-adjust-status pm-adjust-status--overpay">
                  <strong>תשלום יתר: {fmtUsd(preview.overpaymentUsd)}</strong>
                  <p>
                    סכום שמותאם לחוב: {fmtUsd(preview.closesDebtUsd)}. העודף {fmtUsd(preview.overpaymentUsd)} לא שייך להתאמת האמצעים — יש לבחור לאן להעביר אותו אחרי האישור.
                  </p>
                </div>
              ) : (
                <div className="pm-adjust-status pm-adjust-status--info">
                  <strong>התאמה מוצעת</strong>
                  <p>סכום שמותאם לחוב: {fmtUsd(preview.closesDebtUsd)}. המערכת חישבה לפי FIFO אילו הזמנות לעדכן. עדיין לא נשמר שינוי — רק לאחר אישור.</p>
                </div>
              )}

              {preview.orderChanges.length > 0 ? (
              <div className="pm-paynow-table-wrap">
                <table className="pm-paynow-table">
                  <thead>
                    <tr>
                      <th>הזמנה</th>
                      <th>אמצעי</th>
                      <th>לפני</th>
                      <th>אחרי</th>
                      <th>שינוי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.orderChanges.map((row) =>
                      (row.methodLines?.length ? row.methodLines : [
                        {
                          method: row.fromMethod,
                          label: `${row.fromLabel} → ${row.toLabel}`,
                          beforeRemainingUsd: row.availableUsd,
                          afterRemainingUsd: row.availableUsd - row.moveUsd,
                          changeUsd: -row.moveUsd,
                        },
                      ]).map((line, idx) => (
                        <tr key={`${row.orderId}-${line.method}`}>
                          <td className="pm-paynow-table__order" dir="ltr">
                            {idx === 0 ? row.orderNumber : ""}
                          </td>
                          <td>{line.label}</td>
                          <td dir="ltr">{fmtUsd(line.beforeRemainingUsd)}</td>
                          <td dir="ltr">{fmtUsd(line.afterRemainingUsd)}</td>
                          <td dir="ltr" className="pm-paynow-table__move">
                            {line.changeUsd > 0.005
                              ? `+${fmtUsd(line.changeUsd)}`
                              : line.changeUsd < -0.005
                                ? `-${fmtUsd(Math.abs(line.changeUsd))}`
                                : fmtUsd(0)}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              ) : null}

              <div className="pm-adjust-intake">
                <div className="pm-adjust-intake__head">
                  <h4>התשלום שהוזן</h4>
                </div>
                {preview.intents.map((intent) => (
                  <div key={`${intent.method}-${intent.currency}`} className="pm-adjust-intake__method">
                    <span className="pm-adjust-badge">
                      {PAYMENT_METHOD_LABELS[intent.method] ?? intent.method}
                    </span>
                    <div className="pm-adjust-intake__rows">
                      <div>
                        <span>סכום שהוזן</span>
                        <strong dir="ltr">{fmtMoney(intent.currency, intent.amountNative)}</strong>
                      </div>
                      {intent.currency === "ILS" ? (
                        <>
                          <div>
                            <span>מע״מ 18%</span>
                            <strong dir="ltr">-{fmtMoney("ILS", intent.vatIls)}</strong>
                          </div>
                          <div>
                            <span>סכום נטו</span>
                            <strong dir="ltr">{fmtMoney("ILS", intent.netIls ?? 0)}</strong>
                          </div>
                          <div>
                            <span>שער דולר</span>
                            <strong dir="ltr">{rateN?.toFixed(4) ?? "—"}</strong>
                          </div>
                          <div>
                            <span>שווי בדולר</span>
                            <strong dir="ltr">{fmtUsd(intent.amountUsd)}</strong>
                          </div>
                        </>
                      ) : null}
                      <div className="pm-adjust-intake__rows--total">
                        <span>התקבל</span>
                        <strong dir="ltr">{fmtUsd(intent.amountUsd)}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pm-adjust-kpis">
                <div className="pm-adjust-kpi pm-adjust-kpi--vat">
                  <span>מע״מ שנוטרל</span>
                  <strong dir="ltr">
                    -{fmtMoney(
                      "ILS",
                      preview.intents.reduce((sum, row) => sum + row.vatIls, 0),
                    )}
                  </strong>
                </div>
                <div className="pm-adjust-kpi pm-adjust-kpi--net">
                  <span>סכום נטו בשקלים</span>
                  <strong dir="ltr">
                    {fmtMoney(
                      "ILS",
                      preview.intents.reduce((sum, row) => sum + (row.netIls ?? 0), 0),
                    )}
                  </strong>
                </div>
                <div className={preview.openDebtUsd <= 0.01 ? "pm-adjust-kpi pm-adjust-kpi--debt is-zero" : "pm-adjust-kpi pm-adjust-kpi--debt"}>
                  <span>חוב פתוח</span>
                  <strong dir="ltr">
                    {fmtUsd(preview.openDebtUsd)}
                    <UsdBalanceIlsGrossText
                      usd={preview.openDebtUsd}
                      exchangeRate={rateN ?? 0}
                      className="adm-balances-ils-gross"
                    />
                  </strong>
                </div>
                <div className="pm-adjust-kpi pm-adjust-kpi--offset">
                  <span>סכום לקיזוז</span>
                  <strong dir="ltr">{fmtUsd(preview.totalPayUsd)}</strong>
                </div>
                {preview.hasOverpayment ? (
                  <div className="pm-adjust-kpi pm-adjust-kpi--close">
                    <span>סגירת חוב</span>
                    <strong dir="ltr">{fmtUsd(preview.closesDebtUsd)}</strong>
                  </div>
                ) : (
                  <div className="pm-adjust-kpi pm-adjust-kpi--debt">
                    <span>חוב אחרי</span>
                    <strong dir="ltr">
                      {fmtUsd(Math.max(0, preview.openDebtUsd - preview.totalPayUsd))}
                    </strong>
                  </div>
                )}
                {preview.existingCreditUsd > 0.01 ? (
                  <div className="pm-adjust-kpi pm-adjust-kpi--credit">
                    <span>יתרת זכות קיימת</span>
                    <strong dir="ltr">{fmtUsd(preview.existingCreditUsd)}</strong>
                  </div>
                ) : null}
              </div>

              {preview.hasOverpayment ? (
                <div className="pm-adjust-excess">
                  <div className="pm-adjust-excess__summary">
                    <div>
                      <span>חוב לסגירה</span>
                      <strong dir="ltr">{fmtUsd(preview.closesDebtUsd)}</strong>
                    </div>
                    <div>
                      <span>התקבל</span>
                      <strong dir="ltr">{fmtUsd(preview.totalPayUsd)}</strong>
                    </div>
                    <div>
                      <span>עודף לאחר סגירת החוב</span>
                      <strong dir="ltr">{fmtUsd(preview.overpaymentUsd)}</strong>
                    </div>
                  </div>

                  <h4>לאן להעביר את העודף?</h4>
                  <div className="pm-adjust-excess__destinations" role="radiogroup" aria-label="יעד העודף">
                    <label className={excessDestination === "credit" ? "is-selected" : undefined}>
                      <input
                        type="radio"
                        name="pm-excess-destination"
                        checked={excessDestination === "credit"}
                        disabled={busy != null}
                        onChange={() => {
                          setExcessDestination("credit");
                          setExcessConfirmed(false);
                          setErr(null);
                        }}
                      />
                      <span>יתרת זכות ללקוח</span>
                    </label>
                    <label className={excessDestination === "commission" ? "is-selected" : undefined}>
                      <input
                        type="radio"
                        name="pm-excess-destination"
                        checked={excessDestination === "commission"}
                        disabled={busy != null}
                        onChange={() => {
                          setExcessDestination("commission");
                          setExcessConfirmed(false);
                          setErr(null);
                        }}
                      />
                      <span>הוסף לעמלות</span>
                    </label>
                  </div>

                  {excessDestination ? (
                    <div className="pm-adjust-excess__preview">
                      <h4>Preview לפני אישור</h4>
                      <dl>
                        <div>
                          <dt>חוב לפני</dt>
                          <dd dir="ltr">{fmtUsd(preview.openDebtUsd)}</dd>
                        </div>
                        <div>
                          <dt>סה״כ התקבל</dt>
                          <dd dir="ltr">{fmtUsd(preview.totalPayUsd)}</dd>
                        </div>
                        <div>
                          <dt>נסגר מהחוב</dt>
                          <dd dir="ltr">{fmtUsd(preview.closesDebtUsd)}</dd>
                        </div>
                        <div>
                          <dt>עודף</dt>
                          <dd dir="ltr">{fmtUsd(preview.overpaymentUsd)}</dd>
                        </div>
                        <div>
                          <dt>יעד העודף</dt>
                          <dd>{excessDestination === "credit" ? "יתרת זכות ללקוח" : "עמלות"}</dd>
                        </div>
                        <div>
                          <dt>חוב אחרי</dt>
                          <dd dir="ltr">{fmtUsd(0)}</dd>
                        </div>
                        <div>
                          <dt>יתרת זכות אחרי</dt>
                          <dd dir="ltr">
                            {fmtUsd(
                              excessDestination === "credit"
                                ? preview.resultingCreditUsd
                                : preview.existingCreditUsd,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>עמלות אחרי</dt>
                          <dd dir="ltr">
                            {fmtUsd(
                              excessDestination === "commission"
                                ? preview.resultingCommissionUsd
                                : preview.existingCommissionUsd,
                            )}
                          </dd>
                        </div>
                      </dl>
                      {preview.existingCreditUsd > 0.01 ? (
                        <p className="pm-adjust-excess__note">
                          יתרת זכות קיימת {fmtUsd(preview.existingCreditUsd)} לא נסגרת על החוב הזה —
                          העודף מתווסף אליה
                          {excessDestination === "credit"
                            ? ` ויהיה ${fmtUsd(preview.resultingCreditUsd)}`
                            : ""}
                          .
                        </p>
                      ) : null}
                      <div className="pm-adjust-excess__breakdown">
                        <strong>פירוט העודף לפי אמצעי תשלום</strong>
                        {preview.methodAllocation
                          .filter((row) => row.excessUsd > 0.01)
                          .map((row) => (
                            <div key={`${row.method}-${row.currency}`}>
                              <span>{row.label}</span>
                              <span dir="ltr">{fmtUsd(row.excessUsd)}</span>
                            </div>
                          ))}
                      </div>
                      <label className="pm-adjust-excess__confirm">
                        <input
                          type="checkbox"
                          checked={excessConfirmed}
                          disabled={busy != null}
                          onChange={(e) => {
                            setExcessConfirmed(e.target.checked);
                            setErr(null);
                          }}
                        />
                        <span>
                          {excessDestination === "credit"
                            ? `אני מאשר/ת להעביר ${fmtUsd(preview.overpaymentUsd)} ליתרת זכות`
                            : `אני מאשר/ת להוסיף ${fmtUsd(preview.overpaymentUsd)} לעמלות`}
                        </span>
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="pm-adjust-not-payment">
                  ההתאמה משנה רק אמצעי תשלום מתוכנן בהזמנות. היא אינה תשלום ואינה סוגרת חוב.
                </p>
              )}

              {err ? <p className="payment-method-adjust-modal__err">{err}</p> : null}
            </section>
          )}
        </div>

        <div className="payment-method-adjust-modal__footer">
          {!preview ? (
            <button type="button" className="adm-btn" disabled={busy != null} onClick={onClose}>
              ביטול
            </button>
          ) : (
            <>
              <button type="button" className="adm-btn" disabled={busy != null} onClick={backToEdit}>
                חזרה לעריכה
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={
                  busy === "apply" ||
                  (Boolean(preview?.hasOverpayment) && (!excessDestination || !excessConfirmed))
                }
                onClick={() => void applyAll()}
              >
                {busy === "apply" ? "מבצע התאמה..." : "אשר התאמה"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
