"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, Plus, Save } from "lucide-react";
import type { FlowWeekDrillPayload, FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { saveManagerCountAction } from "@/app/admin/cash-flow/save-manager-count-action";
import { getFlowWeekAction } from "@/app/admin/cash-flow/get-flow-week-action";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { ManagerCountFxPurchaseFlow } from "@/components/admin/manager-count/ManagerCountFxPurchaseFlow";
import { CurrencyExchangeHistory } from "@/components/admin/flow-control/CurrencyExchangeHistory";
import {
  computeAutoTurkeyUsd,
  formFromFlow,
  resolveAvailableIlsForFx,
  syncAutoTurkey,
} from "@/components/admin/manager-count/manager-count-utils";
import { fcNum } from "@/components/admin/flow-control/shared";

export type CashCountTableProps = {
  drill: FlowWeekDrillPayload | null;
  loading?: boolean;
  canEdit: boolean;
  onSaved: () => void;
};

type ColKind = "input" | "computed" | "fx" | "readonly";

type ColDef = {
  key: string;
  label: string;
  title?: string;
  kind: ColKind;
  formKey?: keyof ManagerCountForm;
  currency?: "ILS" | "USD";
  getValue?: (ctx: { form: ManagerCountForm; drill: FlowWeekDrillPayload; fxUsd: number; autoTurkey: number }) => string;
};

const COLUMNS: ColDef[] = [
  { key: "usd", label: "דולר PS", kind: "input", formKey: "countedCashUsd", currency: "USD" },
  { key: "ils", label: "שקל PS", kind: "input", formKey: "countedCashIls", currency: "ILS" },
  {
    key: "fxPs",
    label: 'רכישת מט"ח PS',
    title: "דולרים שנרכשו דרך מסלול PS (שקל PS ÷ שער)",
    kind: "fx",
    currency: "USD",
  },
  { key: "commUsd", label: "עמלה PS", kind: "input", formKey: "commissionUsd", currency: "USD" },
  {
    key: "turkeyPs",
    label: "טורקיה PS",
    title: "דולרים שנרכשו + עמלה PS",
    kind: "computed",
    currency: "USD",
    getValue: ({ autoTurkey }) => (autoTurkey > 0 ? autoTurkey.toFixed(2) : ""),
  },
  {
    key: "turkeyTransferred",
    label: "סכום שהועבר מטורקיה",
    title: "סכום שהועבר בפועל לטורקיה (מתנועות)",
    kind: "readonly",
    currency: "USD",
    getValue: ({ drill }) => {
      const n =
        drill.flow.turkeyBalance?.actualTransfersUsd ??
        drill.flow.turkeyBalance?.usd.transferred ??
        fcNum(drill.flow.turkeyTransferUsd);
      return n > 0 ? n.toFixed(2) : "";
    },
  },
  { key: "transfer", label: "העברות IL", kind: "input", formKey: "countedTransferIls", currency: "ILS" },
  { key: "checks", label: "צ'קים IL", kind: "input", formKey: "countedChecksIls", currency: "ILS" },
  { key: "credit", label: "אשראי IL", kind: "input", formKey: "countedCreditIls", currency: "ILS" },
  {
    key: "fxIl",
    label: 'רכישת מט"ח IL',
    title: "העברות IL + צ'קים IL + אשראי IL",
    kind: "computed",
    currency: "ILS",
    getValue: ({ form }) => {
      const n =
        fcNum(form.countedTransferIls) + fcNum(form.countedCreditIls) + fcNum(form.countedChecksIls);
      return n > 0 ? n.toFixed(2) : "";
    },
  },
  { key: "commIls", label: "עמלה IL", kind: "input", formKey: "commissionIls", currency: "ILS" },
  {
    key: "by",
    label: "עודכן על ידי",
    kind: "readonly",
    getValue: ({ drill }) => drill.meta.updatedByName ?? "",
  },
  {
    key: "at",
    label: "תאריך עדכון",
    kind: "readonly",
    getValue: ({ drill }) => drill.meta.updatedAtDisplay ?? "",
  },
];

function fmtVal(currency: "ILS" | "USD" | undefined, raw: string): string {
  if (!raw?.trim()) return "לא הוזן";
  const n = fcNum(raw);
  if (n <= 0 && raw.trim() !== "0") return "לא הוזן";
  return currency ? fmtDailyMoney(currency, n) : raw;
}

export function CashCountTable({ drill, loading, canEdit, onSaved }: CashCountTableProps) {
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
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [fxDetailOpen, setFxDetailOpen] = useState(false);
  const [flowSnap, setFlowSnap] = useState<FlowWeekPayload | null>(null);

  useEffect(() => {
    if (!drill?.flow) return;
    const f = formFromFlow(drill.flow);
    setForm(syncAutoTurkey(f, drill.flow));
    setFlowSnap(drill.flow);
    setSavedOk(false);
  }, [drill?.flow, drill?.week]);

  const activeFlow = flowSnap ?? drill?.flow ?? null;
  const availableIls = resolveAvailableIlsForFx(activeFlow, form);
  const fxTotals = activeFlow ? sumFxPurchases(activeFlow.fxPurchases) : { ils: 0, usd: 0 };
  const autoTurkey = computeAutoTurkeyUsd(form, fxTotals.usd);

  const patchForm = (key: keyof ManagerCountForm, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "commissionUsd") {
        return syncAutoTurkey(next, drill?.flow ?? null);
      }
      return next;
    });
    setSavedOk(false);
  };

  const handleSave = useCallback(async () => {
    if (!drill || !canEdit) return;
    setSaving(true);
    setSavedOk(false);
    try {
      const payload = syncAutoTurkey(form, drill.flow);
      const res = await saveManagerCountAction({ week: drill.week, form: payload });
      if (!res.ok) {
        alert(res.error ?? "שמירה נכשלה");
        return;
      }
      dispatchCashControlRefresh(drill.week);
      setSavedOk(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [canEdit, drill, form, onSaved]);

  const handleFxSaved = async () => {
    if (!drill) return;
    const data = await getFlowWeekAction(drill.week);
    if (data) {
      setForm(syncAutoTurkey(formFromFlow(data), data));
      setFlowSnap(data);
    }
    dispatchCashControlRefresh(drill.week);
    onSaved();
  };

  const openFxPurchase = async () => {
    if (!drill || !canEdit) return;
    const dirty =
      Math.abs(fcNum(form.countedCashIls) - fcNum(drill.flow.counted.CASH_ILS)) > 0.02 ||
      Math.abs(fcNum(form.countedCashUsd) - fcNum(drill.flow.counted.CASH_USD)) > 0.02 ||
      Math.abs(fcNum(form.countedTransferIls) - fcNum(drill.flow.counted.BANK_TRANSFER)) > 0.02 ||
      Math.abs(fcNum(form.countedChecksIls) - fcNum(drill.flow.counted.CHECK)) > 0.02 ||
      Math.abs(fcNum(form.countedCreditIls) - fcNum(drill.flow.counted.CREDIT)) > 0.02 ||
      Math.abs(fcNum(form.commissionUsd) - fcNum(drill.flow.commissionUsd)) > 0.02 ||
      Math.abs(fcNum(form.commissionIls) - fcNum(drill.flow.commissionIls)) > 0.02;
    if (dirty) {
      const payload = syncAutoTurkey(form, activeFlow ?? drill.flow);
      const saveRes = await saveManagerCountAction({ week: drill.week, form: payload });
      if (!saveRes.ok) {
        alert(saveRes.error ?? "יש לשמור את ספירת הקופה לפני רכישת מט״ח");
        return;
      }
      dispatchCashControlRefresh(drill.week);
    }
    const data = await getFlowWeekAction(drill.week);
    if (data) {
      setFlowSnap(data);
      setForm(syncAutoTurkey(formFromFlow(data), data));
    }
    setFxOpen(true);
  };

  if (loading) return <p className="ft-empty">טוען ספירת קופה…</p>;
  if (!drill) return null;

  const ctx = { form, drill, fxUsd: fxTotals.usd, autoTurkey };

  return (
    <div className="ft-count">
      <div className="ft-table-wrap ft-table-wrap--wide">
        <table className="ft-table ft-table--count">
          <thead>
            <tr>
              <th>שבוע</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="ft-num" title={c.title}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="ft-row">
              <td dir="ltr">{drill.week}</td>
              {COLUMNS.map((col) => {
                if (col.kind === "fx") {
                  const hasFx = fxTotals.usd > 0;
                  return (
                    <td key={col.key} className="ft-num ft-cell--action">
                      {hasFx ? (
                        <div className="ft-fx-cell">
                          <span dir="ltr">{fmtDailyMoney("USD", fxTotals.usd)}</span>
                          <button type="button" className="ft-icon-btn" title="צפייה" onClick={() => setFxDetailOpen(true)}>
                            <Eye size={14} />
                          </button>
                          {canEdit ? (
                            <button type="button" className="ft-icon-btn" title="עריכה / רכישה" onClick={() => void openFxPurchase()}>
                              <Pencil size={14} />
                            </button>
                          ) : null}
                        </div>
                      ) : canEdit ? (
                        <button type="button" className="ft-fx-add" onClick={() => void openFxPurchase()}>
                          <Plus size={14} /> רכישת מט&quot;ח
                        </button>
                      ) : (
                        "לא הוזן"
                      )}
                    </td>
                  );
                }

                if (col.kind === "input" && col.formKey) {
                  return (
                    <td key={col.key} className="ft-num ft-cell--input">
                      <div className="ft-input-wrap">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="ft-input"
                          dir="ltr"
                          disabled={!canEdit || saving}
                          value={form[col.formKey]}
                          onChange={(e) => patchForm(col.formKey!, e.target.value)}
                        />
                      </div>
                    </td>
                  );
                }

                const raw = col.getValue?.(ctx) ?? "";
                const computed = col.kind === "computed";
                return (
                  <td key={col.key} className={`ft-num${computed ? " ft-cell--computed" : ""}`} dir={col.currency ? "ltr" : undefined}>
                    {col.currency ? fmtVal(col.currency, raw) : raw || "לא הוזן"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <footer className="ft-count__foot">
          {savedOk ? <span className="ft-save-ok">הספירה נשמרה בהצלחה</span> : null}
          <button type="button" className="fc-btn fc-btn--primary" disabled={saving} onClick={() => void handleSave()}>
            <Save size={16} /> {saving ? "שומר…" : "שמור ספירת קופה"}
          </button>
        </footer>
      ) : null}

      {canEdit ? (
        <ManagerCountFxPurchaseFlow
          open={fxOpen}
          week={drill.week}
          weekLabel={drill.weekLabel}
          availableIls={availableIls}
          saving={saving}
          onClose={() => setFxOpen(false)}
          onSaved={() => {
            setFxOpen(false);
            void handleFxSaved();
          }}
        />
      ) : null}

      {fxDetailOpen ? (
        <div className="adm-cash-modal-backdrop" role="presentation" onClick={() => setFxDetailOpen(false)}>
          <div className="adm-cash-modal adm-cash-modal--quick-expense" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <header className="adm-cash-modal__head">
              <h3>פירוט רכישות מט&quot;ח</h3>
              <button type="button" className="adm-modal__close" onClick={() => setFxDetailOpen(false)} aria-label="סגור">
                ×
              </button>
            </header>
            <div className="adm-cash-modal__body">
              <CurrencyExchangeHistory purchases={activeFlow?.fxPurchases ?? drill.flow.fxPurchases} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CashCountTable;
