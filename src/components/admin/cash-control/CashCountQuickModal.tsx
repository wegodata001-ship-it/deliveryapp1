"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { saveCashDailyDrawerAction } from "@/app/admin/cash-control/save-drawer-action";
import type { CashDailyDayDetailPayload } from "@/app/admin/cash-control/daily-types";
import { CASH_DAILY_METHODS, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { MethodIcon } from "@/components/admin/cash-flow/shared";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";

export type CashCountQuickModalProps = {
  open: boolean;
  onClose: () => void;
  week: string;
  dayDetail: CashDailyDayDetailPayload | null;
  dayLoading: boolean;
  editable: boolean;
  onSaved: () => void | Promise<void>;
};

function emptyDraft(): Partial<Record<CashDailyMethodId, string>> {
  const out: Partial<Record<CashDailyMethodId, string>> = {};
  for (const m of CASH_DAILY_METHODS) out[m.id] = "";
  return out;
}

function draftFromDetail(detail: CashDailyDayDetailPayload | null): Partial<Record<CashDailyMethodId, string>> {
  if (!detail) return emptyDraft();
  const out = emptyDraft();
  for (const m of CASH_DAILY_METHODS) {
    out[m.id] = detail.drawer[m.id] ?? "";
  }
  return out;
}

export function CashCountQuickModal({
  open,
  onClose,
  week,
  dayDetail,
  dayLoading,
  editable,
  onSaved,
}: CashCountQuickModalProps) {
  const [draft, setDraft] = useState<Partial<Record<CashDailyMethodId, string>>>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(draftFromDetail(dayDetail));
    setErr(null);
  }, [open, dayDetail]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const title = dayDetail
    ? `ספירת קופה – ${dayDetail.dayName} | ${dayDetail.weekCode}`
    : "ספירת קופה";

  const save = useCallback(async () => {
    if (!editable || !dayDetail) {
      setErr("רק מנהל יכול לשמור ספירת קופה");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const drawer: Partial<Record<CashDailyMethodId, string | null>> = {};
      for (const m of CASH_DAILY_METHODS) {
        const raw = (draft[m.id] ?? "").trim();
        drawer[m.id] = raw === "" ? null : raw;
      }
      const res = await saveCashDailyDrawerAction({
        week,
        dateYmd: dayDetail.dateYmd,
        drawer,
      });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      await onSaved();
      dispatchCashControlRefresh(week);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [dayDetail, draft, editable, onClose, onSaved, week]);

  if (!open) return null;

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--cash-count"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-count-quick-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cash-modal__head cash-count-quick__head">
          <h3 id="cash-count-quick-title">{title}</h3>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="adm-cash-modal__body cash-count-quick__body">
          {dayLoading && !dayDetail ? (
            <p className="cc-muted">טוען נתוני יום…</p>
          ) : !editable ? (
            <p className="cc-muted">רק מנהל יכול לבצע ספירת קופה.</p>
          ) : (
            <div className="cash-count-quick__grid">
              {CASH_DAILY_METHODS.map((m) => (
                <label key={m.id} className="adm-cash-field cash-count-quick__field">
                  <span className="cash-count-quick__label">
                    <MethodIcon method={m.id} size={14} />
                    {m.label}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cc-input"
                    value={draft[m.id] ?? ""}
                    placeholder="0"
                    dir="ltr"
                    disabled={saving}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void save();
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          {err ? <div className="cxp-err">{err}</div> : null}
        </div>

        <footer className="adm-cash-modal__foot cash-count-quick__foot">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          {editable ? (
            <button
              type="button"
              className="cc-btn cc-btn--primary cc-btn--green"
              disabled={saving || dayLoading || !dayDetail}
              onClick={() => void save()}
            >
              {saving ? "שומר…" : "שמור ספירה"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

export default CashCountQuickModal;
