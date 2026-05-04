"use client";

import { useMemo, useState } from "react";
import { saveAdminSettingsAction, type AdminSettingsPayload } from "@/app/admin/settings/actions";
import { orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import { WORK_WEEK_CODES_SORTED } from "@/lib/work-week";

type Props = {
  initial: AdminSettingsPayload;
};

const PAYMENT_METHODS = [
  { value: "CASH", label: "מזומן" },
  { value: "CREDIT", label: "אשראי" },
  { value: "BANK_TRANSFER", label: "העברה בנקאית" },
  { value: "CHECK", label: "צ׳ק" },
  { value: "OTHER", label: "אחר" },
];

const ORDER_STATUSES = [
  { value: "OPEN", label: "פתוח" },
  { value: "WAITING_FOR_EXECUTION", label: "ממתין לביצוע" },
  { value: "WITHDRAWAL_FROM_SUPPLIER", label: "משיכה מספק" },
  { value: "SENT", label: "נשלח" },
  { value: "COMPLETED", label: "הושלם" },
];

export function AdminSettingsClient({ initial }: Props) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dollarFee = useMemo(() => {
    const base = Number(String(form.baseDollarRate).replace(",", "."));
    const final = Number(String(form.finalDollarRate).replace(",", "."));
    if (!Number.isFinite(base) || !Number.isFinite(final)) return "—";
    return Math.max(0, final - base).toFixed(4);
  }, [form.baseDollarRate, form.finalDollarRate]);

  function update<K extends keyof AdminSettingsPayload>(key: K, value: AdminSettingsPayload[K]) {
    setForm((old) => ({ ...old, [key]: value }));
    setError(null);
    setToast(null);
  }

  function toggleSelectedCountry(code: OrderCountryCode) {
    setForm((f) => {
      const has = f.selectedCountries.includes(code);
      const next = has ? f.selectedCountries.filter((c) => c !== code) : [...f.selectedCountries, code];
      if (next.length === 0) return f;
      return { ...f, selectedCountries: next };
    });
    setError(null);
    setToast(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveAdminSettingsAction(form);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setForm(res.payload);
    setSaved(res.payload);
    setToast("ההגדרות נשמרו בהצלחה");
    window.setTimeout(() => setToast(null), 3000);
  }

  function reset() {
    setForm(saved);
    setError(null);
    setToast(null);
  }

  return (
    <div className="adm-settings-page">
      <section className="adm-settings-hero">
        <div>
          <h1>הגדרות מערכת</h1>
          <p>שליטה מרכזית בהגדרות הכספיות, העבודה והמערכת של WEGO MARKETING.</p>
        </div>
        <span className={`adm-settings-mode adm-settings-mode--${form.systemMode.toLowerCase()}`}>
          {form.systemMode === "ACTIVE" ? "Active" : "Maintenance"}
        </span>
      </section>

      {toast ? <div className="adm-settings-toast" role="status">{toast}</div> : null}
      {error ? <div className="adm-error adm-error--compact">{error}</div> : null}

      <section className="adm-settings-grid">
        <article className="adm-settings-card">
          <div className="adm-settings-card-head">
            <span className="adm-settings-icon">💱</span>
            <div>
              <h2>הגדרות כספיות</h2>
              <p>שערי מטבע, מע״מ וברירות מחדל לתשלומים.</p>
            </div>
          </div>

          <div className="adm-settings-fields">
            <label>
              שער דולר בסיסי
              <input inputMode="decimal" value={form.baseDollarRate} onChange={(e) => update("baseDollarRate", e.target.value)} />
            </label>
            <label>
              שער דולר סופי
              <input inputMode="decimal" value={form.finalDollarRate} onChange={(e) => update("finalDollarRate", e.target.value)} />
            </label>
            <label>
              מע״מ (%)
              <input inputMode="decimal" value={form.vatRate} onChange={(e) => update("vatRate", e.target.value)} />
            </label>
            <label>
              ברירת מחדל אמצעי תשלום
              <select value={form.defaultPaymentMethod} onChange={(e) => update("defaultPaymentMethod", e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <div className="adm-settings-note">עמלת שער מחושבת: <strong dir="ltr">₪ {dollarFee}</strong></div>
        </article>

        <article className="adm-settings-card">
          <div className="adm-settings-card-head">
            <span className="adm-settings-icon">🌍</span>
            <div>
              <h2>מדינות להזמנות</h2>
              <p>ניתן לשייך לכל הזמנה מדינת מקור — רק המסומנות יופיעו בקליטת הזמנה ובטבלה.</p>
            </div>
          </div>
          <div className="adm-settings-fields adm-settings-countries">
            {(["TURKEY", "CHINA", "UAE"] as const).map((code) => (
              <label key={code} className="adm-settings-country-opt">
                <input
                  type="checkbox"
                  checked={form.selectedCountries.includes(code)}
                  onChange={() => toggleSelectedCountry(code)}
                />
                <span>{orderCountryLabel(code)}</span>
              </label>
            ))}
          </div>
        </article>

        <article className="adm-settings-card">
          <div className="adm-settings-card-head">
            <span className="adm-settings-icon">🗓️</span>
            <div>
              <h2>הגדרות עבודה</h2>
              <p>ברירות מחדל לתאריכים, שבועות עבודה וסטטוס הזמנה.</p>
            </div>
          </div>

          <div className="adm-settings-fields">
            <label>
              שבוע עבודה נוכחי
              <select value={form.currentWorkWeek} onChange={(e) => update("currentWorkWeek", e.target.value)}>
                {WORK_WEEK_CODES_SORTED.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label>
              פורמט תאריכים
              <select value={form.dateFormat} onChange={(e) => update("dateFormat", e.target.value)}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </label>
            <label>
              ברירת מחדל סטטוס הזמנה
              <select value={form.defaultOrderStatus} onChange={(e) => update("defaultOrderStatus", e.target.value)}>
                {ORDER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
        </article>

        <article className="adm-settings-card">
          <div className="adm-settings-card-head">
            <span className="adm-settings-icon">⚙️</span>
            <div>
              <h2>הגדרות מערכת</h2>
              <p>שם המערכת ומצב הפעילות הכללי.</p>
            </div>
          </div>

          <div className="adm-settings-fields">
            <label>
              שם מערכת
              <input value={form.systemName} onChange={(e) => update("systemName", e.target.value)} />
            </label>
            <label>
              מצב מערכת
              <select value={form.systemMode} onChange={(e) => update("systemMode", e.target.value as AdminSettingsPayload["systemMode"])}>
                <option value="ACTIVE">Active</option>
                <option value="MAINTENANCE">Maintenance</option>
              </select>
            </label>
          </div>
        </article>
      </section>

      <section className="adm-settings-actions">
        <button type="button" className="adm-btn adm-btn--primary" onClick={() => void save()} disabled={saving}>
          {saving ? "שומר..." : "שמירה"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={reset} disabled={saving}>
          איפוס
        </button>
      </section>
    </div>
  );
}
