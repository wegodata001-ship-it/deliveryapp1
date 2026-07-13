"use client";

import { useCallback, useState } from "react";
import { saveTurkeyActualTransferAction } from "@/app/admin/cash-flow/save-turkey-actual-transfer-action";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";

type Props = {
  open: boolean;
  weekCode: string;
  currentBalanceUsd: number;
  onClose: () => void;
  onSaved: () => void;
};

export function TurkeyTransferModal({ open, weekCode, currentBalanceUsd, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState<"USD" | "ILS">("USD");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = useCallback(() => {
    setAmount("");
    setReference("");
    setNotes("");
    setErr(null);
  }, []);

  if (!open) return null;

  const balance = currency === "USD" ? currentBalanceUsd : 0;
  const amountN = Number(amount.replace(",", "."));

  const handleSave = async () => {
    setErr(null);
    if (!(amountN > 0)) {
      setErr("יש להזין סכום חיובי");
      return;
    }
    if (currency === "USD" && amountN > balance + 0.02) {
      setErr("לא ניתן להעביר סכום גדול מהיתרה הממתינה לטורקיה");
      return;
    }
    setBusy(true);
    try {
      const res = await saveTurkeyActualTransferAction({
        week: weekCode,
        currency,
        amount: amountN,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        transferDate,
      });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      reset();
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fc-modal fc-modal--turkey-transfer"
        role="dialog"
        aria-labelledby="turkey-transfer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fc-modal__head">
          <h2 id="turkey-transfer-title">העברה לטורקיה</h2>
          <p>
            יתרה זמינה:{" "}
            <strong dir="ltr">{fmtWeekFlowAmount("USD", currentBalanceUsd)}</strong>
          </p>
        </header>
        <div className="fc-modal__body">
          <label>
            שבוע
            <input type="text" value={weekCode} readOnly dir="ltr" />
          </label>
          <label>
            תאריך
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
          </label>
          <label>
            מטבע
            <select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "ILS")}>
              <option value="USD">USD</option>
              <option value="ILS">ILS</option>
            </select>
          </label>
          <label>
            סכום
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            מספר אסמכתא
            <input type="text" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label>
            הערה
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          {err ? (
            <p className="fc-modal__err" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <footer className="fc-modal__foot">
          <button type="button" className="fc-btn fc-btn--ghost" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button type="button" className="fc-btn fc-btn--primary" onClick={() => void handleSave()} disabled={busy}>
            {busy ? "שומר…" : "שמור העברה"}
          </button>
        </footer>
      </div>
    </div>
  );
}
