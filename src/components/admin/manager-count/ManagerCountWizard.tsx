"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Coins,
  History,
  Plane,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  FlowWeekOverviewRow,
  FlowWeekPayload,
  FxPurchaseRecord,
  FxPurchaseTrack,
  ManagerCountForm,
} from "@/app/admin/cash-flow/flow-types";
import { saveManagerCountAction } from "@/app/admin/cash-flow/save-manager-count-action";
import { getFlowWeekAction } from "@/app/admin/cash-flow/get-flow-week-action";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import {
  computeTurkeyIlRemainingIls,
  computeTurkeyIlTotalOutIls,
  computeTurkeyPsRemainingUsd,
  computeTurkeyPsTotalOutUsd,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { ManagerCountFxPurchaseFlow } from "@/components/admin/manager-count/ManagerCountFxPurchaseFlow";
import { ManagerCountLineField } from "@/components/admin/manager-count/ManagerCountLineField";
import {
  computeAutoTurkeyIls,
  computeAutoTurkeyUsd,
  formFromFlow,
  hasSavedManagerCount,
  ilSourcePoolFromForm,
  initializeManagerCountForm,
  isTurkeyIlManual,
  isTurkeyManual,
  resolveAvailableIlIlsForFx,
  resolveAvailablePsIlsForFx,
  syncAutoTurkey,
} from "@/components/admin/manager-count/manager-count-utils";
import {
  expectedAmountsFromIntake,
  formatWeekRangeLabel,
  managerCountLineStatus,
  sumExpectedByRoute,
} from "@/lib/flow-control/services/manager-count-expected-service";
import { fcNum } from "@/components/admin/flow-control/shared";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";

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
  /** רענון נתונים ברקע — לא סוגר את האשף */
  onRefresh?: () => void;
  /** סגירה לאחר שמירה סופית בשלב 4 */
  onSaved: () => void;
};

const COUNT_FORM_KEYS: (keyof ManagerCountForm)[] = [
  "countedCashIls",
  "countedCashUsd",
  "countedTransferIls",
  "countedCreditIls",
  "countedChecksIls",
];

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

