"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { refreshAutomaticDollarRate, saveManualFinancialSettings } from "@/app/admin/financial/actions";
import { sanitizeCommissionPercentInput } from "@/lib/commission-percent";
import type { SerializedFinancial } from "@/lib/financial-settings";

type Props = {
  open: boolean;
  onClose: () => void;
  initial: SerializedFinancial | null;
  onToast: (msg: string) => void;
};

export function FinancialSettingsModal({ open, onClose, initial, onToast }: Props) {
  const router = useRouter();
  const [base, setBase] = useState(initial?.baseDollarRate ?? "3.40");
  const [fee, setFee] = useState(initial?.dollarFee ?? "0.10");
  const [defaultCommissionPercent, setDefaultCommissionPercent] = useState(
    initial?.defaultCommissionPercent ?? "0",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBase(initial?.baseDollarRate ?? "3.40");
    setFee(initial?.dollarFee ?? "0.10");
    setDefaultCommissionPercent(initial?.defaultCommissionPercent ?? "0");
    setErr(null);
  }, [open, initial]);

  const finalPreview = useMemo(() => {
    const b = Number(base.replace(",", "."));
    const f = Number((fee || "0").replace(",", "."));
    if (Number.isFinite(b) && Number.isFinite(f)) return (b + f).toFixed(4);
    return "—";
  }, [base, fee]);

  async function onSaveManual() {
    setBusy(true);
    setErr(null);
    const res = await saveManualFinancialSettings({
      baseDollarRate: base,
      dollarFee: fee,
      defaultCommissionPercent,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onToast("הגדרות נשמרו");
    router.refresh();
    onClose();
  }

  async function onRefreshAuto() {
    setBusy(true);
    setErr(null);
    const res = await refreshAutomaticDollarRate();
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onToast("שער אוטומטי עודכן");
    router.refresh();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="הגדרות כספים" size="md">
      <div className="adm-modal-form">
        {err ? <div className="adm-error">{err}</div> : null}
        <div className="adm-field">
          <label htmlFor="fs-base">שער בסיס (usd_rate_base)</label>
          <input id="fs-base" type="text" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="fs-fee">עמלת שער (usd_fee)</label>
          <input id="fs-fee" type="text" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="fs-commission-pct">אחוז עמלה ברירת מחדל</label>
          <input
            id="fs-commission-pct"
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={defaultCommissionPercent}
            placeholder="3.45"
            onChange={(e) => setDefaultCommissionPercent(sanitizeCommissionPercentInput(e.target.value))}
          />
          <p className="adm-field-hint" style={{ marginTop: "0.35rem" }}>
            יוחל אוטומטית בקליטת הזמנה חדשה. ניתן לשנות ידנית בהזמנה בודדת.
          </p>
        </div>
        <p className="adm-field-hint" style={{ marginTop: 0 }}>
          שער סופי מחושב (usd_rate_final): <strong>{finalPreview}</strong> ₪ לדולר
        </p>
        <div
          style={{
            background: "var(--color-surface-2, #f5f5f5)",
            borderRadius: "6px",
            padding: "0.6rem 0.8rem",
            fontSize: "0.8rem",
            color: "var(--color-text-muted, #666)",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "0.2rem 0.6rem",
          }}
        >
          <span style={{ fontWeight: 600 }}>מקור:</span>
          <span>{initial?.source ?? "—"}</span>
          <span style={{ fontWeight: 600 }}>עודכן לאחרונה:</span>
          <span>
            {initial?.updatedAt
              ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(
                  new Date(initial.updatedAt),
                )
              : "—"}
          </span>
          <span style={{ fontWeight: 600 }}>עודכן על ידי:</span>
          <span>{initial?.updatedByName ?? "—"}</span>
        </div>
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={onRefreshAuto}>
            רענון שער אוטומטי
          </button>
          <button type="button" className="adm-btn adm-btn--primary" disabled={busy} onClick={onSaveManual}>
            שמירה
          </button>
        </div>
      </div>
    </Modal>
  );
}
