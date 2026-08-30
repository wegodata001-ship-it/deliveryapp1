"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  applyPaymentMethodAutoAdjustmentAction,
  loadPaymentMethodAdjustmentBootstrapAction,
  previewPaymentIntentAutoAdjustmentAction,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import type { PaymentBalanceCurrency } from "@/lib/payment-method-captured-balances";
import { intentsFromDraftPaymentLines } from "@/lib/payment-method-payment-intent";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";

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

const DEFAULT_REASON =
  "הלקוח רוצה לשלם באמצעי תשלום שונה מהמתוכנן בהזמנות הפתוחות";

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

function toUsd(amount: number, currency: PaymentBalanceCurrency, rate: number | null): number | null {
  if (!(amount > 0)) return 0;
  if (currency === "USD") return Math.round(amount * 100) / 100;
  if (!rate || !(rate > 0)) return null;
  return Math.round((amount / rate) * 100) / 100;
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

type PreviewState = {
  openDebtUsd: number;
  totalPayUsd: number;
  intents: Array<{
    method: string;
    currency: PaymentBalanceCurrency;
    amountNative: number;
    amountUsd: number;
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
  }>;
};

type Props = {
  open: boolean;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  openDebtUsd: number;
  weekCode: string;
  workCountry: string;
  exchangeRate?: string | null;
  /** טיוטת תשלום נוכחית מקליטת התשלום — אם קיימת */
  draftPaymentLines?: DraftPaymentSeed[];
  onClose: () => void;
  onApplied: (result: { adjustmentId: string; affectedOrders: number }) => void;
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
  const [busy, setBusy] = useState<"bootstrap" | "preview" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rateN = useMemo(() => {
    const raw = (exchangeRate ?? "").replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [exchangeRate]);

  const liveLines = useMemo(() => {
    return METHOD_CARDS.map((card) => {
      const draft = drafts[card.key];
      const amount = parseAmount(draft.amount);
      const usd = toUsd(amount, draft.currency, rateN);
      return {
        key: card.key,
        title: card.title,
        amount,
        currency: draft.currency,
        usd,
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

  const draftLinesRef = useRef(draftPaymentLines);
  draftLinesRef.current = draftPaymentLines;

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setErr(null);
      setDrafts(emptyDrafts());
      return;
    }

    setDrafts(seedFromDraftLines(draftLinesRef.current));
    setPreview(null);
    setErr(null);
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
  }

  function backToEdit() {
    setPreview(null);
    setErr(null);
  }

  async function applyAll() {
    if (!preview || preview.moves.length === 0) return;
    setBusy("apply");
    setErr(null);

    const audit = {
      current: [] as Array<{ methodKey: string; currency: string; amount: number }>,
      desired: preview.intents.map((i) => ({
        methodKey: i.method,
        currency: i.currency,
        amount: i.amountNative,
      })),
      deltas: preview.moves.map((m) => ({
        methodKey: `${m.fromMethod}->${m.toMethod}`,
        currency: m.currency,
        delta: m.amountUsd,
      })),
      moves: preview.moves.map((m) => ({
        fromMethod: m.fromMethod,
        toMethod: m.toMethod,
        currency: m.currency,
        amountNative: m.amountNative,
        amountUsd: m.amountUsd,
      })),
    };

    let totalAffected = 0;
    let lastId = "";
    for (let i = 0; i < preview.moves.length; i++) {
      const move = preview.moves[i]!;
      const res = await applyPaymentMethodAutoAdjustmentAction({
        customerId,
        weekCode,
        workCountry,
        fromPaymentMethod: move.fromMethod,
        toPaymentMethod: move.toMethod,
        amountUsd: move.amountUsd,
        currency: move.currency,
        amountNative: move.amountNative,
        exchangeRate: rateN,
        reasonCode: "CUSTOMER_REQUEST",
        reasonText: DEFAULT_REASON,
        desiredAllocationAudit: i === 0 ? audit : null,
      });
      if (!res.ok) {
        setBusy(null);
        setErr(
          i > 0
            ? `חלק מההתאמות בוצעו (${i}/${preview.moves.length}), ואז נכשל: ${res.error}`
            : res.error,
        );
        return;
      }
      totalAffected += res.affectedOrders;
      lastId = res.adjustmentId;
    }

    setBusy(null);
    onApplied({ adjustmentId: lastId, affectedOrders: totalAffected });
  }

  if (!open) return null;

  const debt = preview?.openDebtUsd ?? bootstrapDebt ?? openDebtUsd;
  const customerLabel = customerCode
    ? `${customerName || "—"} #${customerCode}`
    : customerName || "—";
  const adjustTotal = preview
    ? Math.round(preview.orderChanges.reduce((s, row) => s + row.moveUsd, 0) * 100) / 100
    : 0;

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
          </div>
          <button type="button" className="payment-method-adjust-modal__close" aria-label="סגור" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="payment-method-adjust-modal__body">
          <div className="pm-paynow-topbar">
            <span className="pm-paynow-topbar__customer">{customerLabel}</span>
            <span dir="ltr">חוב פתוח: {fmtUsd(debt)}</span>
            {rateN ? <span dir="ltr">שער דולר: {rateN.toFixed(4)}</span> : null}
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
                        {line.currency === "ILS" && line.usd != null ? ` = ${fmtUsd(line.usd)}` : null}
                        {line.currency === "ILS" && line.usd == null ? " — נדרש שער דולר" : null}
                      </span>
                    </div>
                  ))}
                <div className="pm-paynow-totals__sum">
                  <span>סה״כ שהלקוח רוצה לשלם:</span>
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
              <h4>התאמה מוצעת</h4>
              <p className="pm-paynow-panel__hint">
                המערכת חישבה לפי FIFO אילו הזמנות לעדכן. עדיין לא נשמר שינוי — רק לאחר אישור.
              </p>

              <div className="pm-paynow-table-wrap">
                <table className="pm-paynow-table">
                  <thead>
                    <tr>
                      <th>הזמנה</th>
                      <th>סכום פתוח</th>
                      <th>אמצעי נוכחי</th>
                      <th>אמצעי חדש</th>
                      <th>סכום להתאמה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.orderChanges.map((row) => (
                      <tr key={row.orderId}>
                        <td className="pm-paynow-table__order" dir="ltr">
                          {row.orderNumber}
                        </td>
                        <td dir="ltr">{fmtUsd(row.availableUsd)}</td>
                        <td>{row.fromLabel}</td>
                        <td>{row.toLabel}</td>
                        <td dir="ltr" className="pm-paynow-table__move">
                          {fmtUsd(row.moveUsd)}
                          {row.partial ? (
                            <small>
                              מתוך {fmtUsd(row.availableUsd)}
                            </small>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pm-paynow-result-summary">
                <div className="pm-paynow-result-summary__block">
                  <strong>התשלום שהוזן</strong>
                  {preview.intents.map((intent) => (
                    <div key={`${intent.method}-${intent.currency}`}>
                      {PAYMENT_METHOD_LABELS[intent.method] ?? intent.method}:{" "}
                      <span dir="ltr">{fmtMoney(intent.currency, intent.amountNative)}</span>
                      {intent.currency === "ILS" && rateN ? (
                        <span dir="ltr">
                          {" "}
                          · שווי לפי שער {rateN.toFixed(4)}: {fmtUsd(intent.amountUsd)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="pm-paynow-result-summary__kpis">
                  <div>
                    <span>הזמנות שיושפעו</span>
                    <strong>{preview.orderChanges.length}</strong>
                  </div>
                  <div>
                    <span>סה״כ התאמה</span>
                    <strong dir="ltr">{fmtUsd(adjustTotal)}</strong>
                  </div>
                </div>
                <p className="pm-adjust-not-payment">
                  ההתאמה משנה רק אמצעי תשלום מתוכנן בהזמנות. היא אינה תשלום ואינה סוגרת חוב.
                </p>
              </div>

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
                disabled={busy === "apply"}
                onClick={() => void applyAll()}
              >
                {busy === "apply" ? "מבצע התאמה..." : "אישור וביצוע התאמה"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
