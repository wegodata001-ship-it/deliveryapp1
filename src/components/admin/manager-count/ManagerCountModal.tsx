"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  Calculator,
  Coins,
  CreditCard,
  Plane,
  Save,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import type { FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { saveManagerCountAction } from "@/app/admin/cash-flow/save-manager-count-action";
import { getFlowWeekAction } from "@/app/admin/cash-flow/get-flow-week-action";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { CurrencyExchangeHistory } from "@/components/admin/flow-control/CurrencyExchangeHistory";
import { ExchangeProfitLossChart } from "@/components/admin/flow-control/ExchangeProfitLossChart";
import { ManagerCountFxPurchaseFlow } from "@/components/admin/manager-count/ManagerCountFxPurchaseFlow";
import {
  computeAutoTurkeyUsd,
  formFromFlow,
  isTurkeyManual,
  sumIntakeFxPlFromPurchases,
  syncAutoTurkey,
} from "@/components/admin/manager-count/manager-count-utils";
import { fcNum } from "@/components/admin/flow-control/shared";

export type ManagerCountModalProps = {
  open: boolean;
  week: string;
  weekLabel: string | null;
  flow: FlowWeekPayload | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const METHOD_FIELDS: { key: keyof ManagerCountForm; label: string }[] = [
  { key: "countedChecksIls", label: "צ'קים IL" },
  { key: "countedCreditIls", label: "אשראי IL" },
  { key: "countedTransferIls", label: "העברה IL" },
  { key: "commissionIls", label: "עמלה IL" },
];

export function ManagerCountModal({
  open,
  week,
  weekLabel,
  flow: initialFlow,
  canEdit,
  onClose,
  onSaved,
}: ManagerCountModalProps) {
  const [flow, setFlow] = useState<FlowWeekPayload | null>(initialFlow);
  const [form, setForm] = useState<ManagerCountForm>({
    countedCashUsd: "",
    countedCashIls: "",
    countedChecksIls: "",
    countedCreditIls: "",
    countedTransferIls: "",
    commissionUsd: "",
    commissionIls: "",
    turkeyTransferUsd: "",
  });
  const [turkeyManual, setTurkeyManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const reloadFlow = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFlowWeekAction(week);
      if (data) {
        setFlow(data);
        const nextForm = formFromFlow(data);
        setForm((prev) => {
          const merged = turkeyManual ? { ...nextForm, turkeyTransferUsd: prev.turkeyTransferUsd } : syncAutoTurkey(nextForm, data);
          return merged;
        });
        if (!turkeyManual) setTurkeyManual(isTurkeyManual(formFromFlow(data), data));
      }
    } finally {
      setLoading(false);
    }
  }, [week, turkeyManual]);

  useEffect(() => {
    if (!open) return;
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
  const intakePl = sumIntakeFxPlFromPurchases(flow);

  const patchForm = (key: keyof ManagerCountForm, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (!turkeyManual && (key === "countedCashUsd" || key === "commissionUsd")) {
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
    setLoading(true);
    try {
      const data = await getFlowWeekAction(week);
      if (data) {
        setFlow(data);
        setForm((prev) => {
          if (turkeyManual) return { ...formFromFlow(data), turkeyTransferUsd: prev.turkeyTransferUsd };
          return syncAutoTurkey(formFromFlow(data), data);
        });
      }
    } finally {
      setLoading(false);
    }
    onSaved();
  };

  if (!open) return null;

  return (
    <>
      <div className="mc-modal-backdrop" role="presentation" onClick={onClose}>
        <div className="mc-modal" role="dialog" aria-labelledby="mc-modal-title" onClick={(e) => e.stopPropagation()}>
          <header className="mc-modal__head">
            <div>
              <h2 id="mc-modal-title">
                <Calculator size={20} /> ספירת מנהל
              </h2>
              <p className="mc-modal__sub">{weekLabel ?? week}</p>
            </div>
            <button type="button" className="fc-btn fc-btn--icon" onClick={onClose} aria-label="סגירה">
              <X size={18} />
            </button>
          </header>

          {loading && !flow ? (
            <p className="mc-muted">טוען…</p>
          ) : (
            <div className="mc-modal__grid">
              <section className="mc-card mc-card--cash">
                <header className="mc-card__head">
                  <Wallet size={18} />
                  <h3>מזומן</h3>
                </header>
                <div className="mc-card__fields">
                  <label className="fc-field">
                    <span>דולר PS</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="fc-input"
                      value={form.countedCashUsd}
                      disabled={!canEdit || saving}
                      onChange={(e) => patchForm("countedCashUsd", e.target.value)}
                    />
                  </label>
                  <label className="fc-field">
                    <span>שקל PS</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="fc-input"
                      value={form.countedCashIls}
                      disabled={!canEdit || saving}
                      onChange={(e) => patchForm("countedCashIls", e.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="mc-card mc-card--fx">
                <header className="mc-card__head">
                  <Coins size={18} />
                  <h3>רכישת מט&quot;ח</h3>
                  {canEdit ? (
                    <button type="button" className="fc-btn fc-btn--ghost fc-btn--sm" onClick={() => setFxOpen(true)}>
                      + רכישה
                    </button>
                  ) : null}
                </header>
                <div className="mc-card__stats">
                  <div>
                    <span>סה״כ רכישה</span>
                    <strong dir="ltr">
                      {fxTotals.ils > 0 ? `${fmtDailyMoney("ILS", fxTotals.ils)} → ${fmtDailyMoney("USD", fxTotals.usd)}` : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>נשאר בקופה</span>
                    <strong dir="ltr">
                      {flow?.fxRemainderCashIls ? fmtDailyMoney("ILS", fcNum(flow.fxRemainderCashIls)) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>הועבר לקופה</span>
                    <strong dir="ltr">
                      {flow?.fxRemainderBankIls ? fmtDailyMoney("ILS", fcNum(flow.fxRemainderBankIls)) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>זמין לרכישה</span>
                    <strong dir="ltr">
                      {flow ? fmtDailyMoney("ILS", fcNum(flow.availableIlsForFx)) : "—"}
                    </strong>
                  </div>
                </div>
                {flow && flow.fxPurchases.length > 0 ? (
                  <CurrencyExchangeHistory purchases={flow.fxPurchases} />
                ) : null}
              </section>

              <section className="mc-card mc-card--turkey">
                <header className="mc-card__head">
                  <Plane size={18} />
                  <h3>העברות לטורקיה</h3>
                </header>
                <div className="mc-card__fields">
                  <label className="fc-field">
                    <span>עמלה $</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="fc-input"
                      value={form.commissionUsd}
                      disabled={!canEdit || saving}
                      onChange={(e) => patchForm("commissionUsd", e.target.value)}
                    />
                  </label>
                  <label className="fc-field">
                    <span>
                      לטורקיה PS
                      {turkeyManual ? <em className="mc-manual-badge">שונה ידנית</em> : null}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="fc-input"
                      value={form.turkeyTransferUsd}
                      disabled={!canEdit || saving}
                      onChange={(e) => handleTurkeyChange(e.target.value)}
                    />
                    {canEdit && turkeyManual ? (
                      <button type="button" className="mc-link-btn" onClick={resetTurkeyAuto}>
                        חזרה לחישוב אוטומטי ({autoTurkey.toFixed(2)} $)
                      </button>
                    ) : null}
                  </label>
                  <p className="mc-hint">
                    נוסחה: דולר PS + רכישת מט&quot;ח − עמלה $ = לטורקיה PS
                  </p>
                </div>
              </section>

              <section className="mc-card mc-card--methods">
                <header className="mc-card__head">
                  <CreditCard size={18} />
                  <h3>אמצעי תשלום</h3>
                </header>
                <div className="mc-card__fields mc-card__fields--grid">
                  {METHOD_FIELDS.map(({ key, label }) => (
                    <label key={key} className="fc-field">
                      <span>{label}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="fc-input"
                        value={form[key]}
                        disabled={!canEdit || saving}
                        onChange={(e) => patchForm(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="mc-card mc-card--pl">
                <header className="mc-card__head">
                  <TrendingUp size={18} />
                  <h3>רווח / הפסד מט&quot;ח</h3>
                </header>
                {intakePl.profitIls > 0 || intakePl.lossIls > 0 ? (
                  <div className="mc-pl-kpis">
                    <div className="mc-pl-kpi mc-pl-kpi--profit">
                      <span>רווח</span>
                      <strong dir="ltr">{fmtDailyMoney("ILS", intakePl.profitIls)}</strong>
                    </div>
                    <div className="mc-pl-kpi mc-pl-kpi--loss">
                      <span>הפסד</span>
                      <strong dir="ltr">{fmtDailyMoney("ILS", intakePl.lossIls)}</strong>
                    </div>
                    <div className="mc-pl-kpi">
                      <span>נטו</span>
                      <strong dir="ltr">{fmtDailyMoney("ILS", intakePl.netIls)}</strong>
                    </div>
                  </div>
                ) : flow ? (
                  <ExchangeProfitLossChart summary={flow.fxProfitLoss} />
                ) : (
                  <p className="mc-muted">אין רכישות מט&quot;ח לשבוע זה</p>
                )}
              </section>

              <section className="mc-card mc-card--summary">
                <header className="mc-card__head">
                  <Banknote size={18} />
                  <h3>סיכום</h3>
                </header>
                {flow ? (
                  <div className="mc-summary-grid">
                    <div>
                      <span>דולר בקופה</span>
                      <strong dir="ltr">{fmtDailyMoney("USD", fcNum(flow.drawerRemainingUsd))}</strong>
                    </div>
                    <div>
                      <span>שקל בקופה</span>
                      <strong dir="ltr">{fmtDailyMoney("ILS", fcNum(flow.drawerRemainingIls))}</strong>
                    </div>
                    <div>
                      <span>יתרה בבנק</span>
                      <strong dir="ltr">{fmtDailyMoney("ILS", fcNum(flow.bankBalanceIls ?? "0"))}</strong>
                    </div>
                    <div>
                      <span>חוב לטורקיה</span>
                      <strong dir="ltr" className={flow.turkeyDebtStatus === "debt" ? "fc-num--loss" : ""}>
                        {fcNum(flow.turkeyDebtUsd) > 0 ? fmtDailyMoney("USD", fcNum(flow.turkeyDebtUsd)) : "—"}
                      </strong>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          )}

          {canEdit ? (
            <footer className="mc-modal__foot">
              <button type="button" className="fc-btn fc-btn--ghost" onClick={onClose} disabled={saving}>
                ביטול
              </button>
              <button type="button" className="fc-btn fc-btn--primary" disabled={saving} onClick={() => void handleSave()}>
                <Save size={16} /> שמירה
              </button>
            </footer>
          ) : null}
        </div>
      </div>

      {canEdit && flow ? (
        <ManagerCountFxPurchaseFlow
          open={fxOpen}
          week={week}
          weekLabel={weekLabel}
          availableIls={flow.availableIlsForFx}
          saving={saving}
          onClose={() => setFxOpen(false)}
          onSaved={handleFxSaved}
        />
      ) : null}
    </>
  );
}

export default ManagerCountModal;
