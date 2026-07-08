"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Wallet, X } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import {
  getCashWeekFlowAction,
  saveCashWeekFlowAction,
  type CashWeekFlowPayload,
} from "@/app/admin/cash-control/week-flow-actions";
import {
  listCashReconciliationDetailAction,
  setPaymentCashAuditReviewAction,
  type CashReconciliationDetailRow,
} from "@/app/admin/cash-control/actions";
import { CashControlDailyClient } from "@/components/admin/CashControlDailyClient";
import {
  CASH_WEEK_FLOW_LINES,
  fmtWeekFlowAmount,
  type CashWeekFlowLineId,
} from "@/lib/cash-control-week-flow";
import type { CashReconciliationLineId } from "@/lib/cash-control-reconciliation";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 52 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function FlowArrow() {
  return (
    <div className="cash-flow__arrow" aria-hidden>
      <ChevronDown size={22} />
    </div>
  );
}

function fmtDisplay(currency: "ILS" | "USD", value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return fmtWeekFlowAmount(currency, num(value));
}

function diffTone(diff: string | null | undefined): "ok" | "short" | "excess" | "none" {
  if (diff == null) return "none";
  const n = num(diff);
  if (Math.abs(n) < 0.005) return "ok";
  return n < 0 ? "short" : "excess";
}

export function CashControlShell({ isAdmin, initialWeek }: { isAdmin: boolean; initialWeek: string }) {
  const [view, setView] = useState<"week" | "daily">("week");
  return (
    <div className="cash-control-shell">
      <div className="cash-control-shell__tabs" role="tablist" aria-label="תצוגת בקרת קופה">
        <button
          type="button"
          role="tab"
          aria-selected={view === "week"}
          className={view === "week" ? "is-active" : ""}
          onClick={() => setView("week")}
        >
          שבועי
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "daily"}
          className={view === "daily" ? "is-active" : ""}
          onClick={() => setView("daily")}
        >
          יומי
        </button>
      </div>
      {view === "week" ? (
        <CashControlWeekFlowClient isAdmin={isAdmin} initialWeek={initialWeek} />
      ) : (
        <CashControlDailyClient isAdmin={isAdmin} initialWeek={initialWeek} />
      )}
    </div>
  );
}

