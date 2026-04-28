"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import {
  capturePaymentAction,
  createPaymentLocationForPaymentAction,
  fetchOrderForPaymentContextAction,
  getCustomerDetailsForPaymentAction,
  listCustomersForOrderQuickPickAction,
  listPaymentLocationsForPaymentAction,
  previewPaymentCodeForCaptureAction,
  resolveCustomerForCaptureAction,
  searchCustomersForOrderAction,
  type CustomerPaymentDetailPayload,
  type CustomerSearchRow,
  type OrderPaymentContextPayload,
  type PaymentCaptureSavedSummary,
  type PaymentLocationOptionRow,
} from "@/app/admin/capture/actions";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

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

function parseNum(s: string): number {
  const t = s.replace(",", ".").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function customerDisplayCode(c: CustomerSearchRow | CustomerPaymentDetailPayload): string {
  const code =
    "customerCode" in c ? c.customerCode?.trim() : (c as CustomerSearchRow).code?.trim();
  if (code) return code;
  const id = c.id;
  return id.length > 14 ? `${id.slice(0, 10)}…` : id;
}

type Props = {
  onClose: () => void;
  onToast: (msg: string) => void;
  financial?: SerializedFinancial | null;
  canViewCustomerCard?: boolean;
  resetOnKey?: string | number;
  initialPayment?: PaymentWindowProps;
};

export function CapturePaymentForm({
  onClose,
  onToast,
  financial = null,
  canViewCustomerCard = true,
  resetOnKey,
  initialPayment,
}: Props) {
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  const rate = useMemo(() => parseFinalRate(financial), [financial]);

  const [paymentCodeDisp, setPaymentCodeDisp] = useState("—");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CREDIT);
  const [receivedToday, setReceivedToday] = useState(true);
  const [paymentDateYmd, setPaymentDateYmd] = useState(formatLocalYmd(new Date()));
  const [paymentTimeHm, setPaymentTimeHm] = useState(() => formatLocalHm(new Date()));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedPayment, setSavedPayment] = useState<PaymentCaptureSavedSummary | null>(null);

  const [amountUsd, setAmountUsd] = useState("");
  const [amountIls, setAmountIls] = useState("");
  const [amountTransferIls, setAmountTransferIls] = useState("");

  const [paymentLocations, setPaymentLocations] = useState<PaymentLocationOptionRow[]>([]);
  const [paymentPlace, setPaymentPlace] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationCode, setNewLocationCode] = useState("");
  const [newLocationErr, setNewLocationErr] = useState<string | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);

  const [customerPickList, setCustomerPickList] = useState<CustomerSearchRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerHits, setCustomerHits] = useState<CustomerSearchRow[]>([]);
  const [custDetail, setCustDetail] = useState<CustomerPaymentDetailPayload | null>(null);
  const customerQueryRef = useRef(customerQuery);
  const initialAppliedRef = useRef(false);
  customerQueryRef.current = customerQuery;

  const [orderNumberDraft, setOrderNumberDraft] = useState("");
  const [orderCtx, setOrderCtx] = useState<OrderPaymentContextPayload | null>(null);
  const [orderLoadErr, setOrderLoadErr] = useState<string | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);

  const customerDropdownRows = useMemo(() => {
    const map = new Map<string, CustomerSearchRow>();
    for (const c of customerPickList) map.set(c.id, c);
    if (custDetail) {
      const row: CustomerSearchRow = {
        id: custDetail.id,
        label: custDetail.displayName,
        code: custDetail.customerCode,
        customerType: null,
        city: null,
        phone: null,
      };
      map.set(row.id, row);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [customerPickList, custDetail]);

  const totalsPreview = useMemo(() => {
    const u = parseNum(amountUsd);
    const i = parseNum(amountIls);
    const t = parseNum(amountTransferIls);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const ilsPart = (Number.isFinite(i) ? i : 0) + (Number.isFinite(t) ? t : 0);
    const usd = Number.isFinite(u) ? u : 0;
    const gross = ilsPart + usd * rate;
    if (!Number.isFinite(gross) || gross <= 0) return null;
    const vatFactor = 1.18;
    const withoutVat = roundMoney2(gross / vatFactor);
    const vatAmount = roundMoney2(gross - withoutVat);
    return { gross, withoutVat, vatAmount };
  }, [amountUsd, amountIls, amountTransferIls, rate]);

  const payUsdEquivalent = useMemo(() => {
    const u = parseNum(amountUsd);
    const i = parseNum(amountIls);
    const t = parseNum(amountTransferIls);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const ilsPart = (Number.isFinite(i) ? i : 0) + (Number.isFinite(t) ? t : 0);
    const usd = Number.isFinite(u) ? u : 0;
    const eq = ilsPart / rate + usd;
    return Number.isFinite(eq) && eq > 0 ? roundMoney2(eq) : null;
  }, [amountUsd, amountIls, amountTransferIls, rate]);

  const remainingAfterCurrent = useMemo(() => {
    if (!orderCtx) return null;
    const totalOrder = Number(orderCtx.totalUsd.replace(",", "."));
    const totalPaid = Number(orderCtx.paidUsd.replace(",", "."));
    if (!Number.isFinite(totalOrder) || !Number.isFinite(totalPaid)) return null;
    const cur = payUsdEquivalent != null && payUsdEquivalent > 0 ? payUsdEquivalent : 0;
    return totalOrder - totalPaid - cur;
  }, [orderCtx, payUsdEquivalent]);

  const resetAll = useCallback(() => {
    setPaymentMethod(PaymentMethod.CREDIT);
    setReceivedToday(true);
    setPaymentDateYmd(formatLocalYmd(new Date()));
    setPaymentTimeHm(formatLocalHm(new Date()));
    setNotes("");
    setErr(null);
    setSavedPayment(null);
    setAmountUsd("");
    setAmountIls("");
    setAmountTransferIls("");
    setPaymentPlace("");
    setSelectedCustomerId("");
    setCustomerQuery("");
    setCustomerHits([]);
    setCustDetail(null);
    setOrderNumberDraft("");
    setOrderCtx(null);
    setOrderLoadErr(null);
    void previewPaymentCodeForCaptureAction().then((r) => {
      if (r.ok) setPaymentCodeDisp(r.code);
      else setPaymentCodeDisp("—");
    });
  }, []);

  useEffect(() => {
    if (resetOnKey === undefined) return;
    resetAll();
  }, [resetOnKey, resetAll]);

  useEffect(() => {
    void previewPaymentCodeForCaptureAction().then((r) => {
      if (r.ok) setPaymentCodeDisp(r.code);
    });
    void listPaymentLocationsForPaymentAction().then(setPaymentLocations);
    void listCustomersForOrderQuickPickAction().then(setCustomerPickList);
  }, []);

  useEffect(() => {
    if (receivedToday) {
      setPaymentDateYmd(formatLocalYmd(new Date()));
    }
  }, [receivedToday]);

  const pickCustomer = useCallback(async (row: CustomerSearchRow) => {
    setSelectedCustomerId(row.id);
    setCustomerQuery(row.label);
    setCustomerOpen(false);
    const d = await getCustomerDetailsForPaymentAction(row.id);
    setCustDetail(d);
  }, []);

  useEffect(() => {
    if (!orderCtx?.customerId) return;
    void (async () => {
      const d = await getCustomerDetailsForPaymentAction(orderCtx.customerId!);
      if (d) {
        setCustDetail(d);
        setSelectedCustomerId(d.id);
        setCustomerQuery(d.displayName);
      }
    })();
  }, [orderCtx?.customerId]);

  useEffect(() => {
    if (!customerOpen) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        const raw = customerQueryRef.current;
        const qn = raw.trim();
        if (cancelled) return;

        if (qn.length >= 2) {
          const byKey = await resolveCustomerForCaptureAction(qn);
          if (cancelled || customerQueryRef.current.trim() !== qn) return;
          if (byKey) {
            const idMatch = qn === byKey.id;
            const codeMatch = (byKey.code || "").trim().toLowerCase() === qn.toLowerCase();
            if (idMatch || codeMatch) {
              await pickCustomer(byKey);
              return;
            }
          }
        }

        const hits = await searchCustomersForOrderAction(raw);
        if (cancelled || customerQueryRef.current.trim() !== qn) return;
        setCustomerHits(hits);
        if (qn.length >= 2) {
          const low = qn.toLowerCase();
          const exact = hits.find((h) => h.label.trim().toLowerCase() === low);
          if (exact) void pickCustomer(exact);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [customerQuery, customerOpen, pickCustomer]);

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
      const emptyAmt =
        amountUsd.trim() === "" && amountIls.trim() === "" && amountTransferIls.trim() === "";
      if (Number.isFinite(rem) && rem > 0.01 && emptyAmt) {
        setAmountUsd(res.data.remainingUsd.replace(/,/g, ""));
      }
    },
    [amountUsd, amountIls, amountTransferIls],
  );

  useEffect(() => {
    if (!initialPayment || initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    setSavedPayment(null);
    setErr(null);
    const amount = initialPayment.amountIls?.trim();
    const orderNumber = initialPayment.orderNumber?.trim();
    if (orderNumber) {
      setOrderNumberDraft(orderNumber);
      void loadOrder(orderNumber).then(() => {
        if (amount) {
          setAmountUsd("");
          setAmountTransferIls("");
          setAmountIls(amount);
        }
      });
    } else if (amount) {
      setAmountIls(amount);
    }
    if (initialPayment.customerId?.trim()) {
      void getCustomerDetailsForPaymentAction(initialPayment.customerId).then((d) => {
        if (!d) return;
        setCustDetail(d);
        setSelectedCustomerId(d.id);
        setCustomerQuery(d.displayName || initialPayment.customerName || "");
      });
    } else if (initialPayment.customerName?.trim()) {
      setCustomerQuery(initialPayment.customerName);
    }
  }, [initialPayment, loadOrder]);

  function handleCustomerDropdownSelect(customerId: string) {
    if (!customerId) {
      setSelectedCustomerId("");
      setCustomerQuery("");
      setCustDetail(null);
      return;
    }
    const row = customerDropdownRows.find((c) => c.id === customerId);
    if (row) void pickCustomer(row);
  }

  async function openCustomerLedger() {
    let id = selectedCustomerId.trim() || custDetail?.id;
    let name = custDetail?.displayName ?? "";
    if (!id && customerQuery.trim()) {
      const r = await resolveCustomerForCaptureAction(customerQuery.trim());
      if (r) {
        await pickCustomer(r);
        id = r.id;
        name = r.label;
      }
    }
    if (!id || !canViewCustomerCard) {
      setErr("יש לבחור לקוח קודם");
      return;
    }
    openWindow({ type: "customerCard", props: { customerId: id, customerName: name, initialTab: "ledger" } });
  }

  async function saveNewLocation() {
    setSavingLocation(true);
    setNewLocationErr(null);
    const res = await createPaymentLocationForPaymentAction({
      name: newLocationName,
      code: newLocationCode,
    });
    setSavingLocation(false);
    if (!res.ok) {
      setNewLocationErr(res.error);
      return;
    }
    setPaymentLocations((rows) => {
      const map = new Map(rows.map((r) => [r.id, r]));
      map.set(res.data.id, res.data);
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
    });
    setPaymentPlace(res.data.name);
    setNewLocationName("");
    setNewLocationCode("");
    setAddLocationOpen(false);
    setLocationOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (savedPayment) return;
    setBusy(true);
    setErr(null);
    setSavedPayment(null);
    let cid = selectedCustomerId.trim() || custDetail?.id || "";
    if (!cid && customerQuery.trim()) {
      const r = await resolveCustomerForCaptureAction(customerQuery.trim());
      if (r) cid = r.id;
    }
    if (!cid && orderCtx?.customerId) cid = orderCtx.customerId;

    const res = await capturePaymentAction({
      paymentDateYmd: receivedToday ? formatLocalYmd(new Date()) : paymentDateYmd,
      paymentTimeHm,
      receivedToday,
      paymentMethod,
      notes,
      orderId: orderCtx?.orderId ?? null,
      customerId: cid || null,
      paymentPlace: paymentPlace.trim() || null,
      amountUsd,
      amountIls,
      amountTransferIls,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    const saved = res.saved && "paymentId" in res.saved ? res.saved : null;
    setSavedPayment(saved);
    onToast("נשמר בהצלחה");
    router.refresh();
  }

  const codeLine =
    custDetail?.customerCode?.trim() || custDetail?.id
      ? `קוד לקוח: ${customerDisplayCode(custDetail)}`
      : orderCtx?.customerId
        ? "קוד לקוח: —"
        : null;
  const customerLedgerTitle = custDetail?.displayName ? `כרטסת לקוח: ${custDetail.displayName}` : "יש לבחור לקוח קודם";

  return (
    <form className="adm-modal-form adm-capture-payment-form" onSubmit={onSubmit}>
      {err ? <div className="adm-error">{err}</div> : null}
      {savedPayment ? (
        <div className="adm-payment-saved-box" role="status">
          <strong>נשמר בהצלחה</strong>
          <div className="adm-payment-saved-grid">
            <span>
              קוד: <b dir="ltr">{savedPayment.paymentCode ?? "—"}</b>
            </span>
            <span>
              לקוח: <b>{savedPayment.customerLabel}</b>
            </span>
            <span>
              סכום: <b dir="ltr">{savedPayment.amountDisplay}</b>
            </span>
            <span>
              סה״כ ₪: <b dir="ltr">{savedPayment.totalIlsWithVat}</b>
            </span>
            <span>
              תאריך: <b dir="ltr">{savedPayment.paymentDateYmd} {savedPayment.paymentTimeHm}</b>
            </span>
            <span>
              מקום: <b>{savedPayment.paymentPlace ?? "—"}</b>
            </span>
          </div>
        </div>
      ) : null}

      <div className="adm-payment-sticky-top">
      <div className="adm-payment-compact-grid">
          <div className="card adm-payment-card--details">
            <h3>פרטי תשלום</h3>
            <div className="adm-payment-fields-grid">
            <div className="adm-field">
              <label htmlFor="cp-pay-code">קוד תשלום</label>
              <input id="cp-pay-code" type="text" readOnly value={paymentCodeDisp} className="adm-input-readonly--dense" dir="ltr" />
            </div>
            <div className="adm-field">
              <label htmlFor="cp-date">תאריך</label>
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
            </div>
          </div>

          <div className="card adm-payment-card--customer">
            <h3>לקוח</h3>
            <div className="adm-payment-customer-row">
            <div className="adm-field">
              <label htmlFor="cp-cust-dd">בחירה מהירה</label>
              <select
                id="cp-cust-dd"
                value={selectedCustomerId}
                onChange={(e) => handleCustomerDropdownSelect(e.target.value)}
              >
                <option value="">— בחרו לקוח —</option>
                {customerDropdownRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({customerDisplayCode(c)})
                  </option>
                ))}
              </select>
            </div>

            <div className="adm-field adm-cust-search-adv">
              <label htmlFor="cp-cust-q">חיפוש לקוח</label>
              <div className="adm-combo adm-combo--dense adm-cust-search-combo">
                <input
                  id="cp-cust-q"
                  type="text"
                  autoComplete="off"
                  placeholder="שם · קוד · טלפון · מזהה"
                  value={customerQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomerQuery(v);
                    setCustomerOpen(true);
                    if (!v.trim()) {
                      setSelectedCustomerId("");
                      setCustDetail(null);
                    }
                  }}
                  onFocus={() => setCustomerOpen(true)}
                  onBlur={() => window.setTimeout(() => setCustomerOpen(false), 180)}
                />
                {customerOpen && customerHits.length > 0 ? (
                  <ul className="adm-combo-list" role="listbox">
                    {customerHits.map((row) => (
                      <li key={row.id}>
                        <button type="button" className="adm-combo-item adm-combo-item--dense" onMouseDown={() => void pickCustomer(row)}>
                          <span className="adm-combo-item-title">{row.label}</span>
                          <span className="adm-combo-item-meta" dir="ltr">
                            {customerDisplayCode(row)}
                            {row.phone ? ` · ${row.phone}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

              {canViewCustomerCard ? (
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost adm-btn--dense adm-cust-card-icon"
                  disabled={busy}
                  onClick={() => void openCustomerLedger()}
                  title={customerLedgerTitle}
                  aria-label="פתיחת כרטסת לקוח"
                >
                  <span aria-hidden>📊</span>
                  <span>כרטסת לקוח</span>
                </button>
              ) : null}
            </div>
            {codeLine ? <p className="adm-cust-code-under">{codeLine}</p> : null}

            <div className="adm-payment-customer-details">
            <div className="adm-field">
              <label htmlFor="cp-name">שם (תצוגה)</label>
              <input id="cp-name" type="text" readOnly value={custDetail?.displayName ?? ""} className="adm-input-readonly--dense" />
            </div>
            <div className="adm-field">
              <label htmlFor="cp-name-he">שם בעברית</label>
              <input id="cp-name-he" type="text" readOnly value={custDetail?.nameHe ?? ""} className="adm-input-readonly--dense" />
            </div>
            <div className="adm-field">
              <label htmlFor="cp-cust-code-read">מספר לקוח</label>
              <input
                id="cp-cust-code-read"
                type="text"
                readOnly
                value={custDetail?.customerCode ?? ""}
                className="adm-input-readonly--dense"
                dir="ltr"
              />
            </div>
            </div>
          </div>

          <div className="card adm-payment-card--amounts">
            <h3>סכומים</h3>
            <div className="adm-payment-amount-grid">
              <div className="adm-field">
                <label htmlFor="cp-amt-usd">דולר (USD)</label>
                <input id="cp-amt-usd" type="text" inputMode="decimal" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} dir="ltr" />
              </div>
              <div className="adm-field">
                <label htmlFor="cp-amt-ils">שקל (₪)</label>
                <input id="cp-amt-ils" type="text" inputMode="decimal" value={amountIls} onChange={(e) => setAmountIls(e.target.value)} dir="ltr" />
              </div>
              <div className="adm-field">
                <label htmlFor="cp-amt-tr">העברה (₪)</label>
                <input
                  id="cp-amt-tr"
                  type="text"
                  inputMode="decimal"
                  value={amountTransferIls}
                  onChange={(e) => setAmountTransferIls(e.target.value)}
                  dir="ltr"
                />
              </div>
              <div className="adm-field">
                <label htmlFor="cp-amt-vat">מע״מ (₪)</label>
                <input
                  id="cp-amt-vat"
                  type="text"
                  readOnly
                  value={totalsPreview ? String(totalsPreview.vatAmount) : ""}
                  className="adm-input-readonly--dense"
                  dir="ltr"
                />
              </div>
              <div className="adm-field">
                <label htmlFor="cp-amt-novat">ללא מע״מ</label>
                <input
                  id="cp-amt-novat"
                  type="text"
                  readOnly
                  value={totalsPreview ? String(totalsPreview.withoutVat) : ""}
                  className="adm-input-readonly--dense"
                  dir="ltr"
                />
              </div>
            </div>
            {totalsPreview ? (
              <div className="payment-line adm-payment-total-line">
                <strong>סה״כ:</strong> {totalsPreview.gross.toFixed(2)} ₪ · שער {rate.toFixed(4)}
              </div>
            ) : (
              <p className="payment-summary-hint">הזינו סכום באחד השדות לחישוב.</p>
            )}
          </div>

          <div className="card adm-payment-card--order">
            <h3>הזמנה</h3>
            <div className="adm-payment-order-row">
              <div className="adm-field">
                <label htmlFor="cp-order-num">מספר הזמנה</label>
                <input
                  id="cp-order-num"
                  type="text"
                  value={orderNumberDraft}
                  onChange={(e) => setOrderNumberDraft(e.target.value)}
                  onBlur={() => void loadOrder(orderNumberDraft)}
                  placeholder="אופציונלי"
                />
              </div>
              <button type="button" className="adm-btn adm-btn--dense" disabled={loadBusy} onClick={() => void loadOrder(orderNumberDraft)}>
                {loadBusy ? "טוען…" : "טען"}
              </button>
            </div>
            {orderLoadErr ? <div className="adm-error payment-order-err">{orderLoadErr}</div> : null}
            {orderCtx ? (
              <div className="adm-payment-order-summary">
                <span>סה״כ: <strong>${orderCtx.totalUsd}</strong></span>
                <span>שולם: <strong>${orderCtx.paidUsd}</strong></span>
                <span>נשאר: <strong>${orderCtx.remainingUsd}</strong></span>
                {remainingAfterCurrent != null && Number.isFinite(remainingAfterCurrent) ? (
                  <span>{Math.abs(remainingAfterCurrent) <= 0.01 ? "✔ שולם במלואו" : "❗ תשלום חלקי"}</span>
                ) : null}
              </div>
            ) : null}
          </div>
      </div>
      </div>

      <div className="adm-payment-scroll-bottom">
        <section className="adm-payment-accordion">
          <button
            type="button"
            className="adm-payment-accordion-head"
            onClick={() => setLocationOpen((v) => !v)}
            aria-expanded={locationOpen}
          >
            <span>{locationOpen ? "▼" : "▶"} מקום תשלום / הערות</span>
            <strong>{paymentPlace || "לא נבחר"}</strong>
          </button>
          {locationOpen ? (
            <div className="adm-payment-accordion-body">
              <div className="adm-field">
                <label htmlFor="cp-place">בחר מקום</label>
                <select id="cp-place" value={paymentPlace} onChange={(e) => setPaymentPlace(e.target.value)}>
                  <option value="">בחר מקום</option>
                  {paymentLocations.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={() => setAddLocationOpen(true)}>
                + הוסף מקום חדש
              </button>
              <div className="adm-field adm-payment-notes-field">
                <label htmlFor="cp-notes">הערות</label>
                <textarea id="cp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="payment-notes" />
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {addLocationOpen ? (
        <div className="adm-mini-modal-layer" role="dialog" aria-modal="true" aria-labelledby="cp-add-location-title">
          <button type="button" className="adm-mini-modal-backdrop" aria-label="סגירה" onClick={() => setAddLocationOpen(false)} />
          <div className="adm-mini-modal">
            <h3 id="cp-add-location-title">הוספת מקום תשלום</h3>
            {newLocationErr ? <div className="adm-error adm-error--compact">{newLocationErr}</div> : null}
            <div className="adm-field">
              <label htmlFor="cp-new-location-name">שם מקום</label>
              <input
                id="cp-new-location-name"
                type="text"
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="adm-field">
              <label htmlFor="cp-new-location-code">קוד (אופציונלי)</label>
              <input
                id="cp-new-location-code"
                type="text"
                value={newLocationCode}
                onChange={(e) => setNewLocationCode(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="adm-mini-modal-actions">
              <button type="button" className="adm-btn adm-btn--primary" disabled={savingLocation} onClick={() => void saveNewLocation()}>
                שמירה
              </button>
              <button type="button" className="adm-btn adm-btn--ghost" disabled={savingLocation} onClick={() => setAddLocationOpen(false)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="adm-modal-actions">
        {savedPayment ? (
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={resetAll}>
            תשלום חדש
          </button>
        ) : null}
        <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onClose}>
          {savedPayment ? "סגירה" : "ביטול"}
        </button>
        <button type="submit" className="adm-btn adm-btn--primary" disabled={busy || !!savedPayment}>
          שמירה
        </button>
      </div>
    </form>
  );
}
