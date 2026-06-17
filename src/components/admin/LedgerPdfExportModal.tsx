"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { LedgerPdfMode } from "@/lib/customer-ledger-export";

type Props = {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onExport: (mode: LedgerPdfMode) => void;
};

export function LedgerPdfExportModal({ open, busy = false, onClose, onExport }: Props) {
  const [mode, setMode] = useState<LedgerPdfMode>("regular");

  return (
    <Modal open={open} onClose={onClose} title="הפקת PDF" size="sm">
      <div className="adm-ledger-pdf-export-modal">
        <p className="adm-ledger-pdf-export-modal__lead">בחרו סוג PDF לייצוא:</p>
        <fieldset className="adm-ledger-pdf-export-modal__options" aria-label="סוג PDF">
          <label className="adm-ledger-pdf-export-modal__option">
            <input
              type="radio"
              name="ledger-pdf-mode"
              value="regular"
              checked={mode === "regular"}
              disabled={busy}
              onChange={() => setMode("regular")}
            />
            <span>
              <strong>PDF רגיל</strong>
              <small>תאריך, מסמך, סוג, חיוב, תשלום ויתרה — ללא פירוט אמצעי תשלום</small>
            </span>
          </label>
          <label className="adm-ledger-pdf-export-modal__option">
            <input
              type="radio"
              name="ledger-pdf-mode"
              value="detailed"
              checked={mode === "detailed"}
              disabled={busy}
              onChange={() => setMode("detailed")}
            />
            <span>
              <strong>PDF מפורט</strong>
              <small>כולל פירוט אמצעי תשלום לכל תשלום (₪ ו-$)</small>
            </span>
          </label>
        </fieldset>
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn adm-btn--secondary" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary adm-export-btn--pdf"
            disabled={busy}
            onClick={() => onExport(mode)}
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
