"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import {
  loadFinancialSettingsAction,
  resetFinancialSettingsToDefaultsAction,
  saveManualFinancialSettings,
} from "@/app/admin/financial/actions";
import { sanitizeCommissionPercentInput } from "@/lib/commission-percent";
import { FINANCIAL_SETTINGS_DEFAULTS, type SerializedFinancial } from "@/lib/financial-settings";

type Props = {
  open: boolean;
  onClose: () => void;
  /** ערכי layout (עשויים להיות null ב-light) — לא משמשים לטעינה */
  initial: SerializedFinancial | null;
  onToast: (msg: string, opts?: { variant?: "success" | "error" }) => void;
};

function applySerialized(
  data: SerializedFinancial,
  setters: {
    setBase: (v: string) => void;
    setFee: (v: string) => void;
    setDefaultCommissionPercent: (v: string) => void;
    setMeta: (v: SerializedFinancial) => void;
  },
): void {
  setters.setBase(data.baseDollarRate);
  setters.setFee(data.dollarFee);
  setters.setDefaultCommissionPercent(data.defaultCommissionPercent);
  setters.setMeta(data);
}

export function FinancialSettingsModal({ open, onClose, onToast }: Props) {
  const router = useRouter();
  const [base, setBase] = useState<string>(FINANCIAL_SETTINGS_DEFAULTS.baseDollarRate);
  const [fee, setFee] = useState<string>(FINANCIAL_SETTINGS_DEFAULTS.dollarFee);
  const [defaultCommissionPercent, setDefaultCommissionPercent] = useState<string>(
    FINANCIAL_SETTINGS_DEFAULTS.defaultCommissionPercent,
  );
  const [meta, setMeta] = useState<SerializedFinancial | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadFromServer = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await loadFinancialSettingsAction();
      applySerialized(data, { setBase, setFee, setDefaultCommissionPercent, setMeta });
    } catch {
      setErr("שגיאה בטעינת הגדרות");
      onToast("שגיאה בטעינת הגדרות", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    if (!open) return;
    void loadFromServer();
  }, [open, loadFromServer]);

  const finalPreview = useMemo(() => {
    const b = Number(base.replace(",", "."));
    const f = Number((fee || "0").replace(",", "."));
    if (Number.isFinite(b) && Number.isFinite(f)) return (b + f).toFixed(2);
    return "—";
  }, [base, fee]);

  const calcLine = useMemo(() => {
    const b = base.replace(",", ".");
    const f = (fee || "0").replace(",", ".");
    return `${b} + ${f} = ${finalPreview}`;
  }, [base, fee, finalPreview]);

  async function onSaveManual() {
    setBusy(true);
    setErr(null);
    try {
      const res = await saveManualFinancialSettings({
        baseDollarRate: base,
        dollarFee: fee,
        defaultCommissionPercent,
      });
      if (!res.ok) {
        setErr(res.error);
        onToast("שגיאה בשמירה", { variant: "error" });
        return;
      }
      applySerialized(res.settings, { setBase, setFee, setDefaultCommissionPercent, setMeta });
      onToast("הגדרות נשמרו בהצלחה", { variant: "success" });
      router.refresh();
    } catch {
      setErr("שגיאה בשמירה");
      onToast("שגיאה בשמירה", { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function onResetDefaults() {
    if (!window.confirm("לאפס את הגדרות ברירת המחדל להזמנות?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await resetFinancialSettingsToDefaultsAction();
      if (!res.ok) {
        setErr(res.error);
        onToast("שגיאה בשמירה", { variant: "error" });
        return;
      }
      applySerialized(res.settings, { setBase, setFee, setDefaultCommissionPercent, setMeta });
      onToast("הגדרות נשמרו בהצלחה", { variant: "success" });
      router.refresh();
    } catch {
      setErr("שגיאה בשמירה");
      onToast("שגיאה בשמירה", { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="הגדרות כספים" size="md">
      <div className="adm-fin-settings" aria-busy={loading || busy}>
        {loading ? (
          <p className="adm-fin-settings__loading">טוען הגדרות…</p>
        ) : null}

        {err ? <div className="adm-error adm-fin-settings__err">{err}</div> : null}

        <h2 className="adm-fin-settings__section-title">הגדרות ברירת מחדל להזמנות</h2>

        <div className="adm-fin-settings__fields">
          <div className="adm-field">
            <label htmlFor="fs-base">שער דולר בסיסי</label>
            <input
              id="fs-base"
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={base}
              disabled={loading || busy}
              onChange={(e) => setBase(e.target.value)}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="fs-fee">עלות שער</label>
            <input
              id="fs-fee"
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={fee}
              disabled={loading || busy}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="fs-commission-pct">אחוז עמלה ברירת מחדל</label>
            <input
              id="fs-commission-pct"
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={defaultCommissionPercent}
              disabled={loading || busy}
              placeholder="0"
              onChange={(e) => setDefaultCommissionPercent(sanitizeCommissionPercentInput(e.target.value))}
            />
          </div>
        </div>

        <div className="adm-fin-settings__live">
          <p className="adm-fin-settings__live-label">שער סופי להזמנה:</p>
          <p className="adm-fin-settings__live-value">
            {finalPreview} <span>₪</span>
          </p>
          <p className="adm-fin-settings__live-calc">חישוב: {calcLine}</p>
        </div>

        <div className="adm-fin-settings__impact" role="note">
          <p className="adm-fin-settings__impact-title">משפיע על:</p>
          <ul className="adm-fin-settings__impact-list adm-fin-settings__impact-list--yes">
            <li>הזמנות חדשות</li>
            <li>חישובי עמלה</li>
            <li>קליטת תשלום</li>
          </ul>
          <p className="adm-fin-settings__impact-title">לא משפיע על:</p>
          <ul className="adm-fin-settings__impact-list adm-fin-settings__impact-list--no">
            <li>הזמנות ישנות</li>
          </ul>
        </div>

        {meta?.updatedAt ? (
          <p className="adm-fin-settings__meta">
            עודכן לאחרונה:{" "}
            {new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(
              new Date(meta.updatedAt),
            )}
            {meta.updatedByName ? ` · ${meta.updatedByName}` : ""}
          </p>
        ) : null}

        <div className="adm-fin-settings__actions">
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={loading || busy}
            onClick={() => void onSaveManual()}
          >
            שמירת הגדרות
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost"
            disabled={loading || busy}
            onClick={() => void onResetDefaults()}
          >
            איפוס לברירת מחדל
          </button>
        </div>
      </div>
    </Modal>
  );
}
