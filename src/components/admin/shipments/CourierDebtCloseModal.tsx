"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, X } from "lucide-react";
import type { ShipmentCourierDto, ShipmentRecordDto, CourierDebtClosePreview } from "@/app/admin/shipments/types";
import {
  closeCourierDebtsAction,
  previewCourierDebtCloseAction,
} from "@/app/admin/shipments/actions";
import { looksLikeDistributionArea } from "@/lib/distribution-area-name";

type Props = {
  couriers: ShipmentCourierDto[];
  records: ShipmentRecordDto[];
  /** הגבלה לאצוות נוכחיות (משלוח בודד / מאוחד) */
  batchIds?: string[];
  onClose: () => void;
  onDone: (message: string) => void;
};

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
  const [courierId, setCourierId] = useState("");
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<CourierDebtClosePreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCouriers = useMemo(
    () =>
      couriers
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [couriers],
  );

  const zoneOptions = useMemo(() => {
    if (!courierId) return [];
    const map = new Map<string, string>();
    for (const r of records) {
      if (r.courierId !== courierId || !r.zoneId) continue;
      const label =
        r.zoneName && looksLikeDistributionArea(r.zoneName)
          ? r.zoneName
          : r.zoneName?.trim() || r.zoneId;
      if (!map.has(r.zoneId)) map.set(r.zoneId, label);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [records, courierId]);

  useEffect(() => {
    setZoneIds([]);
    setPreview(null);
    setConfirmOpen(false);
  }, [courierId]);

  function toggleZone(id: string) {
    setZoneIds((prev) =>
      prev.includes(id) ? prev.filter((z) => z !== id) : [...prev, id],
    );
    setPreview(null);
  }

  function toggleAllZones() {
    if (zoneIds.length === zoneOptions.length) setZoneIds([]);
    else setZoneIds(zoneOptions.map((z) => z.id));
    setPreview(null);
  }

  async function loadPreview() {
    if (!courierId || zoneIds.length === 0) {
      setError("יש לבחור שליח ולפחות אזור אחד");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await previewCourierDebtCloseAction({
      courierId,
      zoneIds,
      batchIds,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview(res.preview);
  }

  async function confirmClose() {
    if (!courierId || zoneIds.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await closeCourierDebtsAction({
      courierId,
      zoneIds,
      batchIds,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const msg =
      res.skippedCount > 0
        ? `${res.closedCount} משלוחים נסגרו בהצלחה. ${res.skippedCount} משלוחים לא נסגרו ודורשים טיפול.`
        : `${res.closedCount} משלוחים נסגרו בהצלחה.`;
    onDone(msg);
    onClose();
  }

  const courierName =
    activeCouriers.find((c) => c.id === courierId)?.name ||
    preview?.courierName ||
    "";

  return (
    <>
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

          <div className="shp-modal__body" style={{ display: "grid", gap: 16 }}>
            <label className="sc-expense-field">
              <span>שלב 1 — בחירת שליח</span>
              <select
                value={courierId}
                disabled={busy}
                onChange={(e) => setCourierId(e.target.value)}
              >
                <option value="">בחרו שליח...</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {courierId && (
              <div className="sc-expense-field">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>שלב 2 — אזורי חלוקה של השליח</span>
                  {zoneOptions.length > 0 && (
                    <button
                      type="button"
                      className="shp-btn shp-btn--sm"
                      disabled={busy}
                      onClick={toggleAllZones}
                    >
                      {zoneIds.length === zoneOptions.length ? "נקה הכל" : "בחר הכל"}
                    </button>
                  )}
                </div>
                {zoneOptions.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>
                    לא נמצאו אזורי חלוקה למשלוחים של שליח זה במסך הנוכחי
                  </div>
                ) : (
                  <div className="cdc-zone-list">
                    {zoneOptions.map((z) => (
                      <label key={z.id} className="cdc-zone-item">
                        <input
                          type="checkbox"
                          checked={zoneIds.includes(z.id)}
                          disabled={busy}
                          onChange={() => toggleZone(z.id)}
                        />
                        <span>{z.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {courierId && zoneIds.length > 0 && (
              <div>
                <button
                  type="button"
                  className="shp-btn shp-btn--secondary shp-btn--sm"
                  disabled={busy}
                  onClick={() => void loadPreview()}
                >
                  {busy && !preview ? "מחשב..." : "חשב סיכום"}
                </button>
              </div>
            )}

            {preview && (
              <div className="cdc-summary">
                <h3 style={{ margin: 0, fontSize: "0.95rem" }}>שלב 3 — סיכום</h3>
                <div className="cdc-summary-grid">
                  <div>
                    <span>מספר משלוחים</span>
                    <strong>{preview.summary.shipmentCount}</strong>
                  </div>
                  <div>
                    <span>מספר לקוחות</span>
                    <strong>{preview.summary.customerCount}</strong>
                  </div>
                  <div>
                    <span>סך דמי משלוח</span>
                    <strong>{fmtIls(preview.summary.totalFeeIls)}</strong>
                  </div>
                  <div>
                    <span>כבר נקלט</span>
                    <strong>{fmtIls(preview.summary.collectedIls)}</strong>
                  </div>
                  <div>
                    <span>נשאר לגבות</span>
                    <strong>{fmtIls(preview.summary.remainingIls)}</strong>
                  </div>
                  <div>
                    <span>ניתנים לסגירה</span>
                    <strong style={{ color: "#15803d" }}>
                      {preview.summary.eligibleCount}
                    </strong>
                  </div>
                </div>

                {preview.skipped.length > 0 && (
                  <div className="cdc-skipped">
                    <strong>
                      משלוחים שלא ייסגרו ({preview.skipped.length})
                    </strong>
                    <div className="shp-table-wrap" style={{ maxHeight: 180 }}>
                      <table className="shp-table shp-table--compact">
                        <thead>
                          <tr>
                            <th>משלוח</th>
                            <th>לקוח</th>
                            <th>יתרה</th>
                            <th>סיבה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.skipped.slice(0, 50).map((r) => (
                            <tr key={r.id}>
                              <td>{r.batchNumber}</td>
                              <td>{r.customerName || r.customerCode || "—"}</td>
                              <td>{fmtIls(r.remainingFeeIls)}</td>
                              <td style={{ color: "#b91c1c" }}>{r.reasonLabel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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
              disabled={
                busy || !preview || preview.summary.eligibleCount === 0
              }
              onClick={() => setConfirmOpen(true)}
            >
              <CheckCircle2 size={14} />
              המשך לאישור
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && preview && (
        <div
          className="shp-modal-backdrop"
          style={{ zIndex: 70 }}
          onClick={(e) => e.target === e.currentTarget && !busy && setConfirmOpen(false)}
        >
          <div
            className="shp-modal"
            style={{ maxWidth: 460, width: "92vw" }}
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shp-modal__header">
              <strong>אישור סגירת חובות</strong>
              <button
                type="button"
                className="shp-icon-btn"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="shp-modal__body" style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, lineHeight: 1.5 }}>
                האם לסגור את כל המשלוחים התקינים של השליח{" "}
                <strong>«{courierName}»</strong> באזור{" "}
                <strong>
                  «{preview.zoneNames.join(", ")}»
                </strong>
                ?
              </p>
              <div className="cdc-confirm-stats">
                <div>
                  מספר משלוחים: <strong>{preview.summary.eligibleCount}</strong>
                </div>
                <div>
                  סכום כולל: <strong>{fmtIls(preview.summary.eligibleFeeIls)}</strong>
                </div>
                {preview.summary.skippedCount > 0 && (
                  <div style={{ color: "#b45309" }}>
                    {preview.summary.skippedCount} משלוחים יישארו לטיפול (לא ייסגרו)
                  </div>
                )}
              </div>
            </div>
            <div className="shp-modal__footer">
              <button
                type="button"
                className="shp-btn"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="shp-btn shp-btn--primary"
                disabled={busy}
                onClick={() => void confirmClose()}
              >
                {busy ? "סוגר..." : "סגור חובות"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
