"use client";

import { useMemo, useState } from "react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { money, moneyBoth, weekDiffIls } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { fcNum } from "@/components/admin/flow-control/shared";
import { CASH_CONTROL_CHANNELS } from "@/lib/cash-control-channel";
import { TURKEY_MOVEMENT_TYPE_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";
import { CurrencyExchangeModal } from "@/components/admin/flow-control/CurrencyExchangeModal";
import { saveFxPurchaseAction } from "@/app/admin/cash-flow/save-fx-purchase-action";
import { Coins } from "lucide-react";

type TabId = "intakes" | "count" | "fx" | "turkey" | "match" | "diffs";

const TABS: { id: TabId; label: string }[] = [
  { id: "intakes", label: "קליטות" },
  { id: "count", label: "ספירת מנהל" },
  { id: "fx", label: "מט״ח" },
  { id: "turkey", label: "רכישות לטורקיה" },
  { id: "match", label: "התאמות" },
  { id: "diffs", label: "הפרשים" },
];

export type CashflowWeekTabsProps = {
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
  canManageFlow: boolean;
  onFxSaved: () => void;
};

export function CashflowWeekTabs({ row, drill, loading, canManageFlow, onFxSaved }: CashflowWeekTabsProps) {
  const [tab, setTab] = useState<TabId>("intakes");
  const [fxOpen, setFxOpen] = useState(false);
  const [fxSaving, setFxSaving] = useState(false);

  const flow = drill?.flow ?? null;
  const diff = weekDiffIls(row);

  const matchRows = useMemo(() => {
    return CASH_CONTROL_CHANNELS.map((ch) => {
      const received = fcNum(drill?.paymentIntake?.[ch.id]);
      const countedKey =
        ch.id.startsWith("CASH")
          ? ch.id
          : ch.id.includes("BANK_TRANSFER")
            ? "BANK_TRANSFER"
            : ch.id.includes("CREDIT")
              ? "CREDIT"
              : ch.id.includes("CHECK")
                ? "CHECK"
                : null;
      const counted =
        countedKey === "CASH_ILS" || countedKey === "CASH_USD"
          ? fcNum(flow?.counted?.[countedKey])
          : countedKey
            ? fcNum(flow?.counted?.[countedKey as "BANK_TRANSFER" | "CREDIT" | "CHECK"])
            : 0;
      const d = received - counted;
      return { label: ch.label, received, counted, diff: d, currency: ch.currency };
    });
  }, [drill?.paymentIntake, flow?.counted]);

  return (
    <div className="cfc-card cfc-tabs-card">
      <div className="cfc-tabs-head">
        <div className="cfc-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`cfc-tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canManageFlow ? (
          <button type="button" className="cfc-btn cfc-btn--primary" onClick={() => setFxOpen(true)}>
            <Coins size={15} />
            רכישת מט״ח
          </button>
        ) : null}
      </div>

      <div className="cfc-tab-panel" role="tabpanel">
        {loading ? <p className="cfc-empty">טוען פירוט…</p> : null}

        {!loading && tab === "intakes" ? (
          <div className="cfc-detail-table-wrap">
            <table className="cfc-detail-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>יום</th>
                  {CASH_CONTROL_CHANNELS.map((c) => (
                    <th key={c.id}>{c.label}</th>
                  ))}
                  <th>סה״כ</th>
                </tr>
              </thead>
              <tbody>
                {(drill?.paymentDailyRows ?? []).map((r) => (
                  <tr key={`${r.dateYmd}-${r.isTotal ? "t" : "d"}`} className={r.isTotal ? "is-total" : ""}>
                    <td>{r.dateDisplay}</td>
                    <td>{r.dayName}</td>
                    {CASH_CONTROL_CHANNELS.map((c) => (
                      <td key={c.id} dir="ltr">
                        {money(c.currency, r.intake[c.id])}
                      </td>
                    ))}
                    <td dir="ltr">{money("ILS", r.totalReceived)}</td>
                  </tr>
                ))}
                {(drill?.paymentDailyRows?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={12} className="cfc-empty-cell">
                      אין קליטות לשבוע זה
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && tab === "count" ? (
          <div className="cfc-detail-grid">
            <MetricBlock label="מזומן ₪" value={money("ILS", flow?.counted.CASH_ILS)} />
            <MetricBlock label="מזומן $" value={money("USD", flow?.counted.CASH_USD)} />
            <MetricBlock label="העברות" value={money("ILS", flow?.counted.BANK_TRANSFER)} />
            <MetricBlock label="צ׳קים" value={money("ILS", flow?.counted.CHECK)} />
            <MetricBlock label="אשראי" value={money("ILS", flow?.counted.CREDIT)} />
            <MetricBlock label="עמלה $" value={money("USD", flow?.commissionUsd)} />
            <MetricBlock label="עמלה ₪" value={money("ILS", flow?.commissionIls)} />
            <MetricBlock label="לטורקיה PS" value={money("USD", flow?.turkeyTransferUsd)} />
            {drill?.meta?.updatedByName || drill?.meta?.updatedAtDisplay ? (
              <p className="cfc-meta">
                עודכן ע״י {drill.meta.updatedByName ?? "—"} · {drill.meta.updatedAtDisplay ?? "—"}
              </p>
            ) : null}
          </div>
        ) : null}

        {!loading && tab === "fx" ? (
          <div className="cfc-detail-table-wrap">
            <table className="cfc-detail-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>סכום ₪</th>
                  <th>שער</th>
                  <th>דולר שנרכש</th>
                  <th>נשאר בקופה</th>
                  <th>הוחזר לבנק</th>
                  <th>עמלה</th>
                  <th>משתמש</th>
                </tr>
              </thead>
              <tbody>
                {(flow?.fxPurchases ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.createdAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                    <td dir="ltr">{money("ILS", p.ilsAmount)}</td>
                    <td dir="ltr">{p.rate?.toFixed(4) ?? "—"}</td>
                    <td dir="ltr">{money("USD", p.usdReceived)}</td>
                    <td dir="ltr">{money("ILS", p.remainderCashIls)}</td>
                    <td dir="ltr">{money("ILS", p.remainderBankIls)}</td>
                    <td dir="ltr">{moneyBoth(p.commissionIls?.toString(), p.commissionUsd?.toString())}</td>
                    <td>{p.createdByName ?? "—"}</td>
                  </tr>
                ))}
                {(flow?.fxPurchases?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={8} className="cfc-empty-cell">
                      אין רכישות מט״ח
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && tab === "turkey" ? (
          <div className="cfc-detail-table-wrap">
            <table className="cfc-detail-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>סוג</th>
                  <th>סכום</th>
                  <th>לפני</th>
                  <th>אחרי</th>
                  <th>הערה</th>
                  <th>משתמש</th>
                </tr>
              </thead>
              <tbody>
                {(flow?.turkeyBalance?.movements ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.createdAtDisplay}</td>
                    <td>{TURKEY_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                    <td dir="ltr">{money(m.currency, m.amount)}</td>
                    <td dir="ltr">{m.balanceBefore != null ? money(m.currency, m.balanceBefore) : "—"}</td>
                    <td dir="ltr">{m.balanceAfter != null ? money(m.currency, m.balanceAfter) : "—"}</td>
                    <td>{m.notes ?? m.reference ?? "—"}</td>
                    <td>{m.createdByName ?? "—"}</td>
                  </tr>
                ))}
                {(flow?.turkeyBalance?.movements?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={7} className="cfc-empty-cell">
                      אין תנועות לטורקיה
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && tab === "match" ? (
          <div className="cfc-detail-table-wrap">
            <table className="cfc-detail-table">
              <thead>
                <tr>
                  <th>ערוץ</th>
                  <th>התקבל</th>
                  <th>נספר</th>
                  <th>הפרש</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {matchRows.map((r) => {
                  const abs = Math.abs(r.diff);
                  const tone = abs < 0.01 ? "ok" : abs <= 50 ? "warn" : "bad";
                  return (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td dir="ltr">{money(r.currency, r.received)}</td>
                      <td dir="ltr">{money(r.currency, r.counted)}</td>
                      <td dir="ltr">{money(r.currency, r.diff)}</td>
                      <td>
                        <span className={`cfc-status cfc-status--${tone === "ok" ? "ok" : tone === "warn" ? "pending" : "alert"}`}>
                          {tone === "ok" ? "תקין" : tone === "warn" ? "סטייה קלה" : "חריג"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && tab === "diffs" ? (
          <div className="cfc-diff-grid">
            <div className={`cfc-diff-card ${Math.abs(diff) < 0.01 ? "is-ok" : Math.abs(diff) <= 50 ? "is-warn" : "is-bad"}`}>
              <h4>הפרש כללי</h4>
              <strong dir="ltr">{money("ILS", diff)}</strong>
              <p>התקבל מול ספירת מנהל</p>
            </div>
            <div className="cfc-diff-card">
              <h4>רווח מט״ח</h4>
              <strong dir="ltr">{money("ILS", fcNum(row.fxProfitIls))}</strong>
              <p>סיכום רווחים</p>
            </div>
            <div className="cfc-diff-card">
              <h4>הפסד מט״ח</h4>
              <strong dir="ltr">{money("ILS", fcNum(row.fxLossIls))}</strong>
              <p>סיכום הפסדים</p>
            </div>
            <div className="cfc-diff-card is-bad">
              <h4>חוב לטורקיה</h4>
              <strong dir="ltr">{money("USD", row.turkeyClosingUsd)}</strong>
              <p>יתרת סגירה</p>
            </div>
            {(drill?.expenses ?? []).length > 0 ? (
              <div className="cfc-detail-table-wrap cfc-detail-table-wrap--span">
                <h4 className="cfc-subhead">הוצאות השבוע</h4>
                <table className="cfc-detail-table">
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>סיבה</th>
                      <th>אמצעי</th>
                      <th>סכום</th>
                      <th>משתמש</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill!.expenses.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.dateYmd} {e.timeHm}
                        </td>
                        <td>{e.reasonLabel}</td>
                        <td>{e.paymentMethodLabel}</td>
                        <td dir="ltr">{money(e.currency, e.amount)}</td>
                        <td>{e.createdByName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <CurrencyExchangeModal
        open={fxOpen}
        week={row.week}
        weekLabel={row.weekLabel}
        availableIls={flow?.availableIlsForFx ?? "0"}
        saving={fxSaving}
        onClose={() => setFxOpen(false)}
        onSave={async (input) => {
          setFxSaving(true);
          try {
            const res = await saveFxPurchaseAction({ week: row.week, track: "PS", ...input });
            if (res.ok) {
              setFxOpen(false);
              onFxSaved();
            }
            return res;
          } finally {
            setFxSaving(false);
          }
        }}
      />
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="cfc-metric-block">
      <span>{label}</span>
      <strong dir="ltr">{value}</strong>
    </div>
  );
}
