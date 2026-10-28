"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";
import {
  CUSTOMER_FACING_PDF_DEFAULT_MESSAGE,
  CUSTOMER_FACING_PDF_TITLE,
  type CustomerFacingPdfContent,
  type CustomerFacingPdfOptions,
  type CustomerFacingPdfPeriodMode,
  downloadCustomerFacingPdfBlob,
  generateCustomerFacingLedgerPdfBlob,
  openEmailShare,
  openWhatsAppShare,
  shareCustomerFacingPdf,
} from "@/lib/customer-facing-ledger-pdf";

type Props = {
  open: boolean;
  busy?: boolean;
  meta: CustomerLedgerExportMeta | null;
  ledger: CustomerLedgerPayload | null;
  onClose: () => void;
  onToast?: (message: string) => void;
};

export function CustomerLedgerCustomerPdfModal({
  open,
  meta,
  ledger,
  onClose,
  onToast,
}: Props) {
  const [content, setContent] = useState<CustomerFacingPdfContent>("both");
  const [periodMode, setPeriodMode] = useState<CustomerFacingPdfPeriodMode>("ledger");
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");
  const [message, setMessage] = useState(CUSTOMER_FACING_PDF_DEFAULT_MESSAGE);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfFilename, setPdfFilename] = useState("");
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !meta) return;
    setPeriodMode("ledger");
    setFromYmd(meta.fromYmd);
    setToYmd(meta.toYmd);
    setContent("both");
    setMessage(CUSTOMER_FACING_PDF_DEFAULT_MESSAGE);
    setErr(null);
  }, [open, meta]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const options: CustomerFacingPdfOptions | null = useMemo(() => {
    if (!meta) return null;
    return {
      content,
      periodMode,
      fromYmd: periodMode === "custom" ? fromYmd : meta.fromYmd,
      toYmd: periodMode === "custom" ? toYmd : meta.toYmd,
    };
  }, [content, periodMode, fromYmd, toYmd, meta]);

  const resetPreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPdfBlob(null);
    setPdfFilename("");
  }, [previewUrl]);

  const generate = useCallback(async () => {
    if (!meta || !ledger || !options) return null;
    setGenerating(true);
    setErr(null);
    try {
      resetPreview();
      const result = await generateCustomerFacingLedgerPdfBlob({ meta, ledger, options });
      const url = URL.createObjectURL(result.blob);
      setPreviewUrl(url);
      setPdfBlob(result.blob);
      setPdfFilename(result.filename);
      return result;
    } catch {
      setErr("יצירת PDF נכשלה. נסו שוב.");
      return null;
    } finally {
      setGenerating(false);
    }
  }, [ledger, meta, options, resetPreview]);

  async function onPreview() {
    await generate();
  }

  async function onDownload() {
    let blob = pdfBlob;
    let filename = pdfFilename;
    if (!blob || !filename) {
      const res = await generate();
      if (!res) return;
      blob = res.blob;
      filename = res.filename;
    }
    downloadCustomerFacingPdfBlob(blob, filename);
    onToast?.("הקובץ הורד");
  }

  async function onShareNative() {
    let blob = pdfBlob;
    let filename = pdfFilename;
    if (!blob || !filename) {
      const res = await generate();
      if (!res) return;
      blob = res.blob;
      filename = res.filename;
    }
    try {
      const mode = await shareCustomerFacingPdf({
        blob,
        filename,
        customerName: meta?.displayName ?? "",
        message,
      });
      onToast?.(mode === "shared" ? "נשלח דרך שיתוף המכשיר" : "הורדה — צרפו את הקובץ ידנית לשיתוף");
    } catch {
      onToast?.("שיתוף בוטל או נכשל");
    }
  }

  async function onShareWhatsApp() {
    let blob = pdfBlob;
    let filename = pdfFilename;
    if (!blob || !filename) {
      const res = await generate();
      if (!res) return;
      blob = res.blob;
      filename = res.filename;
    }
    downloadCustomerFacingPdfBlob(blob, filename);
    openWhatsAppShare(message, meta?.phone);
    onToast?.("WhatsApp נפתח — צרפו את הקובץ שהורד");
  }

  function onShareEmail() {
    openEmailShare({
      to: meta?.email,
      subject: CUSTOMER_FACING_PDF_TITLE,
      body: `${message}\n\n(צרפו את קובץ ה-PDF שהורדתם: ${pdfFilename || "דוח לקוח.pdf"})`,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="הפקת PDF ללקוח" size="md">
      <div className="adm-cust-pdf-modal" dir="rtl">
        <fieldset className="adm-cust-pdf-modal__group" aria-label="תוכן הדוח">
          <legend>תוכן</legend>
          <label>
            <input
              type="radio"
              name="cust-pdf-content"
              checked={content === "both"}
              onChange={() => {
                resetPreview();
                setContent("both");
              }}
            />
            הזמנות ותשלומים
          </label>
          <label>
            <input
              type="radio"
              name="cust-pdf-content"
              checked={content === "orders"}
              onChange={() => {
                resetPreview();
                setContent("orders");
              }}
            />
            הזמנות בלבד
          </label>
          <label>
            <input
              type="radio"
              name="cust-pdf-content"
              checked={content === "payments"}
              onChange={() => {
                resetPreview();
                setContent("payments");
              }}
            />
            תשלומים בלבד
          </label>
        </fieldset>

        <fieldset className="adm-cust-pdf-modal__group" aria-label="תקופה">
          <legend>תקופה</legend>
          <label>
            <input
              type="radio"
              name="cust-pdf-period"
              checked={periodMode === "ledger"}
              onChange={() => {
                resetPreview();
                setPeriodMode("ledger");
              }}
            />
            כל התקופה בכרטסת ({meta?.fromYmd || "—"} — {meta?.toYmd || "—"})
          </label>
          <label>
            <input
              type="radio"
              name="cust-pdf-period"
              checked={periodMode === "custom"}
              onChange={() => {
                resetPreview();
                setPeriodMode("custom");
              }}
            />
            טווח תאריכים מותאם
          </label>
          {periodMode === "custom" ? (
            <div className="adm-cust-pdf-modal__dates">
              <label>
                מתאריך
                <input type="date" value={fromYmd} onChange={(e) => { resetPreview(); setFromYmd(e.target.value); }} dir="ltr" />
              </label>
              <label>
                עד תאריך
                <input type="date" value={toYmd} onChange={(e) => { resetPreview(); setToYmd(e.target.value); }} dir="ltr" />
              </label>
            </div>
          ) : null}
        </fieldset>

        <label className="adm-cust-pdf-modal__msg">
          הודעה לשיתוף
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        </label>

        {err ? <div className="adm-error adm-error--compact">{err}</div> : null}

        <div className="adm-cust-pdf-modal__preview">
          <div className="adm-cust-pdf-modal__preview-head">
            <strong>תצוגה מקדימה</strong>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={generating || !ledger} onClick={() => void onPreview()}>
              {generating ? "מייצר…" : "רענון תצוגה"}
            </button>
          </div>
          {previewUrl ? (
            <iframe title="תצוגה מקדימה PDF" className="adm-cust-pdf-modal__frame" src={previewUrl} />
          ) : (
            <p className="adm-cust-pdf-modal__empty">לחצו «רענון תצוגה» ליצירת PDF לפני הורדה או שיתוף.</p>
          )}
        </div>

        <div className="adm-modal-actions adm-cust-pdf-modal__actions">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>
            סגירה
          </button>
          <button type="button" className="adm-btn adm-btn--secondary" disabled={generating || !ledger} onClick={() => void onShareEmail()}>
            דוא&quot;ל
          </button>
          <button type="button" className="adm-btn adm-btn--secondary" disabled={generating || !ledger} onClick={() => void onShareWhatsApp()}>
            WhatsApp
          </button>
          <button type="button" className="adm-btn adm-btn--secondary" disabled={generating || !ledger} onClick={() => void onShareNative()}>
            שיתוף
          </button>
          <button type="button" className="adm-btn adm-btn--primary adm-export-btn--pdf" disabled={generating || !ledger} onClick={() => void onDownload()}>
            {generating ? "מייצר…" : "הורדת PDF"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default CustomerLedgerCustomerPdfModal;
