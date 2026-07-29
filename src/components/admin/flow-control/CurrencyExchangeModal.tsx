"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Coins, X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { previewFxPurchaseAction } from "@/app/admin/cash-flow/preview-fx-purchase-action";
import { getFxPurchaseContextAction } from "@/app/admin/cash-flow/get-fx-purchase-balance-action";
import { fcNum } from "@/components/admin/flow-control/shared";

export type CurrencyExchangeModalProps = {
  open: boolean;
  week: string;
  weekLabel: string | null;
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
  availableIls: number;
  usdReceived: number;
  remainderAfter: number;
  splitSum: number;
  splitValid: boolean;
} | null;

export function CurrencyExchangeModal({
  open,
  week,
  weekLabel,
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
  const [availableIls, setAvailableIls] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setRate("");
      setIlsAmount("");
      setRemainderCash("");
      setRemainderBank("");
      setNote("");
      setPreview(null);
      setAvailableIls(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setContextLoading(true);
    void getFxPurchaseContextAction({ week, track: "PS" }).then((ctx) => {
      if (!cancelled) {
        setAvailableIls(ctx?.availableIls ?? 0);
        setContextLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, week]);

  useEffect(() => {
    if (!open || availableIls === null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void previewFxPurchaseAction({
        week,
        track: "PS",
        ilsAmount: fcNum(ilsAmount),
        rate: fcNum(rate),
        remainderCashIls: fcNum(remainderCash),
        remainderBankIls: fcNum(remainderBank),
      }).then(setPreview);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, week, availableIls, ilsAmount, rate, remainderCash, remainderBank]);

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

  const availNum = availableIls ?? 0;

  return (
    <div className="fc-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="fc-modal fc-modal--narrow" role="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="fc-modal__head">
          <h4>
            <Coins size={16} /> רכישת מט&quot;ח — PS
          </h4>
          <button type="button" className="fc-btn fc-btn--icon" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <p className="fc-modal__meta">{weekLabel ?? week}</p>
        <div className="fc-modal__body">
          <p className="fc-muted">
            זמין:{" "}
            {contextLoading ? (
              "טוען…"
            ) : (
              <strong dir="ltr">{fmtDailyMoney("ILS", availNum)}</strong>
            )}
          </p>
          <label className="fc-field">
            <span>סכום ₪</span>
            <input
              type="text"
              inputMode="decimal"
              className="fc-input"
              value={ilsAmount}
              disabled={saving || contextLoading}
              onChange={(e) => setIlsAmount(e.target.value)}
            />
          </label>
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
          <div className="fc-field fc-field--calc">
            <span>
              <ArrowDown size={12} /> דולר שנרכש
            </span>
            <strong dir="ltr">
              {preview ? fmtDailyMoney("USD", preview.usdReceived) : "—"}
            </strong>
          </div>
          <div className="fc-form-grid">
            <label className="fc-field">
              <span>נשאר בקופה ₪</span>
              <input
                type="text"
                inputMode="decimal"
                className="fc-input"
                value={remainderCash}
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
                onChange={(e) => setRemainderBank(e.target.value)}
              />
            </label>
          </div>
          {preview && !preview.splitValid ? (
            <p className="fc-error">
              יש לחלק יתרה של {preview.remainderAfter.toLocaleString("he-IL")} ₪
            </p>
          ) : null}
          <label className="fc-field">
            <span>הערה</span>
            <input
              type="text"
              className="fc-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <footer className="fc-modal__foot">
          <button type="button" className="fc-btn fc-btn--ghost" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="fc-btn fc-btn--primary"
            disabled={saving || contextLoading}
            onClick={() => void handleSave()}
          >
            רכוש
          </button>
        </footer>
      </div>
    </div>
  );
}
