"use client";

import { useState } from "react";
import {
  saveBusinessProfileAction,
  type BusinessProfilePayload,
} from "@/app/admin/settings/actions";
import { Building2, Camera, Globe2, MessageCircle, Save, ThumbsUp } from "lucide-react";

type Props = {
  initial: BusinessProfilePayload;
};

export function AdminSettingsClient({ initial }: Props) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof BusinessProfilePayload, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
    setToast(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveBusinessProfileAction(form);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(res.payload);
    setToast("פרטי העסק נשמרו");
    window.setTimeout(() => setToast(null), 3500);
  }

  function reset() {
    setForm(saved);
    setError(null);
    setToast(null);
  }

  const logoInitial = (form.systemName || "W").slice(0, 1).toUpperCase();

  return (
    <div className="adm-biz-page">

      {/* ── Header ── */}
      <header className="adm-biz-header">
        <div className="adm-biz-header-left">
          {form.businessLogoUrl ? (
            <img src={form.businessLogoUrl} alt="לוגו" className="adm-biz-logo" />
          ) : (
            <div className="adm-biz-logo-placeholder">{logoInitial}</div>
          )}
          <div>
            <h1 className="adm-biz-title"><Building2 size={18} strokeWidth={1.75} aria-hidden /> פרטי העסק</h1>
            <p className="adm-biz-subtitle">
              {form.systemName || "שם העסק"} · {form.businessPhone || "טלפון"} · {form.businessEmail || "אימייל"}
            </p>
          </div>
        </div>
      </header>

      {toast && <div className="adm-biz-toast" role="status">{toast}</div>}
      {error && <div className="adm-error adm-error--compact">{error}</div>}

      {/* ── Form Card ── */}
      <div className="adm-biz-card">

        <section className="adm-biz-section">
          <h2 className="adm-biz-section-title">פרטים כלליים</h2>
          <div className="adm-biz-grid">
            <label className="adm-biz-label adm-biz-span2">
              שם העסק
              <input
                className="adm-biz-input"
                value={form.systemName}
                placeholder="WEGO MARKETING"
                onChange={(e) => set("systemName", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              טלפון
              <input
                className="adm-biz-input"
                type="tel"
                dir="ltr"
                value={form.businessPhone}
                placeholder="050-0000000"
                onChange={(e) => set("businessPhone", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              אימייל
              <input
                className="adm-biz-input"
                type="email"
                dir="ltr"
                value={form.businessEmail}
                placeholder="info@business.com"
                onChange={(e) => set("businessEmail", e.target.value)}
              />
            </label>
            <label className="adm-biz-label adm-biz-span2">
              כתובת
              <input
                className="adm-biz-input"
                value={form.businessAddress}
                placeholder="רחוב, מספר, עיר"
                onChange={(e) => set("businessAddress", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              איש קשר
              <input
                className="adm-biz-input"
                value={form.contactPerson}
                placeholder="שם מנהל / בעל עסק"
                onChange={(e) => set("contactPerson", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              קישור לוגו (URL)
              <input
                className="adm-biz-input"
                dir="ltr"
                value={form.businessLogoUrl}
                placeholder="https://..."
                onChange={(e) => set("businessLogoUrl", e.target.value)}
              />
            </label>
          </div>
        </section>

        <div className="adm-biz-divider" />

        <section className="adm-biz-section">
          <h2 className="adm-biz-section-title">נוכחות דיגיטלית <span className="adm-biz-optional">(אופציונלי)</span></h2>
          <div className="adm-biz-grid">
            <label className="adm-biz-label">
              <span className="adm-biz-social-label"><Globe2 size={16} strokeWidth={1.75} aria-hidden /> אתר אינטרנט</span>
              <input
                className="adm-biz-input"
                dir="ltr"
                value={form.businessWebsite}
                placeholder="https://www.business.com"
                onChange={(e) => set("businessWebsite", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              <span className="adm-biz-social-label"><MessageCircle size={16} strokeWidth={1.75} aria-hidden /> WhatsApp</span>
              <input
                className="adm-biz-input"
                dir="ltr"
                value={form.businessWhatsapp}
                placeholder="+972-50-0000000"
                onChange={(e) => set("businessWhatsapp", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              <span className="adm-biz-social-label"><Camera size={16} strokeWidth={1.75} aria-hidden /> Instagram</span>
              <input
                className="adm-biz-input"
                dir="ltr"
                value={form.businessInstagram}
                placeholder="@username"
                onChange={(e) => set("businessInstagram", e.target.value)}
              />
            </label>
            <label className="adm-biz-label">
              <span className="adm-biz-social-label"><ThumbsUp size={16} strokeWidth={1.75} aria-hidden /> Facebook</span>
              <input
                className="adm-biz-input"
                dir="ltr"
                value={form.businessFacebook}
                placeholder="facebook.com/page"
                onChange={(e) => set("businessFacebook", e.target.value)}
              />
            </label>
          </div>
        </section>

        <div className="adm-biz-divider" />

        <section className="adm-biz-section">
          <label className="adm-biz-label">
            הערות
            <textarea
              className="adm-biz-input adm-biz-textarea"
              value={form.businessNotes}
              rows={3}
              placeholder="מידע נוסף על העסק..."
              onChange={(e) => set("businessNotes", e.target.value)}
            />
          </label>
        </section>

        <div className="adm-biz-actions">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={reset} disabled={saving}>
            ביטול
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary adm-biz-save-btn"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "שומר..." : <><Save size={16} strokeWidth={1.75} aria-hidden /> שמור פרטי עסק</>}
          </button>
        </div>

      </div>

    </div>
  );
}
