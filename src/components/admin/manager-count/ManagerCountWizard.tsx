"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle,
  Coins,
  History,
  Plane,
  X,
} from "lucide-react";
import type {
  FlowWeekOverviewRow,
  FlowWeekPayload,
  FxPurchaseTrack,
  ManagerCountForm,
} from "@/app/admin/cash-flow/flow-types";
import { saveManagerCountAction } from "@/app/admin/cash-flow/save-manager-count-action";
import { getFlowWeekAction } from "@/app/admin/cash-flow/get-flow-week-action";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import {
  computeIlRemainingIls,
  computePsRemainingIls,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { ManagerCountFxPurchaseFlow } from "@/components/admin/manager-count/ManagerCountFxPurchaseFlow";
import {
  computeAutoTurkeyIls,
  computeAutoTurkeyUsd,
  formFromFlow,
  ilSourcePoolFromForm,
  isTurkeyIlManual,
  isTurkeyManual,
  resolveAvailableIlIlsForFx,
  resolveAvailablePsIlsForFx,
  syncAutoTurkey,
} from "@/components/admin/manager-count/manager-count-utils";
import { fcNum } from "@/components/admin/flow-control/shared";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";

type WizardView = "wizard" | "history";
type WizardStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "ספירת קופה",
  2: "רכישת מט\u05f3ח",
  3: "העברה לטורקיה",
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
    turkeyTransferIls: "",
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
  const [turkeyIlManual, setTurkeyIlManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fxTrack, setFxTrack] = useState<FxPurchaseTrack | null>(null);

  const reloadFlow = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFlowWeekAction(week);
      if (data) {
        setFlow(data);
        const nextForm = formFromFlow(data);
        setForm((prev) => {
          let merged = nextForm;
          if (turkeyManual) merged = { ...merged, turkeyTransferUsd: prev.turkeyTransferUsd };
          if (turkeyIlManual) merged = { ...merged, turkeyTransferIls: prev.turkeyTransferIls };
          if (!turkeyManual || !turkeyIlManual) {
            const synced = syncAutoTurkey(merged, data);
            return {
              ...merged,
              turkeyTransferUsd: turkeyManual ? merged.turkeyTransferUsd : synced.turkeyTransferUsd,
              turkeyTransferIls: turkeyIlManual ? merged.turkeyTransferIls : synced.turkeyTransferIls,
            };
          }
          return merged;
        });
        if (!turkeyManual) setTurkeyManual(isTurkeyManual(formFromFlow(data), data));
        if (!turkeyIlManual) setTurkeyIlManual(isTurkeyIlManual(formFromFlow(data), data));
      }
    } finally {
      setLoading(false);
    }
  }, [week, turkeyManual, turkeyIlManual]);

  useEffect(() => {
    if (!open) return;
    setView("wizard");
    setStep(1);
    if (initialFlow) {
      setFlow(initialFlow);
      const f = formFromFlow(initialFlow);
      setForm(syncAutoTurkey(f, initialFlow));
      setTurkeyManual(isTurkeyManual(f, initialFlow));
      setTurkeyIlManual(isTurkeyIlManual(f, initialFlow));
    } else {
      void reloadFlow();
    }
  }, [open, initialFlow, reloadFlow]);

  const fxPs = flow ? sumFxPurchases(flow.fxPurchases, "PS") : { ils: 0, usd: 0 };
  const fxIl = flow ? sumFxPurchases(flow.fxPurchases, "IL") : { ils: 0, usd: 0 };
  const autoTurkeyPs = computeAutoTurkeyUsd(form, fxPs.usd);
  const autoTurkeyIl = computeAutoTurkeyIls(form, fxIl.ils);

  const cashIls = fcNum(form.countedCashIls);
  const cashUsd = fcNum(form.countedCashUsd);
  const transferIls = fcNum(form.countedTransferIls);
  const creditIls = fcNum(form.countedCreditIls);
  const checksIls = fcNum(form.countedChecksIls);
  const commIls = fcNum(form.commissionIls);
  const commUsd = fcNum(form.commissionUsd);
  const ilPool = ilSourcePoolFromForm(form);
  const psTotalIls = cashIls;
  const psRemainingIls = computePsRemainingIls(cashIls, fxPs.ils);
  const ilRemainingIls = computeIlRemainingIls(ilPool, fxIl.ils);
  const turkeyUsd = fcNum(form.turkeyTransferUsd);
  const turkeyIls = fcNum(form.turkeyTransferIls);
  const psUsdAvailable = cashUsd + fxPs.usd + commUsd;
  const psUsdRemaining = Math.max(0, psUsdAvailable - turkeyUsd);
  const availablePs = fcNum(resolveAvailablePsIlsForFx(flow, form));
  const availableIl = fcNum(resolveAvailableIlIlsForFx(flow, form));

  const patch = (key: keyof ManagerCountForm, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (!turkeyManual && (key === "commissionUsd" || key === "countedCashUsd")) {
        const synced = syncAutoTurkey(next, flow);
        return { ...next, turkeyTransferUsd: synced.turkeyTransferUsd };
      }
      if (
        !turkeyIlManual &&
        (key === "commissionIls" ||
          key === "countedTransferIls" ||
          key === "countedCreditIls" ||
          key === "countedChecksIls")
      ) {
        const synced = syncAutoTurkey(next, flow);
        return { ...next, turkeyTransferIls: synced.turkeyTransferIls };
      }
      return next;
    });
  };

  const handleTurkeyPsChange = (value: string) => {
    setTurkeyManual(true);
    setForm((prev) => ({ ...prev, turkeyTransferUsd: value }));
  };

  const handleTurkeyIlChange = (value: string) => {
    setTurkeyIlManual(true);
    setForm((prev) => ({ ...prev, turkeyTransferIls: value }));
  };

  const resetTurkeyPsAuto = () => {
    setTurkeyManual(false);
    setForm((prev) => ({
      ...prev,
      turkeyTransferUsd: autoTurkeyPs > 0 ? autoTurkeyPs.toFixed(2) : "",
    }));
  };

  const resetTurkeyIlAuto = () => {
    setTurkeyIlManual(false);
    setForm((prev) => ({
      ...prev,
      turkeyTransferIls: autoTurkeyIl > 0 ? autoTurkeyIl.toFixed(2) : "",
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let payload = form;
      if (flow) {
        const synced = syncAutoTurkey(form, flow);
        payload = {
          ...form,
          turkeyTransferUsd: turkeyManual ? form.turkeyTransferUsd : synced.turkeyTransferUsd,
          turkeyTransferIls: turkeyIlManual ? form.turkeyTransferIls : synced.turkeyTransferIls,
        };
      }
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
    setFxTrack(null);
    dispatchCashControlRefresh(week);
    await reloadFlow();
    onSaved();
  };

  if (!open) return null;

  const displayWeek = weekLabel ?? week;
  const historyRows = [...overview]
    .filter((r) => r.hasData || r.manager)
    .sort((a, b) => (parseAhWeekNumber(b.week) ?? 0) - (parseAhWeekNumber(a.week) ?? 0));

  const psPurchases = flow?.fxPurchases.filter((p) => p.track !== "IL") ?? [];
  const ilPurchases = flow?.fxPurchases.filter((p) => p.track === "IL") ?? [];

  return (
    <>
      <div className="mcw-backdrop" role="presentation" onClick={onClose}>
        <div
          className="mcw-dialog"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="mcw-head">
            <div>
              <h2>ספירת מנהל</h2>
              <p>
                שבוע <span dir="ltr">{displayWeek}</span> · מסלולי PS ו-IL נפרדים לחלוטין
              </p>
            </div>
            <div className="mcw-head__actions">
              <button
                type="button"
                className="fc-btn fc-btn--ghost"
                onClick={() => setView((v) => (v === "history" ? "wizard" : "history"))}
              >
                <History size={15} />
                {view === "history" ? "חזרה לאשף" : "היסטוריה"}
              </button>
              <button type="button" className="fc-btn fc-btn--icon" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
          </header>

          {view === "history" ? (
            <div className="mcw-body">
              <div className="mcw-count-tbl-wrap">
                <table className="mcw-tbl">
                  <thead>
                    <tr>
                      <th>שבוע</th>
                      <th>מזומן PS ₪</th>
                      <th>מזומן PS $</th>
                      <th>טורקיה PS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((r) => (
                      <tr key={r.week}>
                        <td dir="ltr">{r.weekLabel ?? r.week}</td>
                        <td dir="ltr">{fmt(r.manager?.CASH_ILS, "ILS")}</td>
                        <td dir="ltr">{fmt(r.manager?.CASH_USD, "USD")}</td>
                        <td dir="ltr">{fmt(r.turkeyTransferUsd, "USD")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="mcw-steps" aria-label="שלבים">
                {([1, 2, 3, 4] as WizardStep[]).map((s) => (
                  <div
                    key={s}
                    className={`mcw-step${step === s ? " is-active" : step > s ? " is-done" : ""}`}
                    onClick={() => {
                      if (s < step || step === 4) setStep(s);
                    }}
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
                  {step === 1 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <Banknote size={16} />
                        ספירה בשני מסלולים נפרדים — אין איחוד בין PS ל-IL
                      </p>
                      <div className="mcw-dual-grid">
                        <section className="mcw-track mcw-track--ps">
                          <h3>ספירת PS — מזומן פיזי</h3>
                          <table className="mcw-count-tbl">
                            <tbody>
                              {(
                                [
                                  ["countedCashIls", "מזומן ₪ PS", "ILS"],
                                  ["countedCashUsd", "מזומן $ PS", "USD"],
                                  ["commissionUsd", "עמלות PS $", "USD"],
                                ] as const
                              ).map(([key, label]) => (
                                <tr key={key}>
                                  <td>{label}</td>
                                  <td>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className="mcw-input"
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
                                <td>סה״כ PS ₪</td>
                                <td dir="ltr">{fmtN(psTotalIls, "ILS")}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </section>

                        <section className="mcw-track mcw-track--il">
                          <h3>ספירת IL — מסלול בנקאי</h3>
                          <table className="mcw-count-tbl">
                            <tbody>
                              {(
                                [
                                  ["countedTransferIls", "העברות בנקאיות", "ILS"],
                                  ["countedCreditIls", "אשראי", "ILS"],
                                  ["countedChecksIls", "צ׳קים", "ILS"],
                                  ["commissionIls", "עמלות IL", "ILS"],
                                ] as const
                              ).map(([key, label]) => (
                                <tr key={key}>
                                  <td>{label}</td>
                                  <td>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className="mcw-input"
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
                                <td>סה״כ IL ₪ (ללא עמלות)</td>
                                <td dir="ltr">{fmtN(ilPool, "ILS")}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </section>
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <Coins size={16} />
                        שתי טבלאות רכישה נפרדות — PS ממזומן בלבד, IL מכספי בנק בלבד
                      </p>
                      <div className="mcw-dual-grid">
                        <section className="mcw-track mcw-track--ps">
                          <h3>רכישות מט״ח PS</h3>
                          <div className="mcw-fx-summary">
                            <div className="mcw-fx-stat">
                              <span>זמין PS</span>
                              <strong dir="ltr">{fmtN(availablePs, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>דולרים שנרכשו PS</span>
                              <strong dir="ltr">{fmtN(fxPs.usd, "USD")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>יתרת PS ₪</span>
                              <strong dir="ltr">{fmtN(psRemainingIls, "ILS")}</strong>
                            </div>
                          </div>
                          <FxPurchaseTable rows={psPurchases} />
                          {canEdit && (
                            <button
                              type="button"
                              className="fc-btn fc-btn--primary"
                              onClick={() => setFxTrack("PS")}
                            >
                              רכישת מט״ח PS
                            </button>
                          )}
                        </section>

                        <section className="mcw-track mcw-track--il">
                          <h3>רכישות מט״ח IL</h3>
                          <div className="mcw-fx-summary">
                            <div className="mcw-fx-stat">
                              <span>זמין IL</span>
                              <strong dir="ltr">{fmtN(availableIl, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>דולרים שנרכשו IL</span>
                              <strong dir="ltr">{fmtN(fxIl.usd, "USD")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>יתרת IL ₪</span>
                              <strong dir="ltr">{fmtN(ilRemainingIls, "ILS")}</strong>
                            </div>
                          </div>
                          <FxPurchaseTable rows={ilPurchases} />
                          {canEdit && (
                            <button
                              type="button"
                              className="fc-btn fc-btn--primary"
                              onClick={() => setFxTrack("IL")}
                            >
                              רכישת מט״ח IL
                            </button>
                          )}
                        </section>
                      </div>
                    </div>
                  )}

                  {step === 3 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <Plane size={16} />
                        העברה לטורקיה — חישוב נפרד לכל מסלול
                      </p>
                      <div className="mcw-dual-grid">
                        <section className="mcw-track mcw-track--ps">
                          <h3>העברה לטורקיה — PS</h3>
                          <div className="mcw-decision-kpis">
                            <div className="mcw-decision-kpi">
                              <span>מזומן $ + רכישות PS</span>
                              <strong dir="ltr">{fmtN(cashUsd + fxPs.usd, "USD")}</strong>
                            </div>
                            <div className="mcw-decision-kpi">
                              <span>+ עמלות PS</span>
                              <strong dir="ltr">{fmtN(commUsd, "USD")}</strong>
                            </div>
                            <div className="mcw-decision-kpi mcw-decision-kpi--total">
                              <span>טורקיה PS (אוטומטי)</span>
                              <strong dir="ltr">{fmtN(autoTurkeyPs, "USD")}</strong>
                            </div>
                          </div>
                          <label className="mcw-field mcw-field--turkey">
                            <span>
                              מועבר לטורקיה PS $
                              {turkeyManual ? <em className="mcw-manual-badge">ידני</em> : null}
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="mcw-input mcw-input--lg"
                              value={form.turkeyTransferUsd}
                              disabled={!canEdit || saving}
                              onChange={(e) => handleTurkeyPsChange(e.target.value)}
                            />
                            {canEdit && turkeyManual ? (
                              <button type="button" className="mcw-link-btn" onClick={resetTurkeyPsAuto}>
                                חזרה לאוטומטי ({autoTurkeyPs.toFixed(2)} $)
                              </button>
                            ) : (
                              <p className="mcw-hint">
                                מזומן $ + דולרים שנרכשו PS + עמלות PS
                              </p>
                            )}
                          </label>
                          <div className="mcw-result-card mcw-result-card--israel">
                            <span>נשאר בישראל PS $</span>
                            <strong dir="ltr">{fmtN(psUsdRemaining, "USD")}</strong>
                          </div>
                        </section>

                        <section className="mcw-track mcw-track--il">
                          <h3>העברה לטורקיה — IL</h3>
                          <div className="mcw-decision-kpis">
                            <div className="mcw-decision-kpi">
                              <span>רכישות מט״ח IL ₪</span>
                              <strong dir="ltr">{fmtN(fxIl.ils, "ILS")}</strong>
                            </div>
                            <div className="mcw-decision-kpi">
                              <span>+ עמלות IL</span>
                              <strong dir="ltr">{fmtN(commIls, "ILS")}</strong>
                            </div>
                            <div className="mcw-decision-kpi mcw-decision-kpi--total">
                              <span>טורקיה IL (אוטומטי)</span>
                              <strong dir="ltr">{fmtN(autoTurkeyIl, "ILS")}</strong>
                            </div>
                          </div>
                          <label className="mcw-field mcw-field--turkey">
                            <span>
                              מועבר לטורקיה IL ₪
                              {turkeyIlManual ? <em className="mcw-manual-badge">ידני</em> : null}
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="mcw-input mcw-input--lg"
                              value={form.turkeyTransferIls}
                              disabled={!canEdit || saving}
                              onChange={(e) => handleTurkeyIlChange(e.target.value)}
                            />
                            {canEdit && turkeyIlManual ? (
                              <button type="button" className="mcw-link-btn" onClick={resetTurkeyIlAuto}>
                                חזרה לאוטומטי ({autoTurkeyIl.toFixed(2)} ₪)
                              </button>
                            ) : (
                              <p className="mcw-hint">רכישות מט״ח IL + עמלות IL</p>
                            )}
                          </label>
                          <div className="mcw-result-card">
                            <span>דולרים שנרכשו IL</span>
                            <strong dir="ltr">{fmtN(fxIl.usd, "USD")}</strong>
                          </div>
                        </section>
                      </div>
                    </div>
                  )}

                  {step === 4 && (
                    <div className="mcw-body">
                      <p className="mcw-body__desc">
                        <CheckCircle size={16} />
                        סיכום נפרד לכל מסלול — אשרו ושמרו
                      </p>
                      <div className="mcw-dual-grid">
                        <section className="mcw-track mcw-track--ps">
                          <h3>סיכום PS</h3>
                          <div className="mcw-summary-rows">
                            <SummaryRow label="מזומן ₪" value={fmt(cashIls, "ILS")} />
                            <SummaryRow label="מזומן $" value={fmt(cashUsd, "USD")} highlight />
                            <SummaryRow label="עמלות PS $" value={fmt(commUsd, "USD")} dimmed />
                            <SummaryRow label="רכישת מט״ח PS ₪" value={fmt(fxPs.ils, "ILS")} />
                            <SummaryRow label="דולרים שנרכשו PS" value={fmt(fxPs.usd, "USD")} highlight />
                            <SummaryRow label="יתרת PS ₪" value={fmt(psRemainingIls, "ILS")} bold />
                            <SummaryRow label="העברה לטורקיה PS" value={fmt(turkeyUsd, "USD")} highlight />
                            <SummaryRow label="נשאר בישראל PS $" value={fmt(psUsdRemaining, "USD")} bold />
                          </div>
                        </section>
                        <section className="mcw-track mcw-track--il">
                          <h3>סיכום IL</h3>
                          <div className="mcw-summary-rows">
                            <SummaryRow label="העברות" value={fmt(transferIls, "ILS")} />
                            <SummaryRow label="אשראי" value={fmt(creditIls, "ILS")} />
                            <SummaryRow label="צ׳קים" value={fmt(checksIls, "ILS")} />
                            <SummaryRow label="עמלות IL" value={fmt(commIls, "ILS")} dimmed />
                            <SummaryRow label="סה״כ מאגר IL" value={fmt(ilPool, "ILS")} bold />
                            <SummaryRow label="רכישת מט״ח IL ₪" value={fmt(fxIl.ils, "ILS")} />
                            <SummaryRow label="דולרים שנרכשו IL" value={fmt(fxIl.usd, "USD")} highlight />
                            <SummaryRow label="יתרת IL ₪" value={fmt(ilRemainingIls, "ILS")} bold />
                            <SummaryRow label="העברה לטורקיה IL" value={fmt(turkeyIls, "ILS")} highlight />
                          </div>
                        </section>
                      </div>
                    </div>
                  )}
                </>
              )}

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

      {canEdit && flow && fxTrack ? (
        <ManagerCountFxPurchaseFlow
          open
          week={week}
          weekLabel={weekLabel}
          track={fxTrack}
          availableIls={
            fxTrack === "PS"
              ? resolveAvailablePsIlsForFx(flow, form)
              : resolveAvailableIlIlsForFx(flow, form)
          }
          saving={saving}
          onClose={() => setFxTrack(null)}
          onSaved={() => void handleFxSaved()}
        />
      ) : null}
    </>
  );
}

function FxPurchaseTable({
  rows,
}: {
  rows: { id: string; ilsAmount: number; rate: number; usdReceived: number }[];
}) {
  if (rows.length === 0) {
    return <p className="mcw-muted">אין רכישות במסלול זה</p>;
  }
  return (
    <div className="mcw-fx-purchases">
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
          {rows.map((p, i) => (
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
