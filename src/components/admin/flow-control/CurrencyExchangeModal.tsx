"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Coins, X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { previewFxPurchaseAction } from "@/app/admin/cash-flow/preview-fx-purchase-action";
import { fcNum } from "@/components/admin/flow-control/shared";

export type CurrencyExchangeModalProps = {
  open: boolean;
  week: string;
  weekLabel: string | null;
  availableIls: string;
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    ilsAmount: number;
    rate: number;
    remainderCashIls: number;
    remainderBankIls: number;
    note?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
};

type PreviewState = {
  usdReceived: number;
  remainderAfter: number;
  splitSum: number;
  splitValid: boolean;
} | null;

export function CurrencyExchangeModal({
  open,
  week,
  weekLabel,
  availableIls,
  saving,
  onClose,
  onSave,
}: CurrencyExchangeModalProps) {
  const [rate, setRate] = useState("");
  const [ilsAmount, setIlsAmount] = useState("");
  const [remainderCash, setRemainderCash] = useState("");
  const [remainderBank, setRemainderBank] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<PreviewState>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setRate("");
      setIlsAmount("");
      setRemainderCash("");
      setRemainderBank("");
      setNote("");
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void previewFxPurchaseAction({
        availableIls: fcNum(availableIls),
        ilsAmount: fcNum(ilsAmount),
        rate: fcNum(rate),
        remainderCashIls: fcNum(remainderCash),
        remainderBankIls: fcNum(remainderBank),
      }).then(setPreview);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, availableIls, ilsAmount, rate, remainderCash, remainderBank]);

  const handleSave = async () => {
    const ilsNum = fcNum(ilsAmount);
    const rateNum = fcNum(rate);
    if (ilsNum <= 0 || rateNum <= 0) {
      alert("יש להזין סכום ושער תקינים");
      return;
    }
    if (!preview?.splitValid) {
      alert(
        preview
          ? `סכום היתרה חייב להיות ${preview.remainderAfter.toLocaleString("he-IL")} ₪`
          : "יש להשלים חלוקת יתרה",
      );
      return;
    }
    const res = await onSave({
      ilsAmount: ilsNum,
      rate: rateNum,
      remainderCashIls: fcNum(remainderCash),
      remainderBankIls: fcNum(remainderBank),
      note: note.trim() || null,
    });
    if (!res.ok) alert(res.error ?? "שמירה נכשלה");
  };

  if (!open) return null;

  return (
    <div className="fc-modal-backdrop fc-modal-backdrop--top" role="presentation" onClick={onClose}>
      <div className="fc-modal fc-modal--fx" role="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="fc-modal__head">
          <h3>
            <Coins size={18} /> רכישת מט&quot;ח
          </h3>
          <button type="button" className="fc-btn fc-btn--icon" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <p className="fc-modal__meta">{weekLabel ?? week}</p>
        <div className="fc-form-grid">
          <label className="fc-field">
            <span>שער דולר</span>
            <input
              type="text"
              inputMode="decimal"
              className="fc-input"
              value={rate}
              disabled={saving}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <label className="fc-field">
            <span>סכום ₪ לרכישה</span>
            <input
              type="text"
              inputMode="decimal"
              className="fc-input"
              value={ilsAmount}
              disabled={saving}
              onChange={(e) => setIlsAmount(e.target.value)}
            />
          </label>
          <div className="fc-field fc-field--calc">
            <span>
              <ArrowDown size={12} /> דולר שהתקבל
            </span>
            <strong dir="ltr">
              {preview && preview.usdReceived > 0 ? fmtDailyMoney("USD", preview.usdReceived) : "—"}
            </strong>
          </div>
        </div>

        {fcNum(ilsAmount) > 0 ? (
          <div className="fc-fx-remainder">
            <p>
              היה זמין: <strong dir="ltr">{fmtDailyMoney("ILS", fcNum(availableIls))}</strong> · אחרי רכישה נשאר:{" "}
              <strong dir="ltr">
                {preview ? fmtDailyMoney("ILS", preview.remainderAfter) : "—"}
              </strong>
            </p>
            <p className="fc-fx-remainder__q">מה לעשות עם היתרה?</p>
            <div className="fc-form-grid">
              <label className="fc-field">
                <span>נשאר בקופה ₪</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="fc-input"
                  value={remainderCash}
                  disabled={saving}
                  onChange={(e) => setRemainderCash(e.target.value)}
                />
              </label>
              <label className="fc-field">
                <span>הועבר לבנק ₪</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="fc-input"
                  value={remainderBank}
                  disabled={saving}
                  onChange={(e) => setRemainderBank(e.target.value)}
                />
              </label>
            </div>
            {preview && !preview.splitValid && preview.remainderAfter > 0 ? (
              <p className="fc-error">
                סכום חלוקה ({preview.splitSum.toLocaleString("he-IL")}) ≠ יתרה (
                {preview.remainderAfter.toLocaleString("he-IL")})
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="fc-field fc-field--full">
          <span>הערה (אופציונלי)</span>
          <input
            type="text"
            className="fc-input"
            value={note}
            disabled={saving}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="fc-modal__actions">
          <button type="button" className="fc-btn fc-btn--ghost" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="fc-btn fc-btn--primary"
            disabled={saving || !preview?.splitValid || fcNum(ilsAmount) <= 0}
            onClick={() => void handleSave()}
          >
            שמירת רכישה
          </button>
        </div>
      </div>
    </div>
  );
}

export default CurrencyExchangeModal;