function CashControlWeekFlowClient({ isAdmin, initialWeek }: { isAdmin: boolean; initialWeek: string }) {
  const { openWindow } = useAdminWindows();
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState(initialWeek || weekOptions[0]);
  const [payload, setPayload] = useState<CashWeekFlowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [drillLine, setDrillLine] = useState<CashWeekFlowLineId | null>(null);
  const [drillRows, setDrillRows] = useState<CashReconciliationDetailRow[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDraft({});
    setDrillLine(null);
    setDrillRows(null);
    void getCashWeekFlowAction(week).then((data) => {
      if (cancelled) return;
      setPayload(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [week, refreshTick]);

  useEffect(() => {
    const onPaymentSaved = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      const savedWeek = detail?.weekCode?.trim();
      if (!savedWeek || savedWeek === week) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onPaymentSaved);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onPaymentSaved);
  }, [week, refresh]);

  const draftVal = (key: string, server: string | null | undefined): string => {
    if (draft[key] !== undefined) return draft[key];
    return server != null ? server : "";
  };

  const saveFlow = useCallback(
    async (patch: Omit<Parameters<typeof saveCashWeekFlowAction>[0], "week">) => {
      if (!isAdmin) return;
      setSaving(true);
      try {
        const res = await saveCashWeekFlowAction({ ...patch, week });
        if (!res.ok) alert(res.error ?? "שמירה נכשלה");
        else refresh();
      } finally {
        setSaving(false);
      }
    },
    [isAdmin, refresh, week],
  );

  const saveCounted = useCallback(async () => {
    const counted: Partial<Record<CashWeekFlowLineId, string | null>> = {};
    for (const line of CASH_WEEK_FLOW_LINES) {
      const key = `counted:${line.id}`;
      const raw = draftVal(key, payload?.counted[line.id] ?? null).trim();
      counted[line.id] = raw === "" ? null : raw;
    }
    await saveFlow({ counted });
    setDraft((prev) => {
      const next = { ...prev };
      for (const line of CASH_WEEK_FLOW_LINES) delete next[`counted:${line.id}`];
      return next;
    });
  }, [draft, payload, saveFlow]);

  const openDrill = useCallback(
    async (lineId: CashWeekFlowLineId) => {
      const rec = payload?.received[lineId];
      if (!rec || num(rec.amount) <= 0) return;
      if (drillLine === lineId) {
        setDrillLine(null);
        setDrillRows(null);
        return;
      }
      setDrillLine(lineId);
      setDrillRows(null);
      setDrillLoading(true);
      try {
        const rows = await listCashReconciliationDetailAction(week, lineId as CashReconciliationLineId);
        setDrillRows(rows);
      } finally {
        setDrillLoading(false);
      }
    },
    [drillLine, payload, week],
  );

  const toggleReviewed = useCallback(
    async (paymentId: string, reviewed: boolean) => {
      setReviewBusy(paymentId);
      setDrillRows((prev) => prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed } : r)) ?? prev);
      try {
        const res = await setPaymentCashAuditReviewAction({ paymentId, week, reviewed });
        if (!res.ok) {
          setDrillRows((prev) =>
            prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed: !reviewed } : r)) ?? prev,
          );
        }
      } finally {
        setReviewBusy(null);
      }
    },
    [week],
  );

  return (
    <div className="cash-flow">
      <header className="cash-flow__head">
        <div className="cash-flow__title-wrap">
          <Wallet size={22} aria-hidden />
          <h1 className="cash-flow__title">בקרת קופה</h1>
        </div>
        <div className="cash-flow__week">
          <label htmlFor="cash-flow-week">שבוע</label>
          <select id="cash-flow-week" value={week} onChange={(e) => setWeek(e.target.value)}>
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <p className="cash-flow__loading">טוען…</p>
      ) : payload ? (
        <div className="cash-flow__stack">
          <section className="cash-flow__card">
            <h2 className="cash-flow__week-code">{payload.week}</h2>
            {payload.weekLabel ? <p className="cash-flow__week-label">{payload.weekLabel}</p> : null}
          </section>

          <section className="cash-flow__card">
            <h3 className="cash-flow__section-title">כספים שהתקבלו</h3>
            <ul className="cash-flow__lines">
              {CASH_WEEK_FLOW_LINES.map((line) => {
                const rec = payload.received[line.id];
                const amount = rec?.amount ?? "0.00";
                const clickable = num(amount) > 0;
                const active = drillLine === line.id;
                return (
                  <li key={line.id} className="cash-flow__line">
                    <span className="cash-flow__line-label">{line.label}</span>
                    {clickable ? (
                      <button
                        type="button"
                        className={`cash-flow__amount-btn${active ? " is-active" : ""}`}
                        onClick={() => void openDrill(line.id)}
                        aria-expanded={active}
                      >
                        {fmtDisplay(line.currency, amount)}
                      </button>
                    ) : (
                      <span className="cash-flow__amount">{fmtDisplay(line.currency, amount)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {drillLine ? (
            <section className="cash-flow__detail">
              <div className="cash-flow__detail-head">
                <h4>
                  פירוט {CASH_WEEK_FLOW_LINES.find((l) => l.id === drillLine)?.label} — {payload.week}
                </h4>
                <button type="button" onClick={() => setDrillLine(null)} aria-label="סגור">
                  <X size={16} />
                </button>
              </div>
              {drillLoading ? (
                <p className="cash-flow__detail-loading">טוען…</p>
              ) : (
                <div className="cash-flow__detail-scroll">
                  <table className="adm-table-excel cash-flow__detail-tbl">
                    <thead>
                      <tr>
                        <th>שעה</th>
                        <th>מספר קליטה</th>
                        <th>הזמנה</th>
                        <th>לקוח</th>
                        <th>עובד</th>
                        <th>סכום</th>
                        <th>נבדק</th>
                        <th>פעולה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(drillRows ?? []).map((r) => {
                        const cur = drillLine === "CASH_USD" ? "USD" : "ILS";
                        return (
                          <tr key={r.paymentId} className={r.reviewed ? "is-reviewed" : ""}>
                            <td dir="ltr">{r.timeHm}</td>
                            <td dir="ltr">{r.paymentCode ?? "—"}</td>
                            <td dir="ltr">{r.orderNumber ?? "—"}</td>
                            <td>{r.customerName ?? "—"}</td>
                            <td>{r.recordedByName ?? "—"}</td>
                            <td dir="ltr">{fmtWeekFlowAmount(cur, num(r.amount))}</td>
                            <td>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={r.reviewed}
                                  disabled={reviewBusy === r.paymentId}
                                  onChange={(e) => void toggleReviewed(r.paymentId, e.target.checked)}
                                />
                                {r.reviewed ? "☑" : "☐"}
                              </label>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="cash-flow__open-btn"
                                onClick={() => openWindow({ type: "paymentsUpdated", props: { paymentId: r.paymentId } })}
                              >
                                <ExternalLink size={13} /> פתח
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          <FlowArrow />

          <section className="cash-flow__card">
            <h3 className="cash-flow__section-title">ספירת קופה</h3>
            <ul className="cash-flow__lines cash-flow__lines--editable">
              {CASH_WEEK_FLOW_LINES.map((line) => {
                const key = `counted:${line.id}`;
                const diff = payload.countDiff[line.id];
                const tone = diffTone(diff);
                return (
                  <li key={line.id} className="cash-flow__line">
                    <span className="cash-flow__line-label">{line.label}</span>
                    {isAdmin ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="cash-flow__input"
                        value={draftVal(key, payload.counted[line.id] ?? null)}
                        disabled={saving}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        onBlur={() => void saveCounted()}
                        placeholder="0"
                      />
                    ) : (
                      <span className="cash-flow__amount">{fmtDisplay(line.currency, payload.counted[line.id])}</span>
                    )}
                    {diff != null ? (
                      <span className={`cash-flow__diff is-${tone}`} title="הפרש מול נקלט">
                        {tone === "ok" ? "✓" : fmtWeekFlowAmount(line.currency, num(diff))}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {(num(payload.expensesIls) > 0 || num(payload.expensesUsd) > 0) && (
              <p className="cash-flow__hint">
                הוצאות קופה: {fmtDisplay("ILS", payload.expensesIls)} · {fmtDisplay("USD", payload.expensesUsd)}
              </p>
            )}
          </section>

          <FlowArrow />

          <section className="cash-flow__card">
            <h3 className="cash-flow__section-title">רכישת מט&quot;ח</h3>
            <div className="cash-flow__pair">
              <label>
                <span>₪ שולם</span>
                {isAdmin ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cash-flow__input"
                    value={draftVal("fxPurchaseIls", payload.fxPurchaseIls)}
                    disabled={saving}
                    onChange={(e) => setDraft((prev) => ({ ...prev, fxPurchaseIls: e.target.value }))}
                    onBlur={() =>
                      void saveFlow({
                        fxPurchaseIls: draftVal("fxPurchaseIls", payload.fxPurchaseIls).trim() || null,
                        fxPurchaseUsd: draftVal("fxPurchaseUsd", payload.fxPurchaseUsd).trim() || null,
                      })
                    }
                  />
                ) : (
                  <span>{fmtDisplay("ILS", payload.fxPurchaseIls)}</span>
                )}
              </label>
              <label>
                <span>$ התקבל</span>
                {isAdmin ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cash-flow__input"
                    value={draftVal("fxPurchaseUsd", payload.fxPurchaseUsd)}
                    disabled={saving}
                    onChange={(e) => setDraft((prev) => ({ ...prev, fxPurchaseUsd: e.target.value }))}
                    onBlur={() =>
                      void saveFlow({
                        fxPurchaseIls: draftVal("fxPurchaseIls", payload.fxPurchaseIls).trim() || null,
                        fxPurchaseUsd: draftVal("fxPurchaseUsd", payload.fxPurchaseUsd).trim() || null,
                      })
                    }
                  />
                ) : (
                  <span>{fmtDisplay("USD", payload.fxPurchaseUsd)}</span>
                )}
              </label>
            </div>
          </section>

          <FlowArrow />

          <section className="cash-flow__card">
            <h3 className="cash-flow__section-title">העברה לטורקיה</h3>
            <label className="cash-flow__single">
              <span>$ סכום</span>
              {isAdmin ? (
                <input
                  type="text"
                  inputMode="decimal"
                  className="cash-flow__input"
                  value={draftVal("turkeyTransferUsd", payload.turkeyTransferUsd)}
                  disabled={saving}
                  onChange={(e) => setDraft((prev) => ({ ...prev, turkeyTransferUsd: e.target.value }))}
                  onBlur={() =>
                    void saveFlow({
                      turkeyTransferUsd: draftVal("turkeyTransferUsd", payload.turkeyTransferUsd).trim() || null,
                    })
                  }
                />
              ) : (
                <span>{fmtDisplay("USD", payload.turkeyTransferUsd)}</span>
              )}
            </label>
          </section>

          <FlowArrow />

          <section className="cash-flow__card">
            <h3 className="cash-flow__section-title">יתרה בבנק</h3>
            <div className="cash-flow__pair">
              <label>
                <span>₪</span>
                {isAdmin ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cash-flow__input"
                    value={draftVal("bankBalanceIls", payload.bankBalanceIls)}
                    disabled={saving}
                    onChange={(e) => setDraft((prev) => ({ ...prev, bankBalanceIls: e.target.value }))}
                    onBlur={() =>
                      void saveFlow({
                        bankBalanceIls: draftVal("bankBalanceIls", payload.bankBalanceIls).trim() || null,
                        bankBalanceUsd: draftVal("bankBalanceUsd", payload.bankBalanceUsd).trim() || null,
                      })
                    }
                  />
                ) : (
                  <span>{fmtDisplay("ILS", payload.bankBalanceIls)}</span>
                )}
              </label>
              <label>
                <span>$</span>
                {isAdmin ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cash-flow__input"
                    value={draftVal("bankBalanceUsd", payload.bankBalanceUsd)}
                    disabled={saving}
                    onChange={(e) => setDraft((prev) => ({ ...prev, bankBalanceUsd: e.target.value }))}
                    onBlur={() =>
                      void saveFlow({
                        bankBalanceIls: draftVal("bankBalanceIls", payload.bankBalanceIls).trim() || null,
                        bankBalanceUsd: draftVal("bankBalanceUsd", payload.bankBalanceUsd).trim() || null,
                      })
                    }
                  />
                ) : (
                  <span>{fmtDisplay("USD", payload.bankBalanceUsd)}</span>
                )}
              </label>
            </div>
          </section>

          <FlowArrow />

          <section className="cash-flow__card cash-flow__card--result">
            <h3 className="cash-flow__section-title">יתרה שנשארה בקופה</h3>
            <div className="cash-flow__remaining">
              <div>
                <span className="cash-flow__remaining-lbl">₪ מזומן</span>
                <strong>{fmtDisplay("ILS", payload.drawerRemainingIls)}</strong>
              </div>
              <div>
                <span className="cash-flow__remaining-lbl">$ מזומן</span>
                <strong>{fmtDisplay("USD", payload.drawerRemainingUsd)}</strong>
              </div>
            </div>
            <p className="cash-flow__formula">
              ₪ = ספירה − הוצאות − רכישת מט&quot;ח · $ = ספירה + מט&quot;ח − העברה לטורקיה − הוצאות
            </p>
          </section>
        </div>
      ) : (
        <p className="cash-flow__loading">לא ניתן לטעון את השבוע</p>
      )}
    </div>
  );
}

export { CashControlWeekFlowClient };
