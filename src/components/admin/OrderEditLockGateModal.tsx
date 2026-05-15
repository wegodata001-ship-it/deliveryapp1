"use client";

import { useCallback, useId, useState } from "react";
import { OrderStatus } from "@prisma/client";
import { createOrderEditRequestAction } from "@/app/admin/order-edit-requests/actions";
import type { OrderEditEntryHint } from "@/app/admin/order-edit-requests/actions";
import { orderSensitiveStatusHe } from "@/lib/order-edit-lock";

export type OrderEditLockGatePayload = Extract<OrderEditEntryHint, { kind: "prelock" }>;

type Props = {
  open: boolean;
  payload: OrderEditLockGatePayload | null;
  onClose: () => void;
  onToast: (msg: string) => void;
  /** אחרי שליחת בקשה מוצלחת — רענון רשימה / דף */
  onAfterRequestSent?: () => void;
};

export function OrderEditLockGateModal({ open, payload, onClose, onToast, onAfterRequestSent }: Props) {
  const titleId = useId();
  const [step, setStep] = useState<"main" | "reason">("main");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("main");
    setReason("");
    setBusy(false);
    setErr(null);
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  if (!open || !payload) return null;

  const statusHe = orderSensitiveStatusHe(payload.status);
  const ordLabel = payload.orderNumber?.trim() || payload.orderId;

  const sendRequest = () => {
    if (busy) return;
    setErr(null);
    const r = reason.trim();
    if (r.length < 3) {
      setErr("יש להזין סיבה (לפחות 3 תווים)");
      return;
    }
    setBusy(true);
    void createOrderEditRequestAction(payload.orderId, r).then((res) => {
      setBusy(false);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onToast("בקשת אישור נשלחה למנהל");
      reset();
      onClose();
      onAfterRequestSent?.();
    });
  };

  const variantTitle =
    payload.variant === "pending_mine"
      ? "ממתין לאישור מנהל"
      : payload.variant === "pending_other"
        ? "בקשה ממתינה"
        : payload.variant === "rejected"
          ? "בקשה נדחתה"
          : "הזמנה נעולה לעריכה";

  return (
    <div className="adm-oc-edit-request-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="adm-order-edit-lock-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div
          className={`adm-order-edit-lock-modal__accent${
            payload.status === OrderStatus.CANCELLED
              ? " adm-order-edit-lock-modal__accent--cancelled"
              : " adm-order-edit-lock-modal__accent--ready"
          }`}
          aria-hidden
        />
        <h4 id={titleId} className="adm-order-edit-lock-modal__title">
          {variantTitle}
        </h4>
        <p className="adm-order-edit-lock-modal__meta" dir="ltr">
          הזמנה <strong>{ordLabel}</strong>
          <span className="adm-order-edit-lock-modal__dot"> · </span>
          {statusHe}
        </p>

        {payload.variant === "locked" || payload.variant === "rejected" ? (
          step === "main" ? (
            <>
              <p className="adm-order-edit-lock-modal__body">
                הזמנה זו נעולה לעריכה. נדרש אישור מנהל כדי לבצע שינוי.
                {payload.variant === "rejected" ? " הבקשה הקודמת שלך נדחתה — ניתן לשלוח בקשה חדשה." : null}
              </p>
              <div className="adm-order-edit-lock-modal__actions">
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={busy} onClick={handleClose}>
                  ביטול
                </button>
                <button
                  type="button"
                  className={`adm-btn adm-btn--primary adm-btn--dense${busy ? " loading" : ""}`}
                  disabled={busy}
                  onClick={() => {
                    setErr(null);
                    setStep("reason");
                  }}
                >
                  שלח בקשת אישור
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="adm-field" htmlFor={`${titleId}-reason`}>
                סיבת עריכה
                <textarea
                  id={`${titleId}-reason`}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="למשל: תיקון סכום לפי אישור לקוח…"
                  rows={3}
                />
              </label>
              {err ? <p className="adm-order-edit-lock-modal__err">{err}</p> : null}
              <div className="adm-order-edit-lock-modal__actions">
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={busy} onClick={() => setStep("main")}>
                  חזרה
                </button>
                <button
                  type="button"
                  className={`adm-btn adm-btn--primary adm-btn--dense${busy ? " loading" : ""}`}
                  disabled={busy}
                  onClick={sendRequest}
                >
                  {busy ? "שולח…" : "שליחה"}
                </button>
              </div>
            </>
          )
        ) : null}

        {payload.variant === "pending_mine" ? (
          <>
            <p className="adm-order-edit-lock-modal__body">הבקשה שלך להזמנה זו ממתינה לאישור מנהל. ההזמנה תישאר נעולה עד לאישור.</p>
            <div className="adm-order-edit-lock-modal__actions">
              <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={handleClose}>
                הבנתי
              </button>
            </div>
          </>
        ) : null}

        {payload.variant === "pending_other" ? (
          <>
            <p className="adm-order-edit-lock-modal__body">קיימת בקשת עריכה ממתינה להזמנה זו (מעובד אחר). לא ניתן לשלוח בקשה נוספת עד לטיפול.</p>
            <div className="adm-order-edit-lock-modal__actions">
              <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={handleClose}>
                סגירה
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
