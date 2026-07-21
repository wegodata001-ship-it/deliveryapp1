"use client";

/**
 * זרימת כסף ניהולית — הפרדה מלאה בין מסלול PS (מזומן קופה) למסלול IL (בנק).
 * שני המסלולים מוצגים ומחושבים בנפרד — ללא איחוד PS+IL.
 * תצוגה בלבד: כל המספרים מגיעים מ-FlowWeekPayload / overview (מקור אמת שרת).
 */
import type { ReactNode } from "react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  money,
  moneyBoth,
  weekFxNetIls,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { fcNum } from "@/components/admin/flow-control/shared";
import {
  computeIlFxPurchaseIls,
  computeTurkeyAllocationFromCashCount,
  computeTurkeyIlAllocationIls,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export type FlowMoneyJourneyPanelProps = {
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
  loading?: boolean;
};

function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`cfc-journey__kv${strong ? " is-strong" : ""}`}>
      <span>{label}</span>
      <strong dir="ltr">{value}</strong>
    </div>
  );
}

function PathZone({
  path,
  title,
  subtitle,
  children,
  totalLabel,
  totalValue,
}: {
  path: "ps" | "il";
  title: string;
  subtitle: string;
  children: ReactNode;
  totalLabel: string;
  totalValue: string;
}) {
  return (
    <article className={`cfc-path-zone cfc-path-zone--${path}`} aria-label={title}>
      <header className="cfc-path-zone__head">
        <span className={`cfc-path-zone__badge cfc-path-zone__badge--${path}`}>{path.toUpperCase()}</span>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="cfc-path-zone__body">{children}</div>
      <footer className="cfc-path-zone__total">
        <span>{totalLabel}</span>
        <strong dir="ltr">{totalValue}</strong>
      </footer>
    </article>
  );
}

export function FlowMoneyJourneyPanel({ row, drill, loading }: FlowMoneyJourneyPanelProps) {
  const flow = drill?.flow ?? null;
  const intake = drill?.paymentIntake;
  const fxNet = weekFxNetIls(row);

  const cashIls = fcNum(flow?.counted.CASH_ILS ?? intake?.CASH_ILS);
  const cashUsd = fcNum(flow?.counted.CASH_USD ?? intake?.CASH_USD);
  const transferIls = fcNum(flow?.counted.BANK_TRANSFER);
  const creditIls = fcNum(flow?.counted.CREDIT);
  const checksIls = fcNum(flow?.counted.CHECK);

  const fxPs = flow
    ? sumFxPurchases(flow.fxPurchases, "PS")
    : { ils: fcNum(row.fxPurchaseIls), usd: fcNum(row.fxPurchaseUsd) };
  const commissionPs = fcNum(flow?.commissionUsd ?? row.commissionUsd);
  const commissionIl = fcNum(flow?.commissionIls ?? row.commissionIls);

  const fxIlIls = flow
    ? fcNum(flow.ilFxPurchaseIls) ||
      computeIlFxPurchaseIls(transferIls, creditIls, checksIls)
    : computeIlFxPurchaseIls(transferIls, creditIls, checksIls);

  const turkeyPsUsd = computeTurkeyAllocationFromCashCount(cashUsd, fxPs.usd, commissionPs);
  const turkeyIlIls = computeTurkeyIlAllocationIls(fxIlIls, commissionIl);

  const actualTurkeyUsd = (() => {
    const fromBalance = flow?.turkeyBalance?.actualTransfersUsd ?? flow?.turkeyBalance?.usd.transferred;
    if (typeof fromBalance === "number") return fromBalance;
    return fcNum(row.turkeyTransferredUsd);
  })();

  const cashDiff =
    fcNum(intake?.CASH_ILS) - fcNum(flow?.counted.CASH_ILS) - fcNum(flow?.expensesIls);
  const balanced = row.hasData && Math.abs(cashDiff) <= 1 && fxNet >= -0.01;

  return (
    <section className={`cfc-journey${loading ? " is-loading" : ""}`} aria-label="זרימת כסף — מסלולי PS ו-IL">
      <div className="cfc-journey__hero">
        <div>
          <h2>זרימת הכסף השבוע — שני מסלולים נפרדים</h2>
          <p>
            מסלול PS (מזומן קופה) ומסלול IL (בנק) מחושבים בנפרד לחלוטין ·{" "}
            <span dir="ltr">{row.week}</span>
          </p>
        </div>
        <div className={`cfc-journey__status cfc-journey__status--${balanced ? "ok" : "warn"}`}>
          {balanced ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{balanced ? "השבוע מאוזן" : "יש חריגה / לא הושלמה התאמה"}</span>
        </div>
      </div>

      <div className="cfc-journey__paths" aria-label="מסלולי PS ו-IL">
        <PathZone
          path="ps"
          title="מסלול PS — מזומן קופה"
          subtitle="הכסף שנמצא פיזית בקופה · ספירה → המרה → העברה לטורקיה"
          totalLabel="סה״כ העברה לטורקיה PS"
          totalValue={money("USD", turkeyPsUsd)}
        >
          <KV label="מזומן ₪" value={money("ILS", cashIls)} />
          <KV label="מזומן $" value={money("USD", cashUsd)} />
          <KV label='רכישת מט״ח PS (₪)' value={money("ILS", fxPs.ils)} />
          <KV label='רכישת מט״ח PS ($)' value={money("USD", fxPs.usd)} />
          <KV label="עמלת PS" value={money("USD", commissionPs)} />
          <KV
            label="הרכבה: מזומן $ + מט״ח PS + עמלה"
            value={money("USD", turkeyPsUsd)}
            strong
          />
        </PathZone>

        <PathZone
          path="il"
          title="מסלול IL — בנק"
          subtitle="אשראי · צ׳קים · העברות · ללא מזומן קופה"
          totalLabel="סה״כ העברה לטורקיה IL"
          totalValue={money("ILS", turkeyIlIls)}
        >
          <KV label="העברות בנקאיות" value={money("ILS", transferIls)} />
          <KV label="צ׳קים" value={money("ILS", checksIls)} />
          <KV label="אשראי" value={money("ILS", creditIls)} />
          <KV label='רכישת מט״ח IL' value={money("ILS", fxIlIls)} strong />
          <KV label="עמלת IL" value={money("ILS", commissionIl)} />
          <KV
            label="הרכבה: מט״ח IL + עמלה IL"
            value={money("ILS", turkeyIlIls)}
            strong
          />
        </PathZone>
      </div>

      <article className="cfc-path-combine" aria-label="העברות לטורקיה לפי מסלול">
        <header>
          <h3>העברות לטורקיה — לפי מסלול</h3>
          <p>PS ו-IL נשארים נפרדים גם כאן · אין סכום מאוחד</p>
        </header>
        <div className="cfc-path-combine__grid">
          <KV label="העברת PS $" value={money("USD", turkeyPsUsd)} strong />
          <KV label="העברת IL ₪" value={money("ILS", turkeyIlIls)} strong />
          <KV label="הועבר בפועל PS (פנקס)" value={money("USD", actualTurkeyUsd)} />
          <KV
            label="יתרת מזומן PS"
            value={moneyBoth(row.drawerRemainingIls, row.drawerRemainingUsd)}
          />
          <KV label="רווח שער (מט״ח PS)" value={money("ILS", fxNet)} />
        </div>
      </article>
    </section>
  );
}

export default FlowMoneyJourneyPanel;
