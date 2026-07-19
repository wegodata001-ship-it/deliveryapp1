"use client";

import { useState } from "react";
import { X, Plus, Trash2, Banknote, Pencil } from "lucide-react";
import { saveShipmentPaymentsAction } from "@/app/admin/shipments/actions";
import type {
  PaymentMethodValue,
  ShipmentPaymentDetails,
  ShipmentPaymentLineDto,
  ShipmentRecordDto,
} from "@/app/admin/shipments/types";
import {
  PAYMENT_METHODS,
  SHIPMENT_PAYMENT_STATUS_LABELS,
} from "@/app/admin/shipments/types";

type Props = {
  record: ShipmentRecordDto;
  onClose: () => void;
  onSaved: (updatedRecord: ShipmentRecordDto) => void;
};

type DraftLine = {
  id?: string;
  key: number;
  method: PaymentMethodValue;
  amountIls: string;
  notes: string;
  referenceNumber: string;
  bankName: string;
  paymentDate: string;
  checkNumber: string;
  dueDate: string;
  accountHolderName: string;
  cardLastFour: string;
  cardType: string;
  approvalNumber: string;
  installments: string;
  description: string;
};

function createDraftLine(payment?: ShipmentPaymentLineDto): DraftLine {
  const details = payment?.details;
  return {
    id: payment?.id,
    key: Date.now() + Math.random(),
    method: (payment?.method as PaymentMethodValue | undefined) ?? "CASH",
    amountIls: payment ? String(payment.amountIls) : "",
    notes: payment?.notes ?? "",
    referenceNumber: details?.referenceNumber ?? "",
    bankName: details?.bankName ?? "",
    paymentDate: details?.paymentDate ?? "",
    checkNumber: details?.checkNumber ?? "",
    dueDate: details?.dueDate ?? "",
    accountHolderName: details?.accountHolderName ?? "",
    cardLastFour: details?.cardLastFour ?? "",
    cardType: details?.cardType ?? "",
    approvalNumber: details?.approvalNumber ?? "",
    installments: details?.installments ? String(details.installments) : "",
    description: details?.description ?? "",
  };
}

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2 });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function compactDetails(line: DraftLine): ShipmentPaymentDetails | undefined {
  const details: ShipmentPaymentDetails = {};
  const put = (key: keyof ShipmentPaymentDetails, value: string) => {
    const trimmed = value.trim();
    if (trimmed) (details as Record<string, string | number>)[key] = trimmed;
  };

  if (line.method === "BANK_TRANSFER") {
    put("referenceNumber", line.referenceNumber);
    put("bankName", line.bankName);
    put("paymentDate", line.paymentDate);
  } else if (line.method === "CHECK") {
    put("checkNumber", line.checkNumber);
    put("bankName", line.bankName);
    put("dueDate", line.dueDate);
    put("accountHolderName", line.accountHolderName);
  } else if (line.method === "CREDIT") {
    put("cardLastFour", line.cardLastFour);
    put("cardType", line.cardType);
    put("approvalNumber", line.approvalNumber);
    const installments = Number.parseInt(line.installments, 10);
    if (Number.isFinite(installments) && installments > 0) details.installments = installments;
  } else if (line.method === "BIT" || line.method === "PAYBOX") {
    put("referenceNumber", line.referenceNumber);
  } else if (line.method === "OTHER") {
    put("description", line.description);
    put("referenceNumber", line.referenceNumber);
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function paymentDetailsText(details: ShipmentPaymentDetails | null): string {
  if (!details) return "";
  const labels: Partial<Record<keyof ShipmentPaymentDetails, string>> = {
    referenceNumber: "אסמכתא",
    bankName: "בנק",
    paymentDate: "תאריך העברה",
    checkNumber: "מס׳ צ׳ק",
    dueDate: "פירעון",
    accountHolderName: "בעל חשבון",
    cardLastFour: "4 ספרות",
    cardType: "סוג כרטיס",
    approvalNumber: "אישור",
    installments: "תשלומים",
    description: "תיאור",
  };
  return Object.entries(details)
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${labels[key as keyof ShipmentPaymentDetails] ?? key}: ${value}`)
    .join(" · ");
}

function PaymentHistory({ payments }: { payments: ShipmentPaymentLineDto[] }) {
  if (payments.length === 0) return null;
  const byCreated = [...payments].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const edited = payments
    .filter((payment) => payment.updatedById)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
  const creators = [...new Set(
    payments.map((payment) => payment.createdByName).filter((name): name is string => Boolean(name)),
  )];

  return (
    <div className="shp-payment-history">
      <div className="shp-payment-history__title">היסטוריית שינויים</div>
      <div><span>תאריך יצירת הגבייה:</span> {formatDateTime(byCreated[0].createdAt)}</div>
      <div><span>מי ביצע את הגבייה:</span> {creators.join(", ") || "—"}</div>
      <div><span>תאריך עדכון אחרון:</span> {edited ? formatDateTime(edited.updatedAt) : "—"}</div>
      <div><span>מי ערך לאחרונה:</span> {edited?.updatedByName ?? "—"}</div>
    </div>
  );
}

export function ShipmentPaymentModal({ record, onClose, onSaved }: Props) {
  const [editing, setEditing] = useState(record.payments.length === 0);
  const [lines, setLines] = useState<DraftLine[]>(
    record.payments.length > 0
      ? record.payments.map(createDraftLine)
      : [createDraftLine()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fee = record.deliveryFeeAmount ?? record.deliveryFeeIls ?? 0;
  const editedTotal = lines.reduce((s, l) => {
    const n = parseFloat(l.amountIls);
    return s + (isNaN(n) ? 0 : n);
  }, 0);
  const displayedPaid = editing ? editedTotal : record.paidAmountIls;
  const liveRemaining = Math.max(0, fee - displayedPaid);
  const wouldExceed = displayedPaid > fee + 0.001;
  const fullyPaid = fee > 0 && !wouldExceed && liveRemaining <= 0.001;
  const displayedStatus =
    displayedPaid <= 0 ? "UNPAID" : fullyPaid ? "PAID" : "PARTIAL";
  const collectionDate = record.payments.length > 0
    ? record.payments[0].createdAt
    : null;
  const paymentMethods = [...new Set(record.payments.map((payment) => payment.methodLabel))];

  function addLine() {
    setLines((prev) => [...prev, createDraftLine()]);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    const validLines = lines
      .map((line) => ({
        id: line.id,
        method: line.method,
        amountIls: parseFloat(line.amountIls),
        details: compactDetails(line),
        notes: line.notes.trim() || undefined,
      }))
      .filter((l) => !isNaN(l.amountIls) && l.amountIls > 0);

    if (lines.length > 0 && validLines.length !== lines.length) {
      setError("יש להזין סכום גדול מאפס בכל שורת תשלום");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await saveShipmentPaymentsAction({
      shipmentRecordId: record.id,
      lines: validLines,
    });

    setSaving(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    onSaved(res.record);
    setLines(res.record.payments.length > 0
      ? res.record.payments.map(createDraftLine)
      : [createDraftLine()]);
    setEditing(false);
  }

  function startEditing() {
    setLines(record.payments.length > 0
      ? record.payments.map(createDraftLine)
      : [createDraftLine()]);
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    if (record.payments.length === 0) {
      onClose();
      return;
    }
    setLines(record.payments.map(createDraftLine));
    setError(null);
    setEditing(false);
  }

  return (
    <div className="shp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="shp-modal shp-modal--payment">
        <div className="shp-modal__header">
          <Banknote size={18} />
          {editing ? "עריכת גבייה" : "פרטי גבייה"} — {record.customerName || "לקוח"}
          <button className="shp-modal__header-close" onClick={onClose} title="סגור">
            <X size={18} />
          </button>
        </div>

        <div className="shp-modal__body">
          {/* Summary */}
          <div className="shp-payment-summary">
            <div className="shp-payment-summary__row">
              <span>דמי משלוח:</span>
              <strong>{fmtIls(fee)}</strong>
            </div>
            <div className="shp-payment-summary__row">
              <span>סכום שנגבה:</span>
              <strong style={{ color: displayedPaid > 0 ? "#15803d" : "#94a3b8" }}>
                {fmtIls(displayedPaid)}
              </strong>
            </div>
            <div className="shp-payment-summary__row">
              <span>יתרה:</span>
              <strong style={{ color: liveRemaining > 0 ? "#dc2626" : "#15803d" }}>{fmtIls(liveRemaining)}</strong>
            </div>
            <div className="shp-payment-summary__row">
              <span>תאריך הגבייה:</span>
              <strong>{collectionDate ? formatDateTime(collectionDate) : "—"}</strong>
            </div>
            <div className="shp-payment-summary__row">
              <span>סטטוס:</span>
              <strong>{SHIPMENT_PAYMENT_STATUS_LABELS[displayedStatus]}</strong>
            </div>
            <div className="shp-payment-summary__row shp-payment-summary__total">
              <span>אמצעי תשלום:</span>
              <strong>{editing
                ? [...new Set(lines.map((line) => PAYMENT_METHODS.find((method) => method.value === line.method)?.label ?? line.method))].join(", ") || "—"
                : paymentMethods.join(", ") || "—"}
              </strong>
            </div>
          </div>

          {/* Existing payments */}
          {!editing && record.payments.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginBottom: 6 }}>
                תשלומים שנרשמו:
              </div>
              <table className="shp-table shp-table--compact" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>אמצעי</th>
                    <th>סכום</th>
                    <th>פרטים מלאים</th>
                  </tr>
                </thead>
                <tbody>
                  {record.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.methodLabel}</td>
                      <td>{fmtIls(p.amountIls)}</td>
                      <td>
                        <div className="shp-payment-detail-summary">{paymentDetailsText(p.details)}</div>
                        {p.notes && <div className="shp-payment-detail-summary">הערה: {p.notes}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {editing && (
            <>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginBottom: 8 }}>
                אמצעי תשלום:
              </div>

              <div className="shp-payment-lines">
                {lines.map((line) => (
                  <div key={line.key} className="shp-payment-line">
                <div className="shp-payment-line__main">
                  <select
                    value={line.method}
                    onChange={(e) => updateLine(line.key, { method: e.target.value as PaymentMethodValue })}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="סכום ₪"
                    value={line.amountIls}
                    onChange={(e) => updateLine(line.key, { amountIls: e.target.value })}
                  />
                  <button
                    className="shp-btn shp-btn--icon"
                    onClick={() => removeLine(line.key)}
                    title="הסר שורה"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {line.method === "BANK_TRANSFER" && (
                  <div className="shp-payment-line__details">
                    <PaymentField label="מספר אסמכתא" value={line.referenceNumber} onChange={(value) => updateLine(line.key, { referenceNumber: value })} />
                    <PaymentField label="שם הבנק (אופציונלי)" value={line.bankName} onChange={(value) => updateLine(line.key, { bankName: value })} />
                    <PaymentField label="תאריך העברה" type="date" value={line.paymentDate} onChange={(value) => updateLine(line.key, { paymentDate: value })} />
                    <NotesField value={line.notes} onChange={(value) => updateLine(line.key, { notes: value })} />
                  </div>
                )}

                {line.method === "CHECK" && (
                  <div className="shp-payment-line__details">
                    <PaymentField label="מספר צ׳ק" value={line.checkNumber} onChange={(value) => updateLine(line.key, { checkNumber: value })} />
                    <PaymentField label="שם הבנק" value={line.bankName} onChange={(value) => updateLine(line.key, { bankName: value })} />
                    <PaymentField label="תאריך פירעון" type="date" value={line.dueDate} onChange={(value) => updateLine(line.key, { dueDate: value })} />
                    <PaymentField label="שם בעל החשבון (אופציונלי)" value={line.accountHolderName} onChange={(value) => updateLine(line.key, { accountHolderName: value })} />
                    <NotesField value={line.notes} onChange={(value) => updateLine(line.key, { notes: value })} />
                  </div>
                )}

                {line.method === "CREDIT" && (
                  <div className="shp-payment-line__details">
                    <PaymentField label="4 ספרות אחרונות" value={line.cardLastFour} maxLength={4} inputMode="numeric" onChange={(value) => updateLine(line.key, { cardLastFour: value.replace(/\D/g, "").slice(0, 4) })} />
                    <PaymentField label="סוג כרטיס" value={line.cardType} onChange={(value) => updateLine(line.key, { cardType: value })} />
                    <PaymentField label="מספר אישור" value={line.approvalNumber} onChange={(value) => updateLine(line.key, { approvalNumber: value })} />
                    <PaymentField label="מספר תשלומים" type="number" min={1} value={line.installments} onChange={(value) => updateLine(line.key, { installments: value })} />
                  </div>
                )}

                {(line.method === "BIT" || line.method === "PAYBOX") && (
                  <div className="shp-payment-line__details">
                    <PaymentField label="מספר אסמכתא" value={line.referenceNumber} onChange={(value) => updateLine(line.key, { referenceNumber: value })} />
                    <NotesField value={line.notes} onChange={(value) => updateLine(line.key, { notes: value })} />
                  </div>
                )}

                {line.method === "OTHER" && (
                  <div className="shp-payment-line__details">
                    <PaymentField label="תיאור" value={line.description} onChange={(value) => updateLine(line.key, { description: value })} />
                    <PaymentField label="אסמכתא" value={line.referenceNumber} onChange={(value) => updateLine(line.key, { referenceNumber: value })} />
                    <NotesField value={line.notes} onChange={(value) => updateLine(line.key, { notes: value })} />
                  </div>
                )}
                  </div>
                ))}
              </div>

              <button className="shp-btn shp-btn--secondary shp-btn--sm" onClick={addLine}>
                <Plus size={14} />
                הוסף אמצעי תשלום
              </button>

              {editedTotal > 0 && (
                <div style={{ marginTop: 10, fontSize: "0.85rem", color: wouldExceed ? "#dc2626" : "#15803d", fontWeight: 600 }}>
                  סה״כ גבייה: {fmtIls(editedTotal)}
                  {wouldExceed && " — חריגה מדמי המשלוח!"}
                </div>
              )}
              {fullyPaid && <div className="shp-payment-complete">✅ שולם במלואו</div>}
            </>
          )}

          {error && <div className="shp-alert shp-alert--error" style={{ marginTop: 10 }}>{error}</div>}

          {!editing && record.payments.length > 0 && <PaymentHistory payments={record.payments} />}
        </div>

        <div className="shp-modal__footer">
          {editing ? (
            <>
              <button
                className="shp-btn shp-btn--success"
                onClick={handleSave}
                disabled={saving || wouldExceed}
              >
                {saving ? <span className="shp-spinner" /> : null}
                שמור שינויים
              </button>
              <button className="shp-btn shp-btn--secondary" onClick={cancelEditing}>
                ביטול
              </button>
            </>
          ) : (
            <>
              <button className="shp-btn shp-btn--primary" onClick={startEditing}>
                <Pencil size={14} />
                ערוך גבייה
              </button>
              <button className="shp-btn shp-btn--secondary" onClick={onClose}>
                סגור
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type PaymentFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "number";
  maxLength?: number;
  min?: number;
  inputMode?: "text" | "numeric";
};

function PaymentField({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
  min,
  inputMode,
}: PaymentFieldProps) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        min={min}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NotesField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="shp-payment-field--wide">
      הערה
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
