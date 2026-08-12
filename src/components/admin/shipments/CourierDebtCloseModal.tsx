"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, X, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { ShipmentCourierDto, ShipmentRecordDto, CourierDebtClosePreview } from "@/app/admin/shipments/types";
import {
  closeCourierDebtsAction,
  previewCourierDebtCloseAction,
} from "@/app/admin/shipments/actions";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";

type Props = {
  couriers: ShipmentCourierDto[];
  records: ShipmentRecordDto[];
  batchIds?: string[];
  onClose: () => void;
  onDone: (message: string) => void;
};

const DEBT_CLOSE_METHODS = [
  { value: "CASH", label: "מזומן" },
  { value: "BANK_TRANSFER", label: "העברה בנקאית" },
  { value: "CREDIT", label: "אשראי" },
  { value: "CHECK", label: "צ׳קים" },
  { value: "CREDIT_NOTE", label: "זיכוי" },
  { value: "CODE_DEDUCTION", label: "משיכה מהקופה" },
] as const;

function fmtIls(n: number) {
  return n.toLocaleString("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  });
}

export function CourierDebtCloseModal({
  couriers,
  records,
  batchIds,
  onClose,
  onDone,
}: Props) {
  const { workCountry } = useShipmentCountry();
  const [courierId, setCourierId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [preview, setPreview] = useState<CourierDebtClosePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSkipDetails, setShowSkipDetails] = useState(false);
  const [showEligibleDetails, setShowEligibleDetails] = useState(false);

  const activeCouriers = useMemo(
    () =>
      couriers
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [couriers],
  );

  const allZoneIds = useMemo(() => {
    if (!courierId) return [];
    const set = new Set<string>();
    for (const r of records) {
      if (r.courierId !== courierId || !r.zoneId) continue;
      set.add(r.zoneId);
    }
    return [...set];
  }, [records, courierId]);

  useEffect(() => {
    setPreview(null);
    setPaymentMethod("");
    setError(null);
    setShowSkipDetails(false);
    setShowEligibleDetails(false);
  }, [courierId]);

  useEffect(() => {
    if (!courierId || allZoneIds.length === 0) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    previewCourierDebtCloseAction(workCountry, { courierId, zoneIds: allZoneIds, batchIds }).then((res) => {
      if (cancelled) return;
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.preview);
    });
    return () => { cancelled = true; };
  }, [courierId, allZoneIds, batchIds, workCountry]);

  async function confirmClose() {
    if (!courierId || allZoneIds.length === 0 || !paymentMethod) return;
    setBusy(true);
    setError(null);
    const res = await closeCourierDebtsAction(workCountry, {
      courierId,
      zoneIds: allZoneIds,
      batchIds,
      paymentMethod,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const methodLabel = DEBT_CLOSE_METHODS.find((m) => m.value === paymentMethod)?.label ?? paymentMethod;
    const msg =
      res.skippedCount > 0
        ? `${res.closedCount} משלוחים נסגרו (${methodLabel}). ${res.skippedCount} דורשים טיפול.`
        : `${res.closedCount} משלוחים נסגרו בהצלחה (${methodLabel}).`;
    onDone(msg);
    onClose();
  }

  const courierName =
    activeCouriers.find((c) => c.id === courierId)?.name ?? "";

  const canClose =
    !busy &&
    !!courierId &&
    !!paymentMethod &&
    !!preview &&
    preview.summary.eligibleCount > 0;

  return (
    <div
      className="shp-modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="shp-modal"
        style={{ maxWidth: 720, width: "96vw" }}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CircleDollarSign size={18} />
            <strong>סגירת חוב לפי שליח</strong>
          </div>
          <button type="button" className="shp-icon-btn" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="shp-modal__body" style={{ display: "grid", gap: 20, padding: "20px 24px", maxHeight: "75vh", overflowY: "auto" }}>
          {/* ── שלב 1: בחירת שליח ── */}
          <label className="sc-expense-field">
            <span style={{ fontWeight: 700 }}>שלב 1 — בחירת שליח</span>
            <select
              value={courierId}
              disabled={busy}
              onChange={(e) => setCourierId(e.target.value)}
              style={{ padding: "10px 12px", fontSize: "0.92rem" }}
            >
              <option value="">בחרו שליח...</option>
              {activeCouriers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          {/* ── שלב 2: בחירת אמצעי תשלום ── */}
          {courierId && (
            <div className="sc-expense-field">
              <span style={{ fontWeight: 700 }}>שלב 2 — צורת סגירת החוב</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                {DEBT_CLOSE_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setPaymentMethod(m.value)}
                    style={{
                      padding: "10px 8px",
                      border: paymentMethod === m.value ? "2px solid #3b82f6" : "1.5px solid #e2e8f0",
                      borderRadius: 8,
                      background: paymentMethod === m.value ? "#eff6ff" : "#fff",
                      color: paymentMethod === m.value ? "#1d4ed8" : "#334155",
                      fontWeight: paymentMethod === m.value ? 700 : 500,
                      fontSize: "0.88rem",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── שלב 3: סיכום ── */}
          {courierId && preview && paymentMethod && (
            <div style={{ border: "2px solid #e2e8f0", borderRadius: 10, padding: "16px 20px", background: "#fafbfd" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", borderBottom: "2px solid #3b82f6", paddingBottom: 8 }}>
                שלב 3 — סיכום
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: "0.9rem" }}>
                <div>
                  <span style={{ color: "#64748b" }}>שליח:</span>{" "}
                  <strong>{courierName}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>צורת סגירה:</span>{" "}
                  <strong>{DEBT_CLOSE_METHODS.find((m) => m.value === paymentMethod)?.label}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>משלוחים לסגירה:</span>{" "}
                  <strong style={{ color: "#15803d" }}>{preview.summary.eligibleCount}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>סכום כולל:</span>{" "}
                  <strong>{fmtIls(preview.summary.eligibleFeeIls)}</strong>
                </div>
                {preview.summary.collectedIls > 0 && (
                  <div>
                    <span style={{ color: "#64748b" }}>כבר נקלט:</span>{" "}
                    <strong>{fmtIls(preview.summary.collectedIls)}</strong>
                  </div>
                )}
                {preview.summary.remainingIls > 0 && (
                  <div>
                    <span style={{ color: "#64748b" }}>נשאר לגבות:</span>{" "}
                    <strong style={{ color: "#b45309" }}>{fmtIls(preview.summary.remainingIls)}</strong>
                  </div>
                )}
              </div>

              {/* ── פירוט משלוחים שייסגרו ── */}
              {preview.eligible.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setShowEligibleDetails(!showEligibleDetails)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, background: "none",
                      border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem",
                      color: "#15803d", padding: 0,
                    }}
                  >
                    {showEligibleDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {preview.eligible.length} משלוחים ייסגרו — לחץ לפירוט
                  </button>
                  {showEligibleDetails && (
                    <div style={{
                      marginTop: 8, border: "1px solid #bbf7d0", borderRadius: 8,
                      background: "#f0fdf4", maxHeight: 200, overflowY: "auto",
                    }}>
                      <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#dcfce7" }}>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>מס׳ אצווה</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>לקוח</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>דמי משלוח</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>שולם</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>יתרה לסגירה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.eligible.map((r) => (
                            <tr key={r.id} style={{ borderTop: "1px solid #bbf7d0" }}>
                              <td style={{ padding: "5px 10px" }}>{r.batchNumber}</td>
                              <td style={{ padding: "5px 10px" }}>{r.customerName || r.customerCode || "—"}</td>
                              <td style={{ padding: "5px 10px" }}>{fmtIls(r.deliveryFeeIls)}</td>
                              <td style={{ padding: "5px 10px" }}>{fmtIls(r.paidAmountIls)}</td>
                              <td style={{ padding: "5px 10px", fontWeight: r.remainingFeeIls > 0 ? 700 : 400, color: r.remainingFeeIls > 0 ? "#b45309" : "#15803d" }}>
                                {r.remainingFeeIls > 0 ? fmtIls(r.remainingFeeIls) : "✓ שולם"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── פירוט משלוחים שלא ייסגרו (דורשים טיפול) ── */}
              {preview.skipped.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setShowSkipDetails(!showSkipDetails)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, width: "100%",
                      background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8,
                      cursor: "pointer", fontWeight: 700, fontSize: "0.88rem",
                      color: "#b45309", padding: "10px 12px", justifyContent: "center",
                    }}
                  >
                    <AlertTriangle size={16} />
                    {preview.skipped.length} משלוחים לא ייסגרו (דורשים טיפול) — לחץ לפירוט
                    {showSkipDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {showSkipDetails && (
                    <div style={{
                      marginTop: 8, border: "1px solid #fed7aa", borderRadius: 8,
                      background: "#fffbeb", maxHeight: 250, overflowY: "auto",
                    }}>
                      <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#fef3c7" }}>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>מס׳ אצווה</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>לקוח</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>דמי משלוח</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>שולם</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>סיבה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.skipped.map((r) => (
                            <tr key={r.id} style={{ borderTop: "1px solid #fed7aa" }}>
                              <td style={{ padding: "5px 10px" }}>{r.batchNumber}</td>
                              <td style={{ padding: "5px 10px" }}>{r.customerName || r.customerCode || "—"}</td>
                              <td style={{ padding: "5px 10px" }}>{fmtIls(r.deliveryFeeIls)}</td>
                              <td style={{ padding: "5px 10px" }}>{fmtIls(r.paidAmountIls)}</td>
                              <td style={{ padding: "5px 10px", fontWeight: 700, color: "#b45309" }}>
                                {r.reasonLabel}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {busy && !preview && courierId && (
            <div style={{ textAlign: "center", color: "#64748b", fontSize: "0.88rem" }}>
              מחשב סיכום...
            </div>
          )}

          {error && <div className="shp-alert shp-alert--error">{error}</div>}
        </div>

        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={!canClose}
            onClick={() => void confirmClose()}
          >
            {busy ? "סוגר..." : (
              <>
                <CheckCircle2 size={14} />
                סגור חוב
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
