"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMinimalOrderAction,
  lookupCustomerByCodeAction,
  type CustomerLookupByCodePayload,
} from "@/app/admin/capture/actions";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

type Props = {
  onToast: (msg: string) => void;
  canCreateOrders: boolean;
  onClose: () => void;
};

export function MinimalOrderCapturePanel({ onToast, canCreateOrders, onClose }: Props) {
  const router = useRouter();
  const { runWithLoading, isLoading } = useAdminLoading();

  const codeRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const [customerCode, setCustomerCode] = useState("");
  const [customer, setCustomer] = useState<CustomerLookupByCodePayload | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [orderDateYmd, setOrderDateYmd] = useState(() => formatLocalYmd(new Date()));
  const [orderTimeHm, setOrderTimeHm] = useState(() => formatLocalHm(new Date()));
  const [totalAmount, setTotalAmount] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const resolveCode = useCallback(async () => {
    setCodeError(null);
    setCustomer(null);
    setErr(null);
    const raw = customerCode.trim();
    if (!raw) {
      setCodeError("הזינו קוד לקוח");
      return;
    }
    const res = await lookupCustomerByCodeAction(raw);
    if (!res.ok) {
      setCodeError(res.error);
      return;
    }
    if (!res.customer) {
      setCodeError("לקוח לא נמצא לפי קוד");
      return;
    }
    setCustomer(res.customer);
    window.setTimeout(() => amountRef.current?.focus(), 0);
  }, [customerCode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading || busy) return;
    if (!canCreateOrders) return;

    if (!customer) {
      setErr("יש לאמת קוד לקוח");
      await resolveCode();
      return;
    }
    if (!totalAmount.trim()) {
      setErr("יש להזין סכום");
      amountRef.current?.focus();
      return;
    }

    setBusy(true);
    setErr(null);
    const result = await runWithLoading(
      () =>
        createMinimalOrderAction({
          customerId: customer.id,
          orderDateYmd,
          orderTimeHm,
          totalAmount,
        }),
      "שומר הזמנה...",
    );
    setBusy(false);

    if (!result.ok) {
      setErr(result.error);
      return;
    }
    onToast("הזמנה נשמרה");
    router.refresh();
    onClose();
  }

  function onCodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void resolveCode();
    }
  }

  function onAmountKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  if (!canCreateOrders) return null;

  return (
    <div className="adm-minimal-order">
      <form className="adm-minimal-order-form" onSubmit={onSubmit}>
        {err ? <div className="adm-error adm-error--compact">{err}</div> : null}

        <section className="adm-minimal-order-block">
          <h3 className="adm-minimal-order-heading">לקוח</h3>
          <div className="adm-field adm-field--minimal">
            <label htmlFor="minimal-cust-code">קוד לקוח</label>
            <input
              ref={codeRef}
              id="minimal-cust-code"
              type="text"
              autoComplete="off"
              dir="ltr"
              disabled={busy}
              value={customerCode}
              onChange={(e) => {
                setCustomerCode(e.target.value);
                setCustomer(null);
                setCodeError(null);
              }}
              onBlur={() => {
                if (customerCode.trim()) void resolveCode();
              }}
              onKeyDown={onCodeKeyDown}
              placeholder="הזינו קוד"
            />
          </div>
          {codeError ? <p className="adm-minimal-order-inline-err">{codeError}</p> : null}
          {customer ? (
            <dl className="adm-minimal-order-dl">
              <div>
                <dt>שם</dt>
                <dd>{customer.displayName}</dd>
              </div>
              <div>
                <dt>טלפון</dt>
                <dd dir="ltr">{customer.phone || "—"}</dd>
              </div>
              <div>
                <dt>כתובת</dt>
                <dd>{customer.address?.trim() || "—"}</dd>
              </div>
            </dl>
          ) : null}
        </section>

        <section className="adm-minimal-order-block">
          <h3 className="adm-minimal-order-heading">פרטי הזמנה</h3>
          <div className="adm-minimal-order-row">
            <div className="adm-field adm-field--minimal">
              <label htmlFor="minimal-date">תאריך</label>
              <input
                id="minimal-date"
                type="date"
                disabled={busy}
                value={orderDateYmd}
                onChange={(e) => setOrderDateYmd(e.target.value)}
              />
            </div>
            <div className="adm-field adm-field--minimal">
              <label htmlFor="minimal-time">שעה</label>
              <input
                id="minimal-time"
                type="time"
                disabled={busy}
                value={orderTimeHm}
                onChange={(e) => setOrderTimeHm(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="adm-minimal-order-block">
          <h3 className="adm-minimal-order-heading">סכום</h3>
          <div className="adm-field adm-field--minimal">
            <label htmlFor="minimal-amount">סכום כולל (₪)</label>
            <input
              ref={amountRef}
              id="minimal-amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              disabled={busy}
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              onKeyDown={onAmountKeyDown}
              placeholder="0.00"
            />
          </div>
        </section>

        <div className="adm-minimal-order-actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button type="submit" className={`adm-btn adm-btn--primary adm-btn--dense${busy ? " loading" : ""}`} disabled={busy}>
            {busy ? "⏳ שומר..." : "שמירה"}
          </button>
        </div>
      </form>
    </div>
  );
}
