"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { Modal } from "@/components/ui/Modal";
import { capturePaymentAction } from "@/app/admin/capture/actions";
import { formatLocalYmd } from "@/lib/work-week";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  POINT: "נקודה",
  BANK_TRANSFER: "העברה בנקאית",
  BANK_TRANSFER_DONE: "העברה בוצעה",
  ORDERED: "הוזמן",
  WITHDRAWAL: "משיכה",
  WITHDRAWAL_DONE: "משיכה בוצעה",
  RECEIVED_AT_POINT: "התקבל בנקודה",
  WITH_GOODS: "עם סחורה",
  CHECK: "צ׳ק",
  CASH: "מזומן",
  OTHER: "אחר",
};

type Props = {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
};

export function CapturePaymentModal({ open, onClose, onToast }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"ILS" | "USD">("ILS");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.BANK_TRANSFER);
  const [receivedToday, setReceivedToday] = useState(true);
  const [paymentDateYmd, setPaymentDateYmd] = useState(formatLocalYmd(new Date()));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setCurrency("ILS");
    setPaymentMethod(PaymentMethod.BANK_TRANSFER);
    setReceivedToday(true);
    setPaymentDateYmd(formatLocalYmd(new Date()));
    setNotes("");
    setErr(null);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await capturePaymentAction({
      amount,
      currency,
      paymentMethod,
      paymentDateYmd,
      receivedToday,
      notes,
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
    <Modal open={open} onClose={onClose} title="קליטת תשלום" size="md">
      <form className="adm-modal-form" onSubmit={onSubmit}>
        {err ? <div className="adm-error">{err}</div> : null}
        <div className="adm-field">
          <label htmlFor="cp-amount">סכום</label>
          <input id="cp-amount" required type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="cp-cur">מטבע</label>
          <select id="cp-cur" value={currency} onChange={(e) => setCurrency(e.target.value as "ILS" | "USD")}>
            <option value="ILS">שקל (₪)</option>
            <option value="USD">דולר ($)</option>
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="cp-method">אמצעי תשלום</label>
          <select
            id="cp-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            {Object.values(PaymentMethod).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field adm-check">
          <input
            id="cp-today"
            type="checkbox"
            checked={receivedToday}
            onChange={(e) => {
              setReceivedToday(e.target.checked);
              if (e.target.checked) setPaymentDateYmd(formatLocalYmd(new Date()));
            }}
          />
          <label htmlFor="cp-today">התשלום התקבל היום</label>
        </div>
        {!receivedToday ? (
          <div className="adm-field">
            <label htmlFor="cp-date">תאריך תשלום</label>
            <input id="cp-date" type="date" value={paymentDateYmd} onChange={(e) => setPaymentDateYmd(e.target.value)} />
            <p className="adm-field-hint">תשלום מתאריך אחר</p>
          </div>
        ) : null}
        <div className="adm-field">
          <label htmlFor="cp-notes">הערות</label>
          <input id="cp-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
    </Modal>
  );
}
