"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CashDailyDayDetailPayload } from "@/app/admin/cash-control/daily-types";
import type { WorkCountryCode } from "@/lib/work-country";
import { saveShipmentCashCountsAction } from "@/app/admin/shipments/cash-control/actions";
import { CASH_CONTROL_METHODS } from "@/app/admin/shipments/types";
import { SHIPPING_CASH_METHOD_LABELS } from "@/components/admin/cash-control/shipping-table-config";

export type ShipmentCashCountQuickModalProps = {
  open: boolean;
  onClose: () => void;
  dayDetail: CashDailyDayDetailPayload | null;
  dayLoading: boolean;
  editable: boolean;
  workCountry: WorkCountryCode;
  onSaved: () => void | Promise<void>;
};

function emptyDraft(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of CASH_CONTROL_METHODS) out[m.value] = "";
  return out;
}

function draftFromDetail(detail: CashDailyDayDetailPayload | null): Record<string, string> {
  if (!detail) return emptyDraft();
  const out = emptyDraft();
  const drawer = detail.drawer as Partial<Record<string, string | null>>;
  for (const m of CASH_CONTROL_METHODS) {
    out[m.value] = drawer[m.value] ?? "";
  }
  return out;
}

export function ShipmentCashCountQuickModal({
  open,
  onClose,
  dayDetail,
  dayLoading,
  editable,
  workCountry,
  onSaved,
}: ShipmentCashCountQuickModalProps) {
  const [draft, setDraft] = useState<Record<string, string>>(emptyDraft);
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
    ? `ספירת קופה משלוחים – ${dayDetail.dayName} | ${dayDetail.weekCode}`
    : "ספירת קופה משלוחים";

  const save = useCallback(async () => {
    if (!editable || !dayDetail) {
      setErr("רק מנהל יכול לשמור ספירת קופה");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const counts: Array<{ method: string; countedIls: number }> = [];
      for (const m of CASH_CONTROL_METHODS) {
        const raw = (draft[m.value] ?? "").trim();
        if (!raw) continue;
        const countedIls = Number(raw);
        if (!Number.isFinite(countedIls)) continue;
        counts.push({ method: m.value, countedIls });
      }

      const res = await saveShipmentCashCountsAction(workCountry, {
        dayDate: dayDetail.dateYmd,
        counts,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [dayDetail, draft, editable, onClose, onSaved, workCountry]);

  if (!open) return null;

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--cash-count"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-cash-count-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cash-modal__head cash-count-quick__head">
          <h3 id="shipment-cash-count-title">{title}</h3>
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
              {CASH_CONTROL_METHODS.map((m) => (
                <label key={m.value} className="adm-cash-field cash-count-quick__field">
                  <span className="cash-count-quick__label">{SHIPPING_CASH_METHOD_LABELS[m.value] ?? m.label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cc-input"
                    value={draft[m.value] ?? ""}
                    placeholder="0"
                    dir="ltr"
                    disabled={saving}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [m.value]: e.target.value }))}
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