function roundSummary(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ManagerCountWizard({
  open,
  week,
  weekLabel,
  flow: initialFlow,
  overview = [],
  canEdit,
  onClose,
  onRefresh,
  onSaved,
}: ManagerCountWizardProps) {
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
  const prevOpenRef = useRef(false);
  const turkeyManualRef = useRef(false);
  const turkeyIlManualRef = useRef(false);
  const touchedCountFieldsRef = useRef<Set<string>>(new Set());
  const expectedSnapshotRef = useRef<Partial<Record<CashWeekFlowLineId, number>>>({});
  const [view, setView] = useState<WizardView>("wizard");
  const [step, setStep] = useState<WizardStep>(1);
  const [flow, setFlow] = useState<FlowWeekPayload | null>(initialFlow);
  const [form, setForm] = useState<ManagerCountForm>(emptyForm());
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [turkeyManual, setTurkeyManual] = useState(false);
  const [turkeyIlManual, setTurkeyIlManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fxTrack, setFxTrack] = useState<FxPurchaseTrack | null>(null);
  const [fxEditPurchase, setFxEditPurchase] = useState<FxPurchaseRecord | null>(null);

  useEffect(() => {
    turkeyManualRef.current = turkeyManual;
  }, [turkeyManual]);

  useEffect(() => {
    turkeyIlManualRef.current = turkeyIlManual;
  }, [turkeyIlManual]);

  const mergeFormFromFlow = useCallback(
    (data: FlowWeekPayload, prev: ManagerCountForm, opts?: { preserveCounted?: boolean }): ManagerCountForm => {
      const saved = formFromFlow(data);
      const init = initializeManagerCountForm(data);
      let merged = opts?.preserveCounted ? { ...prev } : { ...init };
      if (opts?.preserveCounted) {
        for (const key of COUNT_FORM_KEYS) {
          if (!touchedCountFieldsRef.current.has(key)) {
            merged[key] = hasSavedManagerCount(data.counted) ? saved[key] : init[key];
          }
        }
        merged.commissionUsd = saved.commissionUsd;
        merged.commissionIls = saved.commissionIls;
      }
      if (turkeyManualRef.current) merged = { ...merged, turkeyTransferUsd: prev.turkeyTransferUsd };
      if (turkeyIlManualRef.current) merged = { ...merged, turkeyTransferIls: prev.turkeyTransferIls };
      if (!turkeyManualRef.current || !turkeyIlManualRef.current) {
        const synced = syncAutoTurkey(merged, data);
        return {
          ...merged,
          turkeyTransferUsd: turkeyManualRef.current
            ? merged.turkeyTransferUsd
            : synced.turkeyTransferUsd,
          turkeyTransferIls: turkeyIlManualRef.current
            ? merged.turkeyTransferIls
            : synced.turkeyTransferIls,
        };
      }
      return merged;
    },
    [],
  );

  const snapshotExpected = useCallback((data: FlowWeekPayload | null): Partial<Record<CashWeekFlowLineId, number>> => {
    if (!data) return {};
    return expectedAmountsFromIntake(data.weekPaymentIntake);
  }, []);

  const applyFlowData = useCallback(
    (data: FlowWeekPayload, opts?: { preserveCounted?: boolean }) => {
      const prevExpected = expectedSnapshotRef.current;
      const nextExpected = snapshotExpected(data);
      let expectedChanged = false;
      for (const key of Object.keys(nextExpected) as CashWeekFlowLineId[]) {
        const prev = prevExpected[key] ?? 0;
        const next = nextExpected[key] ?? 0;
        if (Math.abs(prev - next) > 0.02) {
          expectedChanged = true;
          break;
        }
      }
      if (expectedChanged && touchedCountFieldsRef.current.size > 0) {
        setRefreshNotice("הצפוי עודכן מקליטות תשלום — הספירה שלך לא שונתה.");
      } else if (!expectedChanged) {
        setRefreshNotice(null);
      }
      expectedSnapshotRef.current = nextExpected;
      setFlow(data);
      setForm((prev) => mergeFormFromFlow(data, prev, opts));
      if (!turkeyManualRef.current) setTurkeyManual(isTurkeyManual(formFromFlow(data), data));
      if (!turkeyIlManualRef.current) setTurkeyIlManual(isTurkeyIlManual(formFromFlow(data), data));
    },
    [mergeFormFromFlow, snapshotExpected],
  );

  const reloadFlow = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFlowWeekAction(week, workCountry);
      if (data) applyFlowData(data, { preserveCounted: true });
    } finally {
      setLoading(false);
    }
  }, [week, workCountry, applyFlowData]);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setView("wizard");
      setStep(1);
      setFxTrack(null);
      setFxEditPurchase(null);
      setRefreshNotice(null);
      touchedCountFieldsRef.current = new Set();
      if (initialFlow) {
        expectedSnapshotRef.current = snapshotExpected(initialFlow);
        applyFlowData(initialFlow);
        const f = initializeManagerCountForm(initialFlow);
        setForm(syncAutoTurkey(f, initialFlow));
        setTurkeyManual(isTurkeyManual(f, initialFlow));
        setTurkeyIlManual(isTurkeyIlManual(f, initialFlow));
      } else {
        void reloadFlow();
      }
    }
    prevOpenRef.current = open;
  }, [open, initialFlow, reloadFlow, applyFlowData, snapshotExpected]);

  useEffect(() => {
    if (!open || !initialFlow) return;
    applyFlowData(initialFlow, { preserveCounted: true });
  }, [open, initialFlow, applyFlowData]);

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
  const turkeyUsd = fcNum(form.turkeyTransferUsd);
  const turkeyIls = fcNum(form.turkeyTransferIls);
  const psUsdAvailable = cashUsd + fxPs.usd;
  const psUsdTotalOut = computeTurkeyPsTotalOutUsd(turkeyUsd, commUsd);
  const psUsdRemaining = computeTurkeyPsRemainingUsd(psUsdAvailable, turkeyUsd, commUsd);
  const availablePs = fcNum(resolveAvailablePsIlsForFx(flow, form));
  const availableIl = fcNum(resolveAvailableIlIlsForFx(flow, form));
  const psBeforeFxIls = cashIls;
  const ilBeforeFxIls = ilPool;
  const psRemainingIls = availablePs;
  const ilFxRemainingIls = availableIl;
  const ilAvailableIls = fxIl.ils;
  const ilTotalOut = computeTurkeyIlTotalOutIls(turkeyIls, commIls);
  const ilTurkeyRemainingIls = computeTurkeyIlRemainingIls(ilAvailableIls, turkeyIls, commIls);

  const patch = (key: keyof ManagerCountForm, value: string) => {
    if (COUNT_FORM_KEYS.includes(key)) {
      touchedCountFieldsRef.current.add(key);
    }
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "commissionUsd" || key === "commissionIls") {
        return next;
      }
      if (!turkeyManual && key === "countedCashUsd") {
        const synced = syncAutoTurkey(next, flow);
        return { ...next, turkeyTransferUsd: synced.turkeyTransferUsd };
      }
      if (
        !turkeyIlManual &&
        (key === "countedTransferIls" || key === "countedCreditIls" || key === "countedChecksIls")
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

  const currentManagerCountPayload = (): ManagerCountForm => {
    if (!flow) return form;
    const synced = syncAutoTurkey(form, flow);
    return {
      ...form,
      turkeyTransferUsd: turkeyManual ? form.turkeyTransferUsd : synced.turkeyTransferUsd,
      turkeyTransferIls: turkeyIlManual ? form.turkeyTransferIls : synced.turkeyTransferIls,
    };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveManagerCountAction({
        week,
        form: currentManagerCountPayload(),
        workCountry,
      });
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

  const openFxPurchase = async (track: FxPurchaseTrack, editPurchase?: FxPurchaseRecord | null) => {
    setSaving(true);
    try {
      const saveResult = await saveManagerCountAction({
        week,
        form: currentManagerCountPayload(),
        workCountry,
      });
      if (!saveResult.ok) {
        alert(saveResult.error ?? "יש לשמור את ספירת הקופה לפני רכישת מט״ח");
        return;
      }
      const refreshed = await getFlowWeekAction(week);
      if (!refreshed) return;
      setFlow(refreshed);
      setForm((prev) => mergeFormFromFlow(refreshed, prev));
      setFxTrack(track);
      setFxEditPurchase(editPurchase ?? null);
    } finally {
      setSaving(false);
    }
  };

  const handleFxSaved = async () => {
    setFxTrack(null);
    setFxEditPurchase(null);
    await reloadFlow();
    onRefresh?.();
    dispatchCashControlRefresh(week);
  };

  if (!open) return null;

  const displayWeek = weekLabel ?? week;
  const historyRows = [...overview]
    .filter((r) => r.hasData || r.manager)
    .sort((a, b) => (parseAhWeekNumber(b.week) ?? 0) - (parseAhWeekNumber(a.week) ?? 0));

  const psPurchases = flow?.fxPurchases.filter((p) => p.track !== "IL") ?? [];
  const ilPurchases = flow?.fxPurchases.filter((p) => p.track === "IL") ?? [];
  const expectedLines = flow?.managerCountExpected ?? [];
  const psLines = expectedLines.filter((l) => l.route === "PS");
  const ilLines = expectedLines.filter((l) => l.route === "IL");
  const weekRange = getAhWeekRange(week);
  const weekRangeLabel = weekRange
    ? formatWeekRangeLabel(weekRange.from, weekRange.to)
    : null;
  const expectedPsIls = sumExpectedByRoute(expectedLines, "PS", "ILS");
  const expectedPsUsd = sumExpectedByRoute(expectedLines, "PS", "USD");
  const expectedIlIls = sumExpectedByRoute(expectedLines, "IL", "ILS");
  const totalExpectedIls = roundSummary(expectedPsIls + expectedIlIls);
  const totalCountedIls = roundSummary(cashIls + ilPool);
  const summaryIlsStatus = managerCountLineStatus(totalExpectedIls, totalCountedIls, "ILS");
  const summaryUsdStatus = managerCountLineStatus(expectedPsUsd, cashUsd, "USD");

  return (
    <>
      <div className="mcw-backdrop" role="presentation" onClick={onClose}>
        <div
          className="mcw-modal mcw-modal--workspace"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="mcw-head mcw-head--compact">
            <div className="mcw-head__main">
              <h2>ספירת מנהל</h2>
              <div className="mcw-head__meta">
                <span dir="ltr">שבוע {displayWeek}</span>
                {weekRangeLabel ? <span>{weekRangeLabel}</span> : null}
                <span className="mcw-head__meta-note">צפוי מקליטת תשלום בפועל</span>
              </div>
            </div>
            <div className="mcw-head__actions">
              <button
                type="button"
                className="fc-btn fc-btn--ghost"
                disabled={loading}
                onClick={() => void reloadFlow()}
              >
                <RefreshCw size={15} />
                רענון
              </button>
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
                      <th>העברה PS</th>
                      <th>עמלה PS</th>
                      <th>העברה IL</th>
                      <th>עמלה IL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((r) => (
                      <tr key={r.week}>
                        <td dir="ltr">{r.weekLabel ?? r.week}</td>
                        <td dir="ltr">{fmt(r.manager?.CASH_ILS, "ILS")}</td>
                        <td dir="ltr">{fmt(r.manager?.CASH_USD, "USD")}</td>
                        <td dir="ltr">{fmt(r.turkeyTransferUsd, "USD")}</td>
                        <td dir="ltr">{fmt(r.commissionUsd, "USD")}</td>
                        <td dir="ltr">{fmt(r.turkeyTransferIls, "ILS")}</td>
                        <td dir="ltr">{fmt(r.commissionIls, "ILS")}</td>
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
                    <div className="mcw-body mcw-body--step1">
                      {refreshNotice ? (
                        <p className="mcw-notice" role="status">
                          {refreshNotice}
                        </p>
                      ) : null}
                      <div className="mcw-summary-bar">
                        <div className="mcw-summary-bar__col">
                          <span>צפוי לפי המערכת</span>
                          <strong dir="ltr">
                            {fmtN(totalExpectedIls, "ILS")} · {fmtN(expectedPsUsd, "USD")}
                          </strong>
                        </div>
                        <div className="mcw-summary-bar__col">
                          <span>נספר בפועל</span>
                          <strong dir="ltr">
                            {fmtN(totalCountedIls, "ILS")} · {fmtN(cashUsd, "USD")}
                          </strong>
                        </div>
                        <div className="mcw-summary-bar__col">
                          <span>סטטוס</span>
                          <strong className={`is-${summaryIlsStatus.kind}`}>
                            {summaryIlsStatus.kind === "ok" && summaryUsdStatus.kind === "ok"
                              ? "🟢 הספירה תואמת למערכת"
                              : `${summaryIlsStatus.label} · ${summaryUsdStatus.label}`}
                          </strong>
                        </div>
                      </div>
                      <div className="mcw-dual-grid mcw-dual-grid--wide">
                        <section className="mcw-track mcw-track--ps">
                          <h3>מסלול PS — מזומן פיזי</h3>
                          <p className="mcw-hint mcw-hint--section">
                            הצפוי מגיע מקליטת תשלום (CASH PS) — ניתן לערוך את הספירה בפועל
                          </p>
                          <div className="mcw-line-stack">
                            {psLines.map((line) => (
                              <ManagerCountLineField
                                key={line.lineId}
                                line={line}
                                countedValue={form[line.formKey]}
                                disabled={!canEdit || saving}
                                onCountedChange={(v) => patch(line.formKey, v)}
                                onCountedTouched={() => touchedCountFieldsRef.current.add(line.formKey)}
                              />
                            ))}
                          </div>
                          <div className="mcw-track-total">
                            <span>סה״כ PS</span>
                            <span dir="ltr">
                              {fmtN(cashIls, "ILS")} · {fmtN(cashUsd, "USD")}
                            </span>
                          </div>
                        </section>

                        <section className="mcw-track mcw-track--il">
                          <h3>מסלול IL — מסלול בנקאי</h3>
                          <p className="mcw-hint mcw-hint--section">
                            העברות, אשראי וצ׳קים — לפי מה שנקלט בפועל בקליטה
                          </p>
                          <div className="mcw-line-stack">
                            {ilLines.map((line) => (
                              <ManagerCountLineField
                                key={line.lineId}
                                line={line}
                                countedValue={form[line.formKey]}
                                disabled={!canEdit || saving}
                                onCountedChange={(v) => patch(line.formKey, v)}
                                onCountedTouched={() => touchedCountFieldsRef.current.add(line.formKey)}
                              />
                            ))}
                          </div>
                          <div className="mcw-track-total">
                            <span>סה״כ IL</span>
                            <span dir="ltr">{fmtN(ilPool, "ILS")}</span>
                            <small>
                              צפוי {fmtN(expectedIlIls, "ILS")}
                            </small>
                          </div>
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
                          <h3>רכישת מט״ח PS</h3>
                          <div className="mcw-fx-summary mcw-fx-summary--ledger">
                            <div className="mcw-fx-stat">
                              <span>זמין ₪ לפני רכישה</span>
                              <strong dir="ltr">{fmtN(psBeforeFxIls, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>נרכש ₪ (PS)</span>
                              <strong dir="ltr">{fmtN(fxPs.ils, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>דולרים שנרכשו</span>
                              <strong dir="ltr">{fmtN(fxPs.usd, "USD")}</strong>
                            </div>
                            <div className="mcw-fx-stat mcw-fx-stat--highlight">
                              <span>יתרת ₪ בקופה</span>
                              <strong dir="ltr">{fmtN(psRemainingIls, "ILS")}</strong>
                            </div>
                          </div>
                          <FxPurchaseTable
                            rows={psPurchases}
                            canEdit={canEdit}
                            onEdit={
                              canEdit
                                ? (p) => void openFxPurchase("PS", p)
                                : undefined
                            }
                          />
                          {canEdit && (
                            <button
                              type="button"
                              className="fc-btn fc-btn--primary"
                              onClick={() => void openFxPurchase("PS")}
                            >
                              {psPurchases.length > 0 ? "רכישת מט״ח PS נוספת" : "רכישת מט״ח PS"}
                            </button>
                          )}
                        </section>

                        <section className="mcw-track mcw-track--il">
                          <h3>רכישת מט״ח IL</h3>
                          <div className="mcw-fx-summary mcw-fx-summary--ledger">
                            <div className="mcw-fx-stat">
                              <span>זמין ₪ לפני רכישה</span>
                              <strong dir="ltr">{fmtN(ilBeforeFxIls, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>נרכש ₪ (IL)</span>
                              <strong dir="ltr">{fmtN(fxIl.ils, "ILS")}</strong>
                            </div>
                            <div className="mcw-fx-stat">
                              <span>דולרים שנרכשו</span>
                              <strong dir="ltr">{fmtN(fxIl.usd, "USD")}</strong>
                            </div>
                            <div className="mcw-fx-stat mcw-fx-stat--highlight">
                              <span>יתרת ₪ בקופה</span>
                              <strong dir="ltr">{fmtN(ilFxRemainingIls, "ILS")}</strong>
                            </div>
                          </div>
                          <FxPurchaseTable
                            rows={ilPurchases}
                            canEdit={canEdit}
                            onEdit={
                              canEdit
                                ? (p) => void openFxPurchase("IL", p)
                                : undefined
                            }
                          />
                          {canEdit && (
                            <button
                              type="button"
                              className="fc-btn fc-btn--primary"
                              onClick={() => void openFxPurchase("IL")}
                            >
                              {ilPurchases.length > 0 ? "רכישת מט״ח IL נוספת" : "רכישת מט״ח IL"}
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
                              <span>מט״ח זמין PS</span>
                              <strong dir="ltr">{fmtN(psUsdAvailable, "USD")}</strong>
                            </div>
                            <div className="mcw-decision-kpi">
                              <span>סה״כ יוצא</span>
                              <strong dir="ltr">{fmtN(psUsdTotalOut, "USD")}</strong>
                            </div>
                            <div className="mcw-decision-kpi mcw-decision-kpi--total">
                              <span>יתרה PS $</span>
                              <strong dir="ltr">{fmtN(psUsdRemaining, "USD")}</strong>
                            </div>
                          </div>
                          <label className="mcw-field mcw-field--turkey">
                            <span>
                              סכום להעברה PS $
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
                              <p className="mcw-hint">ברירת מחדל: מזומן $ + דולרים שנרכשו PS</p>
                            )}
                          </label>
                          <label className="mcw-field">
                            <span>עמלת העברה PS $</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="mcw-input"
                              value={form.commissionUsd}
                              disabled={!canEdit || saving}
                              onChange={(e) => patch("commissionUsd", e.target.value)}
                            />
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
                              <span>מט״ח IL זמין</span>
                              <strong dir="ltr">{fmtN(ilAvailableIls, "ILS")}</strong>
                            </div>
                            <div className="mcw-decision-kpi">
                              <span>סה״כ יוצא</span>
                              <strong dir="ltr">{fmtN(ilTotalOut, "ILS")}</strong>
                            </div>
                            <div className="mcw-decision-kpi mcw-decision-kpi--total">
                              <span>יתרה IL ₪</span>
                              <strong dir="ltr">{fmtN(ilTurkeyRemainingIls, "ILS")}</strong>
                            </div>
                          </div>
                          <label className="mcw-field mcw-field--turkey">
                            <span>
                              סכום להעברה IL ₪
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
                              <p className="mcw-hint">ברירת מחדל: סכום רכישות מט״ח IL</p>
                            )}
                          </label>
                          <label className="mcw-field">
                            <span>עמלת העברה IL ₪</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="mcw-input"
                              value={form.commissionIls}
                              disabled={!canEdit || saving}
                              onChange={(e) => patch("commissionIls", e.target.value)}
                            />
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
                            <SummaryRow label="רכישת מט״ח PS ₪" value={fmt(fxPs.ils, "ILS")} />
                            <SummaryRow label="דולרים שנרכשו PS" value={fmt(fxPs.usd, "USD")} highlight />
                            <SummaryRow label="יתרת PS ₪" value={fmt(psRemainingIls, "ILS")} bold />
                            <SummaryRow label="העברה לטורקיה PS" value={fmt(turkeyUsd, "USD")} highlight />
                            <SummaryRow label="עמלת העברה PS" value={fmt(commUsd, "USD")} dimmed />
                            <SummaryRow label="סה״כ יוצא PS" value={fmt(psUsdTotalOut, "USD")} />
                            <SummaryRow label="נשאר בישראל PS $" value={fmt(psUsdRemaining, "USD")} bold />
                          </div>
                        </section>
                        <section className="mcw-track mcw-track--il">
                          <h3>סיכום IL</h3>
                          <div className="mcw-summary-rows">
                            <SummaryRow label="העברות" value={fmt(transferIls, "ILS")} />
                            <SummaryRow label="אשראי" value={fmt(creditIls, "ILS")} />
                            <SummaryRow label="צ׳קים" value={fmt(checksIls, "ILS")} />
                            <SummaryRow label="סה״כ מאגר IL" value={fmt(ilPool, "ILS")} bold />
                            <SummaryRow label="רכישת מט״ח IL ₪" value={fmt(fxIl.ils, "ILS")} />
                            <SummaryRow label="דולרים שנרכשו IL" value={fmt(fxIl.usd, "USD")} highlight />
                            <SummaryRow label="יתרת IL ₪ (לפני העברה)" value={fmt(ilFxRemainingIls, "ILS")} />
                            <SummaryRow label="העברה לטורקיה IL" value={fmt(turkeyIls, "ILS")} highlight />
                            <SummaryRow label="עמלת העברה IL" value={fmt(commIls, "ILS")} dimmed />
                            <SummaryRow label="סה״כ יוצא IL" value={fmt(ilTotalOut, "ILS")} />
                            <SummaryRow label="יתרה IL ₪" value={fmt(ilTurkeyRemainingIls, "ILS")} bold />
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
          editPurchase={fxEditPurchase}
          saving={saving}
          onClose={() => {
            setFxTrack(null);
            setFxEditPurchase(null);
          }}
          onSaved={() => void handleFxSaved()}
        />
      ) : null}
    </>
  );
}

function FxPurchaseTable({
  rows,
  canEdit,
  onEdit,
}: {
  rows: FxPurchaseRecord[];
  canEdit?: boolean;
  onEdit?: (row: FxPurchaseRecord) => void;
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
            {canEdit && onEdit ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td dir="ltr">{fmtDailyMoney("ILS", p.ilsAmount)}</td>
              <td dir="ltr">{p.rate.toFixed(4)}</td>
              <td dir="ltr">{fmtDailyMoney("USD", p.usdReceived)}</td>
              {canEdit && onEdit ? (
                <td>
                  <button type="button" className="mcw-link-btn" onClick={() => onEdit(p)}>
                    עריכת רכישה
                  </button>
                </td>
              ) : null}
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
