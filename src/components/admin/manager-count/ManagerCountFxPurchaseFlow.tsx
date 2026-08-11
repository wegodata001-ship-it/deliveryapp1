"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Coins, X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { previewFxPurchaseAction } from "@/app/admin/cash-flow/preview-fx-purchase-action";
import { previewFxIntakeAllocationAction } from "@/app/admin/cash-flow/preview-fx-intake-allocation-action";
import { saveFxPurchaseAction } from "@/app/admin/cash-flow/save-fx-purchase-action";
import { updateFxPurchaseAction } from "@/app/admin/cash-flow/update-fx-purchase-action";
import { getFxPurchaseContextAction } from "@/app/admin/cash-flow/get-fx-purchase-balance-action";
import { getFxRemainderBankTargetsAction } from "@/app/admin/cash-flow/get-fx-remainder-bank-targets-action";
import type { FxPurchaseRecord, FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { fcNum } from "@/components/admin/flow-control/shared";
import {
  computeFxPurchaseFormPreview,
  FX_PURCHASE_OVER_LIMIT_ERROR,
} from "@/components/admin/manager-count/manager-count-utils";
import {
  pickDefaultBankTarget,
  type FxRemainderBankTarget,
} from "@/lib/flow-control/fx-purchase/remainder-bank-resolution.shared";

type AllocationPreview = NonNullable<
  Awaited<ReturnType<typeof previewFxIntakeAllocationAction>>
>;

type RemainderMode = "cash" | "bank" | "split";

export type ManagerCountFxPurchaseFlowProps = {
  open: boolean;
  week: string;
  weekLabel: string | null;
  track: FxPurchaseTrack;
  editPurchase?: FxPurchaseRecord | null;
  saving: boolean;
  onClose: () => void;
  onSaved: () => void;
};

function FxRow({
  label,
  value,
  highlight,
  input,
}: {
  label: string;
  value?: string;
  highlight?: boolean;
  input?: ReactNode;
}) {
  return (
    <div className={`mc-fx-row${highlight ? " mc-fx-row--highlight" : ""}`}>
      <span>{label}</span>
      {input ?? (
        <strong dir="ltr">{value ?? "—"}</strong>
      )}
    </div>
  );
}

export function ManagerCountFxPurchaseFlow({
  open,
  week,
  weekLabel,
  track,
  editPurchase = null,
  saving,
  onClose,
  onSaved,
}: ManagerCountFxPurchaseFlowProps) {
  const [ilsAmount, setIlsAmount] = useState("");
  const [rate, setRate] = useState("");
  const [remainderMode, setRemainderMode] = useState<RemainderMode>("cash");
  const [remainderCash, setRemainderCash] = useState("");
  const [remainderBank, setRemainderBank] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [allocation, setAllocation] = useState<AllocationPreview | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [availableIls, setAvailableIls] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [bankTargets, setBankTargets] = useState<FxRemainderBankTarget[]>([]);
  const [bankTargetsLoading, setBankTargetsLoading] = useState(false);
  const [selectedBankKey, setSelectedBankKey] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setIlsAmount("");
    setRate("");
    setRemainderMode("cash");
    setRemainderCash("");
    setRemainderBank("");
    setShowAdvanced(false);
    setAllocation(null);
    setBusy(false);
    setAvailableIls(null);
    setValidationError(null);
    setBankTargets([]);
    setSelectedBankKey(null);
  }, []);

  const reloadContext = useCallback(async () => {
    setContextLoading(true);
    try {
      const ctx = await getFxPurchaseContextAction({ week, track });
      const base = ctx?.availableIls ?? 0;
      setAvailableIls(base + (editPurchase?.ilsAmount ?? 0));
    } finally {
      setContextLoading(false);
    }
  }, [week, track, editPurchase?.id, editPurchase?.ilsAmount]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (editPurchase) {
      setIlsAmount(String(editPurchase.ilsAmount));
      setRate(String(editPurchase.rate));
      setRemainderCash(String(editPurchase.remainderCashIls));
      setRemainderBank(String(editPurchase.remainderBankIls));
      if (editPurchase.remainderBankIls > 0.009 && editPurchase.remainderCashIls > 0.009) {
        setRemainderMode("split");
        setShowAdvanced(true);
      } else if (editPurchase.remainderBankIls > 0.009) {
        setRemainderMode("bank");
      } else {
        setRemainderMode("cash");
      }
      setSelectedBankKey(editPurchase.remainderBankKey ?? null);
    }
    void reloadContext();
  }, [open, reset, reloadContext, editPurchase]);

  const availNum = availableIls ?? 0;
  const ilsNum = fcNum(ilsAmount);
  const rateNum = fcNum(rate);
  const preview = computeFxPurchaseFormPreview(availNum, ilsNum, rateNum);
  const trimmedIls = ilsAmount.trim();
  const isZeroPurchase = trimmedIls !== "" && ilsNum <= 0.005;
  const isNegativePurchase = trimmedIls !== "" && ilsNum < -0.02;
  const hasRemainder = !isZeroPurchase && ilsNum > 0.005 && preview.remainingIlsAfter > 0.02;

  useEffect(() => {
    if (!open || !hasRemainder) {
      setBankTargets([]);
      return;
    }
    setBankTargetsLoading(true);
    void getFxRemainderBankTargetsAction({ week, track }).then((targets) => {
      setBankTargets(targets);
      setBankTargetsLoading(false);
      if (editPurchase?.remainderBankKey) {
        setSelectedBankKey(editPurchase.remainderBankKey);
        return;
      }
      const def = pickDefaultBankTarget(targets);
      if (def) setSelectedBankKey(def.bankKey);
    });
  }, [open, week, track, hasRemainder, editPurchase?.remainderBankKey]);

  const selectedBank =
    bankTargets.find((t) => t.bankKey === selectedBankKey) ??
    (editPurchase?.remainderBankKey && editPurchase.remainderBankLabel
      ? {
          bankKey: editPurchase.remainderBankKey,
          bankLabel: editPurchase.remainderBankLabel,
          bankAccountId: editPurchase.remainderBankAccountId ?? null,
          totalIlsReceived: 0,
          paymentCount: 0,
        }
      : null);

  useEffect(() => {
    if (isNegativePurchase) {
      setValidationError("סכום רכישה לא יכול להיות שלילי");
    } else if (ilsNum > availNum + 0.02) {
      setValidationError(FX_PURCHASE_OVER_LIMIT_ERROR);
    } else {
      setValidationError(null);
    }
  }, [ilsNum, availNum, isNegativePurchase]);

  useEffect(() => {
    if (remainderMode === "cash") {
      setRemainderCash(preview.remainingIlsAfter > 0 ? String(preview.remainingIlsAfter) : "0");
      setRemainderBank("0");
    } else if (remainderMode === "bank") {
      setRemainderCash("0");
      setRemainderBank(preview.remainingIlsAfter > 0 ? String(preview.remainingIlsAfter) : "0");
    }
  }, [remainderMode, preview.remainingIlsAfter]);

  useEffect(() => {
    if (isZeroPurchase || ilsNum <= 0.005 || rateNum <= 0) {
      setAllocation(null);
      return;
    }
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
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [week, track, ilsNum, rateNum, isZeroPurchase]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    if (trimmedIls === "") {
      setValidationError("יש להזין סכום ₪ (0 = ללא רכישת מט״ח)");
      return;
    }
    if (isNegativePurchase) {
      setValidationError("סכום רכישה לא יכול להיות שלילי");
      return;
    }
    if (isZeroPurchase) {
      setBusy(true);
      try {
        if (editPurchase) {
          const res = await updateFxPurchaseAction({
            week,
            purchaseId: editPurchase.id,
            track,
            ilsAmount: 0,
            rate: 0,
            remainderCashIls: 0,
            remainderBankIls: 0,
          });
          if (!res.ok) {
            setValidationError(res.error ?? "עדכון נכשל");
            return;
          }
        }
        onSaved();
        handleClose();
      } finally {
        setBusy(false);
      }
      return;
    }
    if (rateNum <= 0) {
      setValidationError("יש להזין שער רכישה");
      return;
    }
    if (ilsNum > availNum + 0.02) {
      setValidationError(FX_PURCHASE_OVER_LIMIT_ERROR);
      return;
    }

    const remainderCashIls =
      remainderMode === "split"
        ? fcNum(remainderCash)
        : remainderMode === "cash"
          ? preview.remainingIlsAfter
          : 0;
    const remainderBankIls =
      remainderMode === "split"
        ? fcNum(remainderBank)
        : remainderMode === "bank"
          ? preview.remainingIlsAfter
          : 0;

    if (remainderBankIls > 0.02) {
      if (bankTargets.length === 0 && !editPurchase?.remainderBankKey) {
        setValidationError("לא נמצאו קליטות בנק בשבוע — לא ניתן להעביר יתרה לבנק");
        return;
      }
      if (!selectedBank?.bankKey) {
        setValidationError("יש לבחור בנק יעד להעברת יתרה");
        return;
      }
    }

    const splitPreview = await previewFxPurchaseAction({
      week,
      track,
      ilsAmount: ilsNum,
      rate: rateNum,
      remainderCashIls,
      remainderBankIls,
    });
    if (!splitPreview?.splitValid && preview.remainingIlsAfter > 0.02) {
      setValidationError(
        `סכום היתרה חייב להשוות ל-${preview.remainingIlsAfter.toLocaleString("he-IL")} ₪`,
      );
      return;
    }

    setBusy(true);
    try {
      const payload = {
        week,
        track,
        ilsAmount: ilsNum,
        rate: rateNum,
        remainderCashIls,
        remainderBankIls,
        remainderAction:
          remainderMode === "split" ? ("SPLIT" as const) : remainderMode === "bank" ? ("BANK" as const) : ("CASH" as const),
        remainderBankKey: remainderBankIls > 0.02 ? selectedBank?.bankKey ?? null : null,
        remainderBankLabel: remainderBankIls > 0.02 ? selectedBank?.bankLabel ?? null : null,
        remainderBankAccountId:
          remainderBankIls > 0.02 ? selectedBank?.bankAccountId ?? null : null,
      };
      const res = editPurchase
        ? await updateFxPurchaseAction({ ...payload, purchaseId: editPurchase.id })
        : await saveFxPurchaseAction(payload);
      if (!res.ok) {
        setValidationError(res.error ?? "שמירה נכשלה");
        return;
      }
      onSaved();
      handleClose();
    } finally {
      setBusy(false);
    }
  };

  const isEdit = Boolean(editPurchase);

  if (!open) return null;

  return (
    <div className="mc-fx-wizard-backdrop" role="presentation" onClick={handleClose}>
      <div className="mc-fx-wizard mc-fx-wizard--single" role="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="mc-fx-wizard__head">
          <h4>
            <Coins size={16} /> {isEdit ? "עריכת" : ""} רכישת מט״ח {track}
          </h4>
          <button type="button" className="fc-btn fc-btn--icon" onClick={handleClose}>
            <X size={16} />
          </button>
        </header>
        <p className="mc-fx-wizard__meta">{weekLabel ?? week}</p>

        <div className="mc-fx-wizard__body">
          <section className="mc-fx-card">
            <h5 className="mc-fx-card__title">אזור קלט</h5>
            <FxRow
              label="זמין ₪ לפני רכישה"
              value={contextLoading ? "טוען…" : fmtDailyMoney("ILS", preview.availableIlsBefore)}
            />
            <FxRow
              label='סכום ₪ לרכישת מט"ח'
              input={
                <input
                  type="text"
                  inputMode="decimal"
                  className="fc-input mc-fx-row__input"
                  value={ilsAmount}
                  disabled={saving || busy || contextLoading}
                  onChange={(e) => setIlsAmount(e.target.value)}
                  autoFocus
                />
              }
            />
            <FxRow
              label="שער רכישה"
              input={
                <input
                  type="text"
                  inputMode="decimal"
                  className="fc-input mc-fx-row__input"
                  value={rate}
                  disabled={saving || busy || isZeroPurchase}
                  placeholder={isZeroPurchase ? "—" : undefined}
                  onChange={(e) => setRate(e.target.value)}
                />
              }
            />
          </section>

          <section className="mc-fx-card mc-fx-card--result">
            <h5 className="mc-fx-card__title">תוצאה</h5>
            <FxRow
              label="דולרים שיירכשו"
              value={fmtDailyMoney("USD", preview.purchasedUsd)}
            />
            <FxRow
              label="יתרת ₪ בקופה לאחר רכישה"
              value={fmtDailyMoney("ILS", preview.remainingIlsAfter)}
              highlight
            />
            {isZeroPurchase ? (
              <p className="mc-fx-card__hint">
                לא תבוצע רכישת מט״ח במסלול זה. מלוא היתרה תישאר זמינה.
              </p>
            ) : ilsNum > 0.005 ? (
              <p className="mc-fx-card__math" dir="ltr">
                {fmtDailyMoney("ILS", preview.availableIlsBefore)} −{" "}
                {fmtDailyMoney("ILS", preview.purchaseIls)} ={" "}
                {fmtDailyMoney("ILS", preview.remainingIlsAfter)}
              </p>
            ) : (
              <p className="mc-fx-card__math">
                הזן סכום רכישה, או 0 לדילוג על רכישת מט״ח
              </p>
            )}
          </section>

          {validationError ? <p className="fc-error">{validationError}</p> : null}

          {hasRemainder ? (
            <section className="mc-fx-card mc-fx-card--remainder">
              <h5 className="mc-fx-card__title">מה לעשות עם יתרת השקלים?</h5>
              <p className="mc-fx-card__math">
                יתרה לטיפול:{" "}
                <strong dir="ltr">{fmtDailyMoney("ILS", preview.remainingIlsAfter)}</strong>
              </p>
              <div className="mc-fx-remainder-options">
                <label className="mc-radio-card">
                  <input
                    type="radio"
                    name="remainderMode"
                    checked={remainderMode === "cash"}
                    onChange={() => setRemainderMode("cash")}
                  />
                  <span>להשאיר בקופה</span>
                  <strong dir="ltr">{fmtDailyMoney("ILS", preview.remainingIlsAfter)}</strong>
                  <small>יישארו בקופה</small>
                </label>
                <label
                  className={`mc-radio-card${bankTargets.length === 0 && !bankTargetsLoading ? " mc-radio-card--disabled" : ""}`}
                >
                  <input
                    type="radio"
                    name="remainderMode"
                    checked={remainderMode === "bank"}
                    disabled={bankTargets.length === 0 && !bankTargetsLoading}
                    onChange={() => setRemainderMode("bank")}
                  />
                  <span>להעביר לבנק</span>
                  <strong dir="ltr">{fmtDailyMoney("ILS", preview.remainingIlsAfter)}</strong>
                  <small>סכום להעברה</small>
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

              {remainderMode === "bank" || (remainderMode === "split" && fcNum(remainderBank) > 0.005) ? (
                <div className="mc-fx-bank-target">
                  {bankTargetsLoading ? (
                    <p className="mc-muted">טוען בנקים מקליטות התשלום…</p>
                  ) : bankTargets.length === 0 ? (
                    <p className="fc-error">לא נמצאו קליטות בנק בשבוע — לא ניתן להעביר לבנק</p>
                  ) : bankTargets.length === 1 ? (
                    <>
                      <FxRow label="בנק יעד" value={bankTargets[0]?.bankLabel} highlight />
                      <FxRow
                        label="סכום להעברה"
                        value={fmtDailyMoney(
                          "ILS",
                          remainderMode === "bank" ? preview.remainingIlsAfter : fcNum(remainderBank),
                        )}
                      />
                    </>
                  ) : (
                    <>
                      <p className="mc-fx-wizard__q">בחר בנק יעד (מקליטות השבוע)</p>
                      <div className="mc-fx-bank-target-list">
                        {bankTargets.map((target) => (
                          <label key={target.bankKey} className="mc-radio-card mc-radio-card--bank">
                            <input
                              type="radio"
                              name="bankTarget"
                              checked={selectedBankKey === target.bankKey}
                              onChange={() => setSelectedBankKey(target.bankKey)}
                            />
                            <span>{target.bankLabel}</span>
                            <strong dir="ltr">{fmtDailyMoney("ILS", target.totalIlsReceived)}</strong>
                          </label>
                        ))}
                      </div>
                      {selectedBank ? (
                        <FxRow
                          label="סכום להעברה"
                          value={fmtDailyMoney(
                            "ILS",
                            remainderMode === "bank" ? preview.remainingIlsAfter : fcNum(remainderBank),
                          )}
                          highlight
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

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
                    <span>העברה לבנק ₪</span>
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
            </section>
          ) : null}

          <button
            type="button"
            className="mc-fx-advanced-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "הסתר" : "הצג"} פירוט תקבולים
          </button>

          {showAdvanced ? (
            <div className="mc-fx-advanced">
              {allocationLoading ? (
                <p className="mc-muted">מחשב פירוט תקבולים…</p>
              ) : allocation && allocation.lines.length > 0 ? (
                <div className="fc-table-wrap">
                  <table className="fc-table fc-table--compact">
                    <thead>
                      <tr>
                        <th>תאריך</th>
                        <th>מקור</th>
                        <th className="fc-num">סכום</th>
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
              ) : ilsNum > 0 && rateNum > 0 ? (
                <p className="mc-muted">אין תקבולים מזוהים לפירוט</p>
              ) : null}
            </div>
          ) : null}

          <div className="mc-fx-wizard__actions">
            <button type="button" className="fc-btn fc-btn--ghost" onClick={handleClose}>
              ביטול
            </button>
            <button
              type="button"
              className="fc-btn fc-btn--primary"
              disabled={busy || saving || contextLoading || !!validationError}
              onClick={() => void handleSave()}
            >
              {isEdit ? "שמירת עריכה" : isZeroPurchase ? "המשך ללא רכישה" : "אישור ושמירה"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ManagerCountFxPurchaseFlow;
