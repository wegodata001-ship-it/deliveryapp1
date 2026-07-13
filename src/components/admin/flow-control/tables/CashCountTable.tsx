"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, Plus, Save } from "lucide-react";
import type { FlowWeekDrillPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
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
  isTurkeyManual,
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
  { key: "fxPs", label: 'רכישת PS מט"ח', kind: "fx", currency: "USD" },
  { key: "commUsd", label: "עמלה $", kind: "input", formKey: "commissionUsd", currency: "USD" },
  {
    key: "turkeyPs",
    label: "לטורקיה PS",
    title: "דולר PS + רכישת מט״ח − עמלה $",
    kind: "input",
    formKey: "turkeyTransferUsd",
    currency: "USD",
  },
  {
    key: "bankPs",
    label: "העברה לבנק PS",
    title: "סכום שהועבר לבנק מיתרות מט״ח",
    kind: "readonly",
    currency: "ILS",
    getValue: ({ drill }) => drill.flow.fxRemainderBankIls ?? "",
  },
  {
    key: "ilsXfer",
    label: "סכום ₪ להעברה",
    title: "זמין לרכישת מט״ח",
    kind: "computed",
    currency: "ILS",
    getValue: ({ drill }) => drill.flow.availableIlsForFx,
  },
  {
    key: "fxIl",
    label: 'רכישת IL מט"ח',
    kind: "readonly",
    currency: "ILS",
    getValue: ({ drill }) => drill.flow.fxPurchaseIls ?? "",
  },
  { key: "turkeyIl", label: "לטורקיה IL", kind: "readonly", currency: "ILS", getValue: () => "" },
  { key: "commIls", label: "עמלה IL", kind: "input", formKey: "commissionIls", currency: "ILS" },
  { key: "checks", label: "צ'קים IL", kind: "input", formKey: "countedChecksIls", currency: "ILS" },
  { key: "credit", label: "אשראי IL", kind: "input", formKey: "countedCreditIls", currency: "ILS" },
  { key: "transfer", label: "העברה IL", kind: "input", formKey: "countedTransferIls", currency: "ILS" },
  { key: "other", label: "אחר IL", kind: "readonly", currency: "ILS", getValue: () => "" },
  { key: "notes", label: "הערות", kind: "readonly", getValue: () => "" },
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
  const [turkeyManual, setTurkeyManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [fxDetailOpen, setFxDetailOpen] = useState(false);

  useEffect(() => {
    if (!drill?.flow) return;
    const f = formFromFlow(drill.flow);
    setForm(syncAutoTurkey(f, drill.flow));
    setTurkeyManual(isTurkeyManual(f, drill.flow));
    setSavedOk(false);
  }, [drill?.flow, drill?.week]);

  const fxTotals = drill ? sumFxPurchases(drill.flow.fxPurchases) : { ils: 0, usd: 0 };
  const autoTurkey = computeAutoTurkeyUsd(form, fxTotals.usd);

  const patchForm = (key: keyof ManagerCountForm, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (!turkeyManual && (key === "countedCashUsd" || key === "commissionUsd")) {
        return syncAutoTurkey(next, drill?.flow ?? null);
      }
      return next;
    });
    setSavedOk(false);
  };

  const handleTurkeyChange = (value: string) => {
    setTurkeyManual(true);
    setForm((prev) => ({ ...prev, turkeyTransferUsd: value }));
    setSavedOk(false);
  };

  const handleSave = useCallback(async () => {
    if (!drill || !canEdit) return;
    setSaving(true);
    setSavedOk(false);
    try {
      const payload = turkeyManual ? form : syncAutoTurkey(form, drill.flow);
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
  }, [canEdit, drill, form, onSaved, turkeyManual]);

  const handleFxSaved = async () => {
    if (!drill) return;
    const data = await getFlowWeekAction(drill.week);
    if (data) {
      const f = formFromFlow(data);
      setForm((prev) => (turkeyManual ? { ...f, turkeyTransferUsd: prev.turkeyTransferUsd } : syncAutoTurkey(f, data)));
    }
    dispatchCashControlRefresh(drill.week);
    onSaved();
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
                            <button type="button" className="ft-icon-btn" title="עריכה / רכישה" onClick={() => setFxOpen(true)}>
                              <Pencil size={14} />
                            </button>
                          ) : null}
                        </div>
                      ) : canEdit ? (
                        <button type="button" className="ft-fx-add" onClick={() => setFxOpen(true)}>
                          <Plus size={14} /> רכישת מט&quot;ח
                        </button>
                      ) : (
                        "לא הוזן"
                      )}
                    </td>
                  );
                }

                if (col.kind === "input" && col.formKey) {
                  const isTurkey = col.key === "turkeyPs";
                  return (
                    <td key={col.key} className="ft-num ft-cell--input">
                      <div className="ft-input-wrap">
                        {isTurkey && turkeyManual ? <span className="ft-manual-tag">ידני</span> : null}
                        <input
                          type="text"
                          inputMode="decimal"
                          className="ft-input"
                          dir="ltr"
                          disabled={!canEdit || saving}
                          value={isTurkey ? form.turkeyTransferUsd : form[col.formKey]}
                          onChange={(e) =>
                            isTurkey ? handleTurkeyChange(e.target.value) : patchForm(col.formKey!, e.target.value)
                          }
                        />
                      </div>
                      {isTurkey && !turkeyManual ? (
                        <span className="ft-calc-hint" dir="ltr" title="חישוב אוטומטי">
                          {autoTurkey.toFixed(2)}
                        </span>
                      ) : null}
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
          availableIls={drill.flow.availableIlsForFx}
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
              <CurrencyExchangeHistory purchases={drill.flow.fxPurchases} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CashCountTable;
