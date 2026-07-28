"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { ShipmentRecordDto } from "@/app/admin/shipments/types";
import {
  assessCustomerName,
  customerNameIssueLabel,
} from "@/lib/shipment-customer-name-quality";

type Props = {
  record: ShipmentRecordDto;
  busy?: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
};

export function CustomerNameFixModal({ record, busy = false, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(record.customerName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentAssessment = assessCustomerName(record.customerName);
  const draftAssessment = assessCustomerName(draft);

  useEffect(() => {
    setDraft(record.customerName ?? "");
    setError(null);
  }, [record.id, record.customerName]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [record.id]);

  const locked = busy || saving;

  async function handleSave() {
    const name = draft.trim();
    const check = assessCustomerName(name);
    if (!check.ok) {
      setError(
        `השם עדיין לא תקין: ${check.issues.map(customerNameIssueLabel).join(", ")}`,
      );
      return;
    }
    setError(null);
    setSaving(true);
    const ok = await onSave(name);
    setSaving(false);
    if (ok) onClose();
    else setError("שמירת השם נכשלה");
  }

  return (
    <div
      className="shp-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        className="shp-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cust-name-fix-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420, width: "min(420px, 96vw)" }}
      >
        <header className="shp-modal__head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={18} color="#ea580c" />
          <strong id="cust-name-fix-title" style={{ flex: 1 }}>
            תיקון שם לקוח
          </strong>
          <button
            type="button"
            className="shp-modal__header-close"
            onClick={onClose}
            disabled={locked}
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#475569" }}>
            קוד:{" "}
            <strong dir="ltr">{record.customerCode || "—"}</strong>
            {record.city ? (
              <span style={{ color: "#94a3b8" }}> · {record.city}</span>
            ) : null}
          </div>

          {!currentAssessment.ok ? (
            <div
              className="shp-alert"
              style={{ margin: 0, background: "#fff7ed", color: "#9a3412" }}
            >
              שם הלקוח דורש תיקון
              {currentAssessment.issues.length
                ? ` (${currentAssessment.issues.map(customerNameIssueLabel).join(", ")})`
                : ""}
            </div>
          ) : null}

          <div className="shp-form-field" style={{ margin: 0 }}>
            <label>שם נוכחי</label>
            <div
              style={{
                padding: "8px 10px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 13,
                color: "#64748b",
                minHeight: 36,
              }}
            >
              {record.customerName?.trim() || <em>ריק</em>}
            </div>
          </div>

          <div className="shp-form-field" style={{ margin: 0 }}>
            <label htmlFor="cust-name-fix-input">שם מתוקן</label>
            <input
              ref={inputRef}
              id="cust-name-fix-input"
              value={draft}
              disabled={locked}
              placeholder="הזן שם לקוח תקין"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
            {!draftAssessment.ok && draft.trim() ? (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#c2410c" }}>
                {draftAssessment.issues.map(customerNameIssueLabel).join(" · ")}
              </p>
            ) : null}
          </div>

          <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
            השם יישמר במשלוח, ובכרטיס הלקוח (אם קיים) — וגם במשלוחים אחרים עם אותו קוד לקוח.
          </p>

          {error ? (
            <div className="shp-alert shp-alert--error" style={{ margin: 0 }}>
              {error}
            </div>
          ) : null}
        </div>

        <footer className="shp-modal__foot" style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={locked || !draft.trim() || !draftAssessment.ok}
            onClick={() => void handleSave()}
          >
            {saving ? "שומר…" : "שמור"}
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={locked}
            onClick={onClose}
          >
            ביטול
          </button>
        </footer>
      </div>
    </div>
  );
}
