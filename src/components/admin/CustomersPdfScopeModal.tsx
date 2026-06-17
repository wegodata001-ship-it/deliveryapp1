"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { CustomersPdfScope } from "@/lib/customers-module-types";

type Props = {
  open: boolean;
  busy?: boolean;
  hasCurrentCustomer: boolean;
  onClose: () => void;
  onExport: (scope: CustomersPdfScope) => void;
};

const SCOPE_OPTIONS: { value: CustomersPdfScope; label: string; hint: string }[] = [
  { value: "current", label: "לקוח נוכחי", hint: "רק הלקוח שנבחר בכרטיס" },
  { value: "all", label: "כל הלקוחות", hint: "כל הלקוחות הפעילים במערכת" },
  { value: "debt", label: "חובות בלבד", hint: "לקוחות עם יתרת חוב חיובית" },
  { value: "credit", label: "יתרות זכות בלבד", hint: "לקוחות עם יתרת זכות שלילית" },
];

export function CustomersPdfScopeModal({ open, busy = false, hasCurrentCustomer, onClose, onExport }: Props) {
  const [scope, setScope] = useState<CustomersPdfScope>(hasCurrentCustomer ? "current" : "all");

  return (
    <Modal open={open} onClose={onClose} title="הפקת PDF — רשימת לקוחות" size="sm">
      <div className="adm-ledger-pdf-export-modal">
        <p className="adm-ledger-pdf-export-modal__lead">בחרו היקף לייצוא:</p>
        <fieldset className="adm-ledger-pdf-export-modal__options" aria-label="היקף ייצוא">
          {SCOPE_OPTIONS.map((opt) => {
            const disabled = opt.value === "current" && !hasCurrentCustomer;
            return (
              <label
                key={opt.value}
                className={[
                  "adm-ledger-pdf-export-modal__option",
                  disabled ? "adm-ledger-pdf-export-modal__option--disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input
                  type="radio"
                  name="customers-pdf-scope"
                  value={opt.value}
                  checked={scope === opt.value}
                  disabled={busy || disabled}
                  onChange={() => setScope(opt.value)}
                />
                <span>
                  <strong>{opt.label}</strong>
                  <small>{disabled ? "יש לבחור לקוח תחילה" : opt.hint}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn adm-btn--secondary" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary adm-export-btn--pdf"
            disabled={busy || (scope === "current" && !hasCurrentCustomer)}
            onClick={() => onExport(scope)}
          >
            {busy ? (
              <>
                <span className="payment-modal-save-spinner" aria-hidden />
                מייצא…
              </>
            ) : (
              "הפק"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
