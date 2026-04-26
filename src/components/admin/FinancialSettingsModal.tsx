"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { refreshAutomaticDollarRate, saveManualFinancialSettings } from "@/app/admin/financial/actions";
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBase(initial?.baseDollarRate ?? "3.40");
    setFee(initial?.dollarFee ?? "0.10");
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
    const res = await saveManualFinancialSettings({ baseDollarRate: base, dollarFee: fee });
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
        <p className="adm-field-hint" style={{ marginTop: 0 }}>
          שער סופי מחושב (usd_rate_final): <strong>{finalPreview}</strong> ₪ לדולר
        </p>
        <p className="adm-field-hint">
          מקור נוכחי: {initial?.source ?? "—"} · עודכן לאחרונה:{" "}
          {initial?.updatedAt
            ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(initial.updatedAt))
            : "—"}
        </p>
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
