"use client";

import { useEffect, useState } from "react";
import { Calculator, Plus, X } from "lucide-react";
import type { FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { CurrencyExchangeModal } from "@/components/admin/flow-control/CurrencyExchangeModal";
import { CurrencyExchangeHistory } from "@/components/admin/flow-control/CurrencyExchangeHistory";
import { ExchangeProfitLossChart } from "@/components/admin/flow-control/ExchangeProfitLossChart";
import { ExchangeProfitLossHistoryTable } from "@/components/admin/flow-control/ExchangeProfitLossHistoryTable";

function formFromFlow(flow: FlowWeekPayload): ManagerCountForm {
  return {
    countedCashUsd: flow.counted.CASH_USD ?? "",
    countedCashIls: flow.counted.CASH_ILS ?? "",
    countedChecksIls: flow.counted.CHECK ?? "",
    countedCreditIls: flow.counted.CREDIT ?? "",
    countedTransferIls: flow.counted.BANK_TRANSFER ?? "",
    commissionUsd: flow.commissionUsd ?? "",
    commissionIls: flow.commissionIls ?? "",
    turkeyTransferUsd: flow.turkeyTransferUsd ?? "",
  };
}

export type ManagerCountSectionProps = {
  week: string;
  weekLabel: string | null;
  flow: FlowWeekPayload | null;
  canEdit: boolean;
  saving: boolean;
  onSaveManagerCount: (form: ManagerCountForm) => Promise<{ ok: boolean; error?: string }>;
  onSaveFx: (input: {
    ilsAmount: number;
    rate: number;
    remainderCashIls: number;
    remainderBankIls: number;
    note?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
};

export function ManagerCountSection({
  week,
  weekLabel,
  flow,
  canEdit,
  saving,
  onSaveManagerCount,
  onSaveFx,
}: ManagerCountSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
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

  useEffect(() => {
    if (flow) setForm(formFromFlow(flow));
  }, [flow]);

  const submitManager = async () => {
    const res = await onSaveManagerCount(form);
    if (res.ok) setModalOpen(false);
    else alert(res.error ?? "שמירה נכשלה");
  };

  return (
    <section className="fc-section fc-section--green">
      <header className="fc-section__head">
        <div>
          <h2>ספירת מנהל</h2>
          <p className="fc-section__sub">נתונים שהמנהל מזין — ספירה, עמלות, רכישת מט&quot;ח והעברה לטורקיה</p>
        </div>
        {canEdit ? (
          <button type="button" className="fc-btn fc-btn--primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> ספירת מנהל
          </button>
        ) : null}
      </header>

      {flow ? (
        <div className="fc-manager-grid">
          <div className="fc-stat">
            <span>דולר PS</span>
            <strong dir="ltr">{flow.counted.CASH_USD ?? "—"}</strong>
          </div>
          <div className="fc-stat">
            <span>שקל PS</span>
            <strong dir="ltr">{flow.counted.CASH_ILS ?? "—"}</strong>
          </div>
          <div className="fc-stat">
            <span>צ&apos;קים IL</span>
            <strong dir="ltr">{flow.counted.CHECK ?? "—"}</strong>
          </div>
          <div className="fc-stat">
            <span>אשראי IL</span>
            <strong dir="ltr">{flow.counted.CREDIT ?? "—"}</strong>
          </div>
          <div className="fc-stat">
            <span>העברות IL</span>
            <strong dir="ltr">{flow.counted.BANK_TRANSFER ?? "—"}</strong>
          </div>
          <div className="fc-stat">
            <span>רכישת מט&quot;ח</span>
            <strong dir="ltr">
              {flow.fxPurchaseIls ? `₪${flow.fxPurchaseIls}` : "—"}
              {flow.fxPurchaseUsd ? ` → $${flow.fxPurchaseUsd}` : ""}
            </strong>
          </div>
          <div className="fc-stat">
            <span>הועבר לטורקיה</span>
            <strong dir="ltr">{flow.turkeyTransferUsd ? `$${flow.turkeyTransferUsd}` : "—"}</strong>
          </div>
        </div>
      ) : (
        <p className="fc-muted">טוען נתוני מנהל…</p>
      )}

      {flow && flow.fxPurchases.length > 0 ? (
        <>
          <CurrencyExchangeHistory purchases={flow.fxPurchases} />
          <ExchangeProfitLossHistoryTable rows={flow.fxProfitLossHistory} />
          <ExchangeProfitLossChart summary={flow.fxProfitLoss} />
        </>
      ) : null}

      {modalOpen ? (
        <div className="fc-modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <div
            className="fc-modal"
            role="dialog"
            aria-labelledby="manager-count-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="fc-modal__head">
              <h3 id="manager-count-title">
                <Calculator size={18} /> ספירת מנהל
              </h3>
              <button type="button" className="fc-btn fc-btn--icon" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <p className="fc-modal__meta">{weekLabel ?? week}</p>
            <div className="fc-form-grid">
              {(
                [
                  ["countedCashUsd", "דולר PS"],
                  ["countedCashIls", "שקל PS"],
                  ["countedChecksIls", "צ'קים IL"],
                  ["countedCreditIls", "אשראי IL"],
                  ["countedTransferIls", "העברות IL"],
                  ["commissionUsd", "עמלה $"],
                  ["commissionIls", "עמלה ₪"],
                  ["turkeyTransferUsd", "דולר שנשלח לטורקיה"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="fc-field">
                  <span>{label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="fc-input"
                    value={form[key]}
                    disabled={saving}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="fc-modal__actions">
              <button
                type="button"
                className="fc-btn fc-btn--ghost"
                onClick={() => setFxOpen(true)}
                disabled={saving}
              >
                רכישת מט&quot;ח
              </button>
              <button type="button" className="fc-btn fc-btn--primary" disabled={saving} onClick={() => void submitManager()}>
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CurrencyExchangeModal
        open={fxOpen}
        week={week}
        weekLabel={weekLabel}
        availableIls={flow?.availableIlsForFx ?? "0"}
        saving={saving}
        onClose={() => setFxOpen(false)}
        onSave={async (input) => {
          const res = await onSaveFx(input);
          if (res.ok) setFxOpen(false);
          return res;
        }}
      />
    </section>
  );
}

export default ManagerCountSection;
