"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Calculator,
  CheckCircle,
  Coins,
  History,
  Plane,
  X,
} from "lucide-react";
import type { FlowWeekOverviewRow, FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { saveManagerCountAction } from "@/app/admin/cash-flow/save-manager-count-action";
import { getFlowWeekAction } from "@/app/admin/cash-flow/get-flow-week-action";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { ManagerCountFxPurchaseFlow } from "@/components/admin/manager-count/ManagerCountFxPurchaseFlow";
import {
  computeAutoTurkeyUsd,
  formFromFlow,
  isTurkeyManual,
  resolveAvailableIlsForFx,
  syncAutoTurkey,
} from "@/components/admin/manager-count/manager-count-utils";
import { fcNum } from "@/components/admin/flow-control/shared";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";

type WizardView = "wizard" | "history";
type WizardStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "ספירת קופה",
  2: "רכישת מט\u05f3ח",
  3: "החלטת מנהל",
  4: "סיכום",
};

export type ManagerCountWizardProps = {
  open: boolean;
  week: string;
  weekLabel: string | null;
  flow: FlowWeekPayload | null;
  overview?: FlowWeekOverviewRow[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
};

function emptyForm(): ManagerCountForm {
  return {
    countedCashUsd: "",
    countedCashIls: "",
    countedChecksIls: "",
    countedCreditIls: "",
    countedTransferIls: "",
    commissionUsd: "",
    commissionIls: "",
    turkeyTransferUsd: "",
  };
}

function fmt(v: string | number | null | undefined, currency: "ILS" | "USD"): string {
  const n = typeof v === "number" ? v : fcNum(String(v ?? "0"));
  return fmtDailyMoney(currency, n);
}

function fmtN(n: number, currency: "ILS" | "USD"): string {
  return fmtDailyMoney(currency, n);
}

export function ManagerCountWizard({
  open,
  week,
  weekLabel,
  flow: initialFlow,
  overview = [],
  canEdit,
  onClose,
  onSaved,
}: ManagerCountWizardProps) {
  const [view, setView] = useState<WizardView>("wizard");
  const [step, setStep] = useState<WizardStep>(1);
  const [flow, setFlow] = useState<FlowWeekPayload | null>(initialFlow);
  const [form, setForm] = useState<ManagerCountForm>(emptyForm());
  const [turkeyManual, setTurkeyManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);

  const reloadFlow = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFlowWeekAction(week);
      if (data) {
        setFlow(data);
        const nextForm = formFromFlow(data);
        setForm((prev) => {
          return turkeyManual
            ? { ...nextForm, turkeyTransferUsd: prev.turkeyTransferUsd }
            : syncAutoTurkey(nextForm, data);
        });
        if (!turkeyManual) setTurkeyManual(isTurkeyManual(formFromFlow(data), data));
      }
    } finally {
      setLoading(false);
    }
  }, [week, turkeyManual]);

  useEffect(() => {
    if (!open) return;
    setView("wizard");
    setStep(1);
    if (initialFlow) {
      setFlow(initialFlow);
      const f = formFromFlow(initialFlow);
      setForm(syncAutoTurkey(f, initialFlow));
      setTurkeyManual(isTurkeyManual(f, initialFlow));
    } else {
      void reloadFlow();
    }
  }, [open, initialFlow, reloadFlow]);

  const fxTotals = flow ? sumFxPurchases(flow.fxPurchases) : { ils: 0, usd: 0 };
  const autoTurkey = computeAutoTurkeyUsd(form, fxTotals.usd);

  // ── Derived values ──────────────────────────────────────────────────
  const cashIls = fcNum(form.countedCashIls);
  const cashUsd = fcNum(form.countedCashUsd);
  const transferIls = fcNum(form.countedTransferIls);
  const creditIls = fcNum(form.countedCreditIls);
  const checksIls = fcNum(form.countedChecksIls);
  const commIls = fcNum(form.commissionIls);
  const commUsd = fcNum(form.commissionUsd);
  const totalCountedIls = cashIls + transferIls + creditIls + checksIls + commIls;
  const totalUsdAvailable = cashUsd + fxTotals.usd - commUsd;
  const turkeyUsd = fcNum(form.turkeyTransferUsd);
  const israelUsd = Math.max(0, totalUsdAvailable - turkeyUsd);
  const israelIls = cashIls + transferIls + creditIls + checksIls;
  const availableForFx = fcNum(resolveAvailableIlsForFx(flow, form));

  // ── Handlers ────────────────────────────────────────────────────────
  const patch = (key: keyof ManagerCountForm, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (!turkeyManual && key === "commissionUsd") {
        return syncAutoTurkey(next, flow);
      }
      return next;
    });
  };

  const handleTurkeyChange = (value: string) => {
    setTurkeyManual(true);
    setForm((prev) => ({ ...prev, turkeyTransferUsd: value }));
  };

  const resetTurkeyAuto = () => {
    setTurkeyManual(false);
    setForm((prev) => ({ ...prev, turkeyTransferUsd: autoTurkey > 0 ? autoTurkey.toFixed(2) : "" }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = turkeyManual || !flow ? form : syncAutoTurkey(form, flow);
      const res = await saveManagerCountAction({ week, form: payload });
      if (!res.ok) {
        alert(res.error ?? "שמירה נכשלה");
        return;
      }
      dispatchCashControlRefresh(week);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleFxSaved = async () => {
    dispatchCashControlRefresh(week);
    await reloadFlow();
    onSaved();
  };

  if (!open) return null;

  const displayWeek = weekLabel ?? week;

  // ── History view ─────────────────────────────────────────────────────
  const historyRows = [...overview]
    .filter((r) => r.hasData || r.manager)
    .sort((a, b) => (parseAhWeekNumber(b.week) ?? 0) - (parseAhWeekNumber(a.week) ?? 0));

  return (
    <>
      <div className="mcw-backdrop" role="presentation" onClick={onClose}>
        <div className="mcw-modal" role="dialog" aria-labelledby="mcw-title" onClick={(e) => e.stopPropagation()}>
          {/* ── Header ─────────────────────────────────────── */}
          <header className="mcw-head">
            <div className="mcw-head__info">
              <h2 id="mcw-title">
                <Calculator size={20} />
                ספירת מנהל
              </h2>
              <span className="mcw-head__week">{displayWeek}</span>
            </div>
            <div className="mcw-head__nav">
              <button
                type="button"
                className={`mcw-tab-btn${view === "wizard" ? " is-active" : ""}`}
                onClick={() => setView("wizard")}
              >
                ספירה
              </button>
              <button
                type="button"
                className={`mcw-tab-btn${view === "history" ? " is-active" : ""}`}
                onClick={() => setView("history")}
              >
                <History size={14} />
                היסטוריה
              </button>
            </div>
            <button type="button" className="fc-btn fc-btn--icon" onClick={onClose} aria-label="סגירה">
              <X size={18} />
            </button>
          </header>

          {/* ── History view ────────────────────────────────── */}
          {view === "history" ? (
            <div className="mcw-history">
              {historyRows.length === 0 ? (
                <p className="mcw-muted">אין ספירות שמורות</p>
              ) : (
                <div className="mcw-tbl-wrap">
                  <table className="mcw-tbl">
                    <thead>
                      <tr>
                        <th>שבוע</th>
                        <th>קופה כוללת</th>
                        <th>נרכש מט&quot;ח</th>
                        <th>הועבר לטורקיה</th>
                        <th>נשאר בישראל</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((r) => {
                        const fxU = fcNum(r.fxPurchaseUsd ?? "0");
                        const commU = fcNum(r.commissionUsd ?? "0");
                        const turkeyU = fcNum(r.turkeyTransferUsd ?? "0");
                        const autoTurkeyU = Math.max(0, Math.round((fxU + commU) * 100) / 100);
                        const israelU = Math.max(0, autoTurkeyU - turkeyU);
                        const drawerIls = fcNum(r.drawerRemainingIls ?? "0");
                        return (
                          <tr key={r.week} className={r.week === week ? "mcw-tbl__row--active" : ""}>
                            <td>
                              <strong>{r.week}</strong>
                              {r.weekLabel ? <span className="mcw-tbl__sub">{r.weekLabel}</span> : null}
                            </td>
                            <td dir="ltr">{fmtN(drawerIls, "ILS")}</td>
                            <td dir="ltr">
                              {fcNum(r.fxPurchaseUsd ?? "0") > 0
                                ? fmtN(fcNum(r.fxPurchaseUsd ?? "0"), "USD")
                                : "—"}
                            </td>
                            <td dir="ltr">
                              {turkeyU > 0 ? <span className="mcw-tbl__turkey">{fmtN(turkeyU, "USD")}</span> : "—"}
                            </td>
                            <td dir="ltr">
                              {israelU > 0 ? fmtN(israelU, "USD") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* ── Wizard view ──────────────────────────────── */
            <>
              {/* Step indicator */}
              <div className="mcw-steps" aria-label="שלבים">
                {([1, 2, 3, 4] as WizardStep[]).map((s) => (
                  <div
                    key={s}
                    className={`mcw-step${step === s ? " is-active" : step > s ? " is-done" : ""}`}
                    onClick={() => { if (s < step || step === 4) setStep(s); }}
                  >
                    <div className="mcw-step__dot">
                      {step > s ? <CheckCircle size={14} /> : <span>{s}</span>}
                    </div>
                    <span className="mcw-step__label">{STEP_LABELS[s]}</span>
                  </div>
                ))}
              </div>

              {loading ? (
                <div className="mcw-body mcw-body--loading">
                  <p className="mcw-muted">טוען נתונים…</p>
                </div>
              ) : (
                <>
                  {/* ── Step 1: Cash Count ──────────────────── */}
                  {step === 1 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <Banknote size={16} />
                        הזינו את הסכום הפועלי בכל אמצעי תשלום
                      </p>
                      <div className="mcw-count-tbl-wrap">
                        <table className="mcw-count-tbl">
                          <thead>
                            <tr>
                              <th>אמצעי תשלום</th>
                              <th>סכום בפועל</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(
                              [
                                ["countedCashIls", "מזומן ₪", "ILS"] as const,
                                ["countedCashUsd", "מזומן $", "USD"] as const,
                                ["countedTransferIls", "העברות בנקאיות ₪", "ILS"] as const,
                                ["countedCreditIls", "אשראי ₪", "ILS"] as const,
                                ["countedChecksIls", "צ\u05f3קים ₪", "ILS"] as const,
                                ["commissionIls", "עמלות ₪", "ILS"] as const,
                                ["commissionUsd", "עמלות $", "USD"] as const,
                              ] as const
                            ).map(([key, label, curr]) => (
                              <tr key={key}>
                                <td className="mcw-count-tbl__method">
                                  <span
                                    className={`mcw-method-badge mcw-method-badge--${curr === "USD" ? "usd" : key.includes("Transfer") ? "transfer" : key.includes("Credit") ? "credit" : key.includes("Check") ? "check" : key.includes("commission") ? "comm" : "cash"}`}
                                  >
                                    {label}
                                  </span>
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="mcw-input"
                                    placeholder="0.00"
                                    value={form[key]}
                                    disabled={!canEdit || saving}
                                    onChange={(e) => patch(key, e.target.value)}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="mcw-count-tbl__total">
                              <td>סה&quot;כ קופה (₪)</td>
                              <td dir="ltr">{fmtN(totalCountedIls, "ILS")}</td>
                            </tr>
                            <tr className="mcw-count-tbl__total">
                              <td>סה&quot;כ דולר בקופה</td>
                              <td dir="ltr">{fmtN(cashUsd, "USD")}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Step 2: FX Purchase ─────────────────── */}
                  {step === 2 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <Coins size={16} />
                        רכישת מט&quot;ח — המרת שקלים לדולרים
                      </p>
                      <div className="mcw-fx-summary">
                        <div className="mcw-fx-stat">
                          <span>שקלים זמינים לרכישה</span>
                          <strong dir="ltr" className="mcw-fx-stat__big">{fmtN(availableForFx, "ILS")}</strong>
                        </div>
                        <div className="mcw-fx-stat">
                          <span>רכישות בוצעו</span>
                          <strong dir="ltr">{flow?.fxPurchases.length ?? 0}</strong>
                        </div>
                        {fxTotals.ils > 0 && (
                          <>
                            <div className="mcw-fx-stat mcw-fx-stat--highlight">
                              <span>סה&quot;כ שקלים שנרכשו</span>
                              <strong dir="ltr">{fmtN(fxTotals.ils, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat mcw-fx-stat--highlight">
                              <span>סה&quot;כ דולר שנרכש</span>
                              <strong dir="ltr">{fmtN(fxTotals.usd, "USD")}</strong>
                            </div>
                          </>
                        )}
                      </div>

                      {flow?.fxPurchases && flow.fxPurchases.length > 0 && (
                        <div className="mcw-fx-purchases">
                          <h4>פירוט רכישות</h4>
                          <table className="mcw-tbl mcw-tbl--compact">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>שקלים</th>
                                <th>שער</th>
                                <th>דולרים</th>
                              </tr>
                            </thead>
                            <tbody>
                              {flow.fxPurchases.map((p, i) => (
                                <tr key={p.id}>
                                  <td>{i + 1}</td>
                                  <td dir="ltr">{fmtDailyMoney("ILS", p.ilsAmount)}</td>
                                  <td dir="ltr">{p.rate.toFixed(4)}</td>
                                  <td dir="ltr">{fmtDailyMoney("USD", p.usdReceived)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {canEdit && (
                        <div className="mcw-fx-action">
                          <button
                            type="button"
                            className="fc-btn fc-btn--primary"
                            onClick={() => setFxOpen(true)}
                          >
                            <Coins size={15} />
                            {fxTotals.ils > 0 ? "רכישה נוספת" : "בצע רכישת מט\u05f3ח"}
                          </button>
                          <p className="mcw-hint">
                            ניתן לדלג על שלב זה אם אין רכישת מט&quot;ח השבוע
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Step 3: Decision ────────────────────── */}
                  {step === 3 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <Plane size={16} />
                        החליטו כמה דולר מועבר לטורקיה וכמה נשאר בישראל
                      </p>

                      <div className="mcw-decision-kpis">
                        <div className="mcw-decision-kpi">
                          <span>דולרים שנרכשו</span>
                          <strong dir="ltr">{fmtN(fxTotals.usd, "USD")}</strong>
                        </div>
                        <div className="mcw-decision-kpi">
                          <span>+ עמלה PS</span>
                          <strong dir="ltr">{fmtN(commUsd, "USD")}</strong>
                        </div>
                        <div className="mcw-decision-kpi mcw-decision-kpi--total">
                          <span>טורקיה PS</span>
                          <strong dir="ltr">{fmtN(autoTurkey, "USD")}</strong>
                        </div>
                      </div>

                      <div className="mcw-decision-fields">
                        <label className="mcw-field mcw-field--turkey">
                          <span>
                            <Plane size={14} />
                            מועבר לטורקיה $
                            {turkeyManual ? <em className="mcw-manual-badge">שונה ידנית</em> : null}
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="mcw-input mcw-input--lg"
                            value={form.turkeyTransferUsd}
                            disabled={!canEdit || saving}
                            onChange={(e) => handleTurkeyChange(e.target.value)}
                          />
                          {canEdit && turkeyManual ? (
                            <button type="button" className="mcw-link-btn" onClick={resetTurkeyAuto}>
                              חזרה לחישוב אוטומטי ({autoTurkey.toFixed(2)} $)
                            </button>
                          ) : (
                            <p className="mcw-hint">
                              חישוב: דולרים שנרכשו + עמלה PS = {autoTurkey.toFixed(2)} $
                            </p>
                          )}
                        </label>

                        <div className="mcw-decision-result">
                          <div className="mcw-result-card mcw-result-card--israel">
                            <span>נשאר בישראל $</span>
                            <strong dir="ltr" className="mcw-result-card__val">
                              {fmtN(israelUsd, "USD")}
                            </strong>
                          </div>
                          <div className="mcw-result-card">
                            <span>נשאר בקופה ₪</span>
                            <strong dir="ltr" className="mcw-result-card__val">
                              {fmtN(israelIls, "ILS")}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Step 4: Summary ─────────────────────── */}
                  {step === 4 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <CheckCircle size={16} />
                        סיכום ספירת המנהל — אשרו ושמרו
                      </p>
                      <div className="mcw-summary-grid">
                        <div className="mcw-summary-section">
                          <h4>ספירת קופה</h4>
                          <div className="mcw-summary-rows">
                            {cashIls > 0 && <SummaryRow label="מזומן ₪" value={fmt(cashIls, "ILS")} />}
                            {cashUsd > 0 && <SummaryRow label="מזומן $" value={fmt(cashUsd, "USD")} highlight />}
                            {transferIls > 0 && <SummaryRow label="העברות ₪" value={fmt(transferIls, "ILS")} />}
                            {creditIls > 0 && <SummaryRow label="אשראי ₪" value={fmt(creditIls, "ILS")} />}
                            {checksIls > 0 && <SummaryRow label="צ\u05f3קים ₪" value={fmt(checksIls, "ILS")} />}
                            {commIls > 0 && <SummaryRow label="עמלות ₪" value={fmt(commIls, "ILS")} dimmed />}
                            {commUsd > 0 && <SummaryRow label="עמלות $" value={fmt(commUsd, "USD")} dimmed />}
                            <SummaryRow label="סה\u05f3כ קופה ₪" value={fmt(totalCountedIls, "ILS")} bold />
                          </div>
                        </div>

                        <div className="mcw-summary-section">
                          <h4>רכישת מט&quot;ח</h4>
                          <div className="mcw-summary-rows">
                            {fxTotals.ils > 0 ? (
                              <>
                                <SummaryRow label="שקלים שנרכשו" value={fmt(fxTotals.ils, "ILS")} />
                                <SummaryRow label="דולר שנרכש" value={fmt(fxTotals.usd, "USD")} highlight />
                              </>
                            ) : (
                              <p className="mcw-muted">לא בוצעה רכישה</p>
                            )}
                          </div>
                        </div>

                        <div className="mcw-summary-section">
                          <h4>העברה לטורקיה</h4>
                          <div className="mcw-summary-rows">
                            <SummaryRow label="$ זמין" value={fmt(totalUsdAvailable, "USD")} />
                            <SummaryRow label="מועבר לטורקיה" value={fmt(turkeyUsd, "USD")} highlight />
                            <SummaryRow label="נשאר בישראל $" value={fmt(israelUsd, "USD")} bold />
                            <SummaryRow label="נשאר בקופה ₪" value={fmt(israelIls, "ILS")} bold />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Navigation footer ─────────────────────── */}
              <footer className="mcw-foot">
                <div className="mcw-foot__left">
                  {step > 1 && (
                    <button
                      type="button"
                      className="fc-btn fc-btn--ghost"
                      onClick={() => setStep((s) => (s - 1) as WizardStep)}
                      disabled={saving || loading}
                    >
                      <ArrowRight size={15} />
                      הקודם
                    </button>
                  )}
                </div>
                <div className="mcw-foot__right">
                  {step < 4 ? (
                    <button
                      type="button"
                      className="fc-btn fc-btn--primary"
                      onClick={() => setStep((s) => (s + 1) as WizardStep)}
                      disabled={saving || loading}
                    >
                      הבא
                      <ArrowLeft size={15} />
                    </button>
                  ) : (
                    canEdit && (
                      <button
                        type="button"
                        className="fc-btn fc-btn--primary"
                        disabled={saving || loading}
                        onClick={() => void handleSave()}
                      >
                        {saving ? "שומר…" : "שמור ספירה"}
                      </button>
                    )
                  )}
                  {step === 4 && (
                    <button
                      type="button"
                      className="fc-btn fc-btn--ghost"
                      onClick={onClose}
                      disabled={saving}
                    >
                      סגור
                    </button>
                  )}
                </div>
              </footer>
            </>
          )}
        </div>
      </div>

      {canEdit && flow ? (
        <ManagerCountFxPurchaseFlow
          open={fxOpen}
          week={week}
          weekLabel={weekLabel}
          availableIls={resolveAvailableIlsForFx(flow, form)}
          saving={saving}
          onClose={() => setFxOpen(false)}
          onSaved={() => void handleFxSaved()}
        />
      ) : null}
    </>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  highlight,
  dimmed,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`mcw-summary-row${bold ? " mcw-summary-row--bold" : ""}${highlight ? " mcw-summary-row--highlight" : ""}${dimmed ? " mcw-summary-row--dimmed" : ""}`}
    >
      <span>{label}</span>
      <strong dir="ltr">{value}</strong>
    </div>
  );
}

export default ManagerCountWizard;
