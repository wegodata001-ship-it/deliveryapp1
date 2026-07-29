"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Coins, X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { previewFxPurchaseAction } from "@/app/admin/cash-flow/preview-fx-purchase-action";
import { previewFxIntakeAllocationAction } from "@/app/admin/cash-flow/preview-fx-intake-allocation-action";
import { saveFxPurchaseAction } from "@/app/admin/cash-flow/save-fx-purchase-action";
import { getFxPurchaseContextAction } from "@/app/admin/cash-flow/get-fx-purchase-balance-action";
import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { fcNum } from "@/components/admin/flow-control/shared";

type Step = "amount" | "remainder" | "rate" | "breakdown";

type RemainderMode = "cash" | "bank" | "split";

type AllocationPreview = NonNullable<
  Awaited<ReturnType<typeof previewFxIntakeAllocationAction>>
>;

export type ManagerCountFxPurchaseFlowProps = {
  open: boolean;
  week: string;
  weekLabel: string | null;
  track: FxPurchaseTrack;
  saving: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function ManagerCountFxPurchaseFlow({
  open,
  week,
  weekLabel,
  track,
  saving,
  onClose,
  onSaved,
}: ManagerCountFxPurchaseFlowProps) {
  const [step, setStep] = useState<Step>("amount");
  const [ilsAmount, setIlsAmount] = useState("");
  const [rate, setRate] = useState("");
  const [remainderMode, setRemainderMode] = useState<RemainderMode>("cash");
  const [remainderCash, setRemainderCash] = useState("");
  const [remainderBank, setRemainderBank] = useState("");
  const [allocation, setAllocation] = useState<AllocationPreview | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [availableIls, setAvailableIls] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStep("amount");
    setIlsAmount("");
    setRate("");
    setRemainderMode("cash");
    setRemainderCash("");
    setRemainderBank("");
    setAllocation(null);
    setBusy(false);
    setAvailableIls(null);
  }, []);

  const reloadContext = useCallback(async () => {
    setContextLoading(true);
    try {
      const ctx = await getFxPurchaseContextAction({ week, track });
      setAvailableIls(ctx?.availableIls ?? 0);
    } finally {
      setContextLoading(false);
    }
  }, [week, track]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    void reloadContext();
  }, [open, reset, reloadContext]);

  const ilsNum = fcNum(ilsAmount);
  const rateNum = fcNum(rate);
  const availNum = availableIls ?? 0;
  const remainderAfter =
    ilsNum > 0 ? Math.max(0, Math.round((availNum - ilsNum) * 100) / 100) : 0;

  useEffect(() => {
    if (step !== "remainder" || ilsNum <= 0) return;
    if (remainderMode === "cash") {
      setRemainderCash(remainderAfter > 0 ? String(remainderAfter) : "");
      setRemainderBank("");
    } else if (remainderMode === "bank") {
      setRemainderCash("");
      setRemainderBank(remainderAfter > 0 ? String(remainderAfter) : "");
    }
  }, [step, remainderMode, remainderAfter, ilsNum]);

  useEffect(() => {
    if (step !== "breakdown" || ilsNum <= 0 || rateNum <= 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAllocationLoading(true);
    debounceRef.current = setTimeout(() => {
      void previewFxIntakeAllocationAction({
        week,
        track,
        ilsAmount: ilsNum,
        purchaseRate: rateNum,
      }).then((data) => {
        setAllocation(data);
        setAllocationLoading(false);
      });
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [step, week, track, ilsNum, rateNum]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const goRemainder = () => {
    if (ilsNum <= 0) {
      alert("יש להזין סכום ₪ לרכישה");
      return;
    }
    setStep("remainder");
  };

  const goRate = async () => {
    const preview = await previewFxPurchaseAction({
      week,
      track,
      ilsAmount: ilsNum,
      rate: rateNum > 0 ? rateNum : 1,
      remainderCashIls: fcNum(remainderCash),
      remainderBankIls: fcNum(remainderBank),
    });
    if (!preview?.splitValid && remainderAfter > 0) {
      alert(`יש לחלק יתרה של ${remainderAfter.toLocaleString("he-IL")} ₪`);
      return;
    }
    setStep("rate");
  };

  const goBreakdown = () => {
    if (rateNum <= 0) {
      alert("יש להזין שער דולר");
      return;
    }
    setStep("breakdown");
  };

  const handleSave = async () => {
    if (!allocation) return;
    setBusy(true);
    try {
      const res = await saveFxPurchaseAction({
        week,
        track,
        ilsAmount: ilsNum,
        rate: rateNum,
        remainderCashIls: fcNum(remainderCash),
        remainderBankIls: fcNum(remainderBank),
      });
      if (!res.ok) {
        alert(res.error ?? "שמירה נכשלה");
        return;
      }
      onSaved();
      handleClose();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const usdPreview =
    rateNum > 0 && ilsNum > 0 ? fmtDailyMoney("USD", ilsNum / rateNum) : "—";

  return (
    <div className="mc-fx-wizard-backdrop" role="presentation" onClick={handleClose}>
      <div className="mc-fx-wizard" role="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="mc-fx-wizard__head">
          <h4>
            <Coins size={16} /> רכישת מט&quot;ח — מסלול {track}
          </h4>
          <button type="button" className="fc-btn fc-btn--icon" onClick={handleClose}>
            <X size={16} />
          </button>
        </header>
        <p className="mc-fx-wizard__meta">{weekLabel ?? week}</p>

        {step === "amount" ? (
          <div className="mc-fx-wizard__body">
            <p className="mc-muted">
              זמין במסלול {track}
              {track === "PS" ? " (מזומן ₪)" : " (העברות/אשראי/צ׳קים)"}:{" "}
              {contextLoading ? (
                "טוען…"
              ) : (
                <strong dir="ltr">{fmtDailyMoney("ILS", availNum)}</strong>
              )}
            </p>
            <label className="fc-field">
              <span>סכום ₪ לרכישה</span>
              <input
                type="text"
                inputMode="decimal"
                className="fc-input"
                value={ilsAmount}
                disabled={saving || busy || contextLoading}
                onChange={(e) => setIlsAmount(e.target.value)}
                autoFocus
              />
            </label>
            <div className="mc-fx-wizard__actions">
              <button type="button" className="fc-btn fc-btn--ghost" onClick={handleClose}>
                ביטול
              </button>
              <button
                type="button"
                className="fc-btn fc-btn--primary"
                disabled={contextLoading}
                onClick={goRemainder}
              >
                המשך
              </button>
            </div>
          </div>
        ) : null}

        {step === "remainder" ? (
          <div className="mc-fx-wizard__body">
            <p className="mc-muted">
              אחרי רכישת <strong dir="ltr">{fmtDailyMoney("ILS", ilsNum)}</strong> יישארו{" "}
              <strong dir="ltr">{fmtDailyMoney("ILS", remainderAfter)}</strong>
            </p>
            <p className="mc-fx-wizard__q">מה לעשות עם יתרת השקלים?</p>
            <div className="mc-fx-remainder-options">
              <label className="mc-radio-card">
                <input
                  type="radio"
                  name="remainderMode"
                  checked={remainderMode === "cash"}
                  onChange={() => setRemainderMode("cash")}
                />
                <span>להשאיר בקופה</span>
                <strong dir="ltr">{fmtDailyMoney("ILS", remainderAfter)}</strong>
              </label>
              <label className="mc-radio-card">
                <input
                  type="radio"
                  name="remainderMode"
                  checked={remainderMode === "bank"}
                  onChange={() => setRemainderMode("bank")}
                />
                <span>להחזיר לקופה הראשית</span>
                <strong dir="ltr">{fmtDailyMoney("ILS", remainderAfter)}</strong>
              </label>
              <label className="mc-radio-card">
                <input
                  type="radio"
                  name="remainderMode"
                  checked={remainderMode === "split"}
                  onChange={() => setRemainderMode("split")}
                />
                <span>חלוקה ידנית</span>
              </label>
            </div>
            {remainderMode === "split" ? (
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
                  <span>הועבר לקופה ₪</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="fc-input"
                    value={remainderBank}
                    onChange={(e) => setRemainderBank(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <div className="mc-fx-wizard__actions">
              <button type="button" className="fc-btn fc-btn--ghost" onClick={() => setStep("amount")}>
                חזרה
              </button>
              <button type="button" className="fc-btn fc-btn--primary" onClick={() => void goRate()}>
                המשך
              </button>
            </div>
          </div>
        ) : null}

        {step === "rate" ? (
          <div className="mc-fx-wizard__body">
            <label className="fc-field">
              <span>שער דולר</span>
              <input
                type="text"
                inputMode="decimal"
                className="fc-input"
                value={rate}
                disabled={saving || busy}
                onChange={(e) => setRate(e.target.value)}
                autoFocus
              />
            </label>
            <div className="fc-field fc-field--calc">
              <span>
                <ArrowDown size={12} /> דולר שנרכש
              </span>
              <strong dir="ltr">{usdPreview}</strong>
            </div>
            <div className="mc-fx-wizard__actions">
              <button type="button" className="fc-btn fc-btn--ghost" onClick={() => setStep("remainder")}>
                חזרה
              </button>
              <button type="button" className="fc-btn fc-btn--primary" onClick={goBreakdown}>
                פירוט תקבולים
              </button>
            </div>
          </div>
        ) : null}

        {step === "breakdown" ? (
          <div className="mc-fx-wizard__body mc-fx-wizard__body--wide">
            {allocationLoading ? (
              <p className="mc-muted">מחשב פירוט תקבולים…</p>
            ) : allocation ? (
              <>
                {allocation.shortfallIls > 0.02 ? (
                  <p className="fc-error">
                    חסרים {allocation.shortfallIls.toLocaleString("he-IL")} ₪ בתקבולים מזוהים במסלול {track}
                  </p>
                ) : null}
                <div className="fc-table-wrap">
                  <table className="fc-table fc-table--compact">
                    <thead>
                      <tr>
                        <th>תאריך</th>
                        <th>מקור</th>
                        <th className="fc-num">סכום</th>
                        <th className="fc-num">שער קליטה</th>
                        <th className="fc-num">שער רכישה</th>
                        <th className="fc-num">רווח/הפסד</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocation.lines.map((line) => (
                        <tr key={`${line.paymentId}-${line.ilsAmount}`}>
                          <td dir="ltr">{line.dateLabel}</td>
                          <td>{line.sourceLabel}</td>
                          <td dir="ltr" className="fc-num">
                            {fmtDailyMoney("ILS", line.ilsAmount)}
                          </td>
                          <td dir="ltr" className="fc-num">
                            {line.intakeRate > 0 ? line.intakeRate.toFixed(4) : "—"}
                          </td>
                          <td dir="ltr" className="fc-num">
                            {line.purchaseRate.toFixed(4)}
                          </td>
                          <td
                            dir="ltr"
                            className={`fc-num${line.profitIls >= 0 ? " fc-num--profit" : " fc-num--loss"}`}
                          >
                            {fmtDailyMoney("ILS", line.profitIls)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mc-fx-pl-summary">
                  <div>
                    <span>דולר שנרכש</span>
                    <strong dir="ltr">{fmtDailyMoney("USD", allocation.usdReceived)}</strong>
                  </div>
                  <div>
                    <span>יתרת ש&quot;ח לאחר הרכישה</span>
                    <strong dir="ltr">{fmtDailyMoney("ILS", remainderAfter)}</strong>
                  </div>
                  <div>
                    <span>רווח/הפסד כולל</span>
                    <strong
                      dir="ltr"
                      className={
                        allocation.netProfitIls > 0.005
                          ? "fc-num--profit"
                          : allocation.netProfitIls < -0.005
                            ? "fc-num--loss"
                            : undefined
                      }
                    >
                      {fmtDailyMoney("ILS", allocation.netProfitIls)}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="mc-muted">אין תקבולים לשבוע זה</p>
            )}
            <div className="mc-fx-wizard__actions">
              <button type="button" className="fc-btn fc-btn--ghost" onClick={() => setStep("rate")}>
                חזרה
              </button>
              <button
                type="button"
                className="fc-btn fc-btn--primary"
                disabled={busy || saving || !allocation || allocationLoading}
                onClick={() => void handleSave()}
              >
                אישור ושמירה
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ManagerCountFxPurchaseFlow;
