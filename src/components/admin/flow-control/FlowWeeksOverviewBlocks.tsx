"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, Lock } from "lucide-react";
import { fmtDailyMoney, channelCurrency, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { allCashControlChannels, channelColLabels } from "@/lib/cash-control-channel";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

const DRAWER_COLS: CashDailyMethodId[] = allCashControlChannels();

const MANAGER_COLS: CashWeekFlowLineId[] = [
  "CASH_USD",
  "CASH_ILS",
  "CHECK",
  "CREDIT",
  "BANK_TRANSFER",
];

const COL_LABEL = channelColLabels();

const MANAGER_LABEL: Record<CashWeekFlowLineId, string> = {
  CASH_USD: "מזומן $",
  CASH_ILS: "מזומן ₪",
  CHECK: "צ'קים ₪",
  CREDIT: "אשראי ₪",
  BANK_TRANSFER: "העברה ₪",
};

function cell(value: string | null | undefined, currency: "ILS" | "USD" = "ILS"): string {
  if (!value) return "—";
  const n = fcNum(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(currency, n);
}

export type FlowWeeksOverviewBlocksProps = {
  rows: FlowWeekOverviewRow[];
  loading: boolean;
  selectedWeek: string | null;
  onSelectWeek: (week: string) => void;
  onFxProfitClick?: (week: string) => void;
};

const WEEK_COL_W = 180;
const CELL_W = 116;

const GROUPS = [
  { key: "drawer", label: "ספירת קופה", span: 6, tone: "bg-sky-50/70 dark:bg-sky-950/30" },
  { key: "manager", label: "קבלות", span: 5, tone: "bg-emerald-50/70 dark:bg-emerald-950/25" },
  { key: "commission", label: "עמלות", span: 2, tone: "bg-violet-50/70 dark:bg-violet-950/25" },
  { key: "fx", label: "מט\"ח", span: 4, tone: "bg-amber-50/70 dark:bg-amber-950/25" },
  { key: "fxpl", label: "רווח/הפסד", span: 1, tone: "bg-amber-50/70 dark:bg-amber-950/25" },
  { key: "turkey", label: "טורקיה", span: 5, tone: "bg-indigo-50/70 dark:bg-indigo-950/25" },
  { key: "expense", label: "הוצאות", span: 2, tone: "bg-orange-50/70 dark:bg-orange-950/25" },
  { key: "balance", label: "יתרות", span: 3, tone: "bg-slate-50/70 dark:bg-slate-950/25" },
] as const;

function gridTemplate(): string {
  // week + all cells
  const totalCells =
    DRAWER_COLS.length +
    MANAGER_COLS.length +
    2 + // commission
    4 + // fx
    1 + // fx pl
    5 + // turkey
    2 + // expense
    3; // balances
  return `${WEEK_COL_W}px repeat(${totalCells}, ${CELL_W}px)`;
}

function groupDividerClass(isGroupStart: boolean): string {
  return isGroupStart ? "border-l-4 border-slate-200/80 dark:border-slate-800/80" : "border-l border-slate-200/50 dark:border-slate-800/50";
}

export function FlowWeeksOverviewBlocks({
  rows,
  loading,
  selectedWeek,
  onSelectWeek,
  onFxProfitClick,
}: FlowWeeksOverviewBlocksProps) {
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(() => new Set(selectedWeek ? [selectedWeek] : []));
  useEffect(() => {
    if (!selectedWeek) return;
    setOpenWeeks((prev) => {
      if (prev.has(selectedWeek)) return prev;
      const next = new Set(prev);
      next.add(selectedWeek);
      return next;
    });
  }, [selectedWeek]);

  const tpl = useMemo(() => gridTemplate(), []);
  const isOpen = (wk: string) => openWeeks.has(wk);

  if (loading) return <p className="fc-muted">טוען סיכום שבועות…</p>;
  if (rows.length === 0) return <p className="fc-muted">אין נתונים</p>;

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/50 p-3 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/20">
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Sticky header (2 rows) */}
          <div className="sticky top-0 z-10 bg-white/90 backdrop-blur dark:bg-slate-950/80">
            <div
              className="grid items-stretch text-xs font-semibold text-slate-700 dark:text-slate-200"
              style={{ gridTemplateColumns: tpl }}
            >
              <div className="sticky left-0 z-20 flex items-center gap-2 border-b border-slate-200/70 bg-white/95 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/90">
                שבוע
              </div>
              {GROUPS.map((g, idx) => (
                <div
                  key={g.key}
                  className={[
                    "flex items-center justify-center border-b border-slate-200/70 px-2 py-2 text-center dark:border-slate-800/70",
                    g.tone,
                    idx === 0 ? "border-l border-slate-200/50 dark:border-slate-800/50" : "border-l-4 border-slate-200/80 dark:border-slate-800/80",
                  ].join(" ")}
                  style={{ gridColumn: `span ${g.span}` }}
                >
                  {g.label}
                </div>
              ))}
            </div>

            <div
              className="grid items-stretch text-[11px] text-slate-600 dark:text-slate-300"
              style={{ gridTemplateColumns: tpl }}
            >
              <div className="sticky left-0 z-20 border-b border-slate-200/70 bg-white/95 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/90">
                {/* empty spacer under 'week' */}
              </div>

              {/* Drawer columns */}
              {DRAWER_COLS.map((m, i) => (
                <div
                  key={`h-d-${m}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-sky-50/30 dark:bg-sky-950/10",
                  ].join(" ")}
                >
                  {COL_LABEL[m]}
                </div>
              ))}

              {/* Manager columns */}
              {MANAGER_COLS.map((m, i) => (
                <div
                  key={`h-m-${m}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-emerald-50/30 dark:bg-emerald-950/10",
                  ].join(" ")}
                >
                  {MANAGER_LABEL[m]}
                </div>
              ))}

              {/* Commission */}
              {["$", "₪"].map((lbl, i) => (
                <div
                  key={`h-c-${lbl}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-violet-50/30 dark:bg-violet-950/10",
                  ].join(" ")}
                >
                  {lbl}
                </div>
              ))}

              {/* FX */}
              {["רכישה ₪", "רכישה $", "נשאר בקופה", "הוחזר לבנק"].map((lbl, i) => (
                <div
                  key={`h-fx-${lbl}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-amber-50/30 dark:bg-amber-950/10",
                  ].join(" ")}
                >
                  {lbl}
                </div>
              ))}

              {/* FX PL */}
              <div
                className={[
                  "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                  groupDividerClass(true),
                  "bg-amber-50/30 dark:bg-amber-950/10",
                ].join(" ")}
              >
                רווח מט״ח
              </div>

              {/* Turkey */}
              {["פתיחה", "נוסף מספירה", "הועבר", "סגירה", "לטורקיה PS"].map((lbl, i) => (
                <div
                  key={`h-tr-${lbl}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-indigo-50/30 dark:bg-indigo-950/10",
                  ].join(" ")}
                >
                  {lbl}
                </div>
              ))}

              {/* Expense */}
              {["₪", "$"].map((lbl, i) => (
                <div
                  key={`h-ex-${lbl}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-orange-50/30 dark:bg-orange-950/10",
                  ].join(" ")}
                >
                  {lbl}
                </div>
              ))}

              {/* Balance */}
              {["קופה ₪", "קופה $", "בנק ₪"].map((lbl, i) => (
                <div
                  key={`h-b-${lbl}`}
                  className={[
                    "border-b border-slate-200/70 px-2 py-2 text-right dark:border-slate-800/70",
                    groupDividerClass(i === 0),
                    "bg-slate-50/30 dark:bg-slate-950/10",
                  ].join(" ")}
                >
                  {lbl}
                </div>
              ))}
            </div>
          </div>

          {/* Week blocks */}
          <div className="py-3">
            {rows.map((row, idx) => {
              const selected = selectedWeek === row.week;
              const open = isOpen(row.week) || selected;
              const even = idx % 2 === 0;
              const blockBg = even ? "bg-slate-50/40 dark:bg-slate-900/20" : "bg-white/60 dark:bg-slate-950/10";
              const hover = "hover:shadow-md hover:ring-1 hover:ring-slate-200/70 dark:hover:ring-slate-800/70";

              return (
                <div
                  key={row.week}
                  className={[
                    "mb-6 rounded-xl border border-slate-200/70 transition",
                    "dark:border-slate-800/70",
                    blockBg,
                    hover,
                    selected ? "ring-2 ring-sky-400/40" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right"
                    onClick={() => {
                      onSelectWeek(row.week);
                      setOpenWeeks((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.week)) next.delete(row.week);
                        else next.add(row.week);
                        return next;
                      });
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-2">
                          <strong dir="ltr" className="text-slate-900 dark:text-slate-100">
                            {row.week}
                          </strong>
                          {row.weekLabel ? (
                            <span className="text-xs text-slate-500 dark:text-slate-400">{row.weekLabel}</span>
                          ) : null}
                          {!row.hasData ? (
                            <span className="rounded-md bg-slate-200/60 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                              אין נתונים
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                          <span>
                            קופה ₪: <strong dir="ltr">{cell(row.drawerRemainingIls)}</strong>
                          </span>
                          <span>
                            קופה $: <strong dir="ltr">{cell(row.drawerRemainingUsd, "USD")}</strong>
                          </span>
                          <span>
                            בנק ₪: <strong dir="ltr">{cell(row.bankBalanceIls)}</strong>
                          </span>
                          <span>
                            לטורקיה (סגירה): <strong dir="ltr">{cell(row.turkeyClosingUsd, "USD")}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {open ? "סגור" : "פתח"}
                    </span>
                  </button>

                  {open ? (
                    <div className="px-3 pb-4">
                      <div
                        className="grid rounded-lg border border-slate-200/70 bg-white/80 text-sm dark:border-slate-800/70 dark:bg-slate-950/30"
                        style={{ gridTemplateColumns: tpl }}
                        role="group"
                        aria-label={`נתוני שבוע ${row.week}`}
                      >
                        {/* Week cell (sticky) */}
                        <div className="sticky left-0 z-10 flex items-center gap-2 border-b border-slate-200/70 bg-white/95 px-3 py-3 dark:border-slate-800/70 dark:bg-slate-950/80">
                          <strong dir="ltr">{row.week}</strong>
                        </div>

                        {/* Drawer */}
                        {DRAWER_COLS.map((m, i) => (
                          <div
                            key={`${row.week}-d-${m}`}
                            dir="ltr"
                            className={[
                              "border-b border-slate-200/70 px-2 py-3 text-right dark:border-slate-800/70",
                              groupDividerClass(i === 0),
                            ].join(" ")}
                          >
                            {cell(row.drawer[m], channelCurrency(m))}
                          </div>
                        ))}

                        {/* Manager */}
                        {MANAGER_COLS.map((m, i) => (
                          <div
                            key={`${row.week}-m-${m}`}
                            dir="ltr"
                            className={[
                              "border-b border-slate-200/70 px-2 py-3 text-right dark:border-slate-800/70",
                              groupDividerClass(i === 0),
                            ].join(" ")}
                          >
                            {cell(row.manager[m] ?? null, m === "CASH_USD" ? "USD" : "ILS")}
                          </div>
                        ))}

                        {/* Commission */}
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(true)].join(" ")}>
                          {cell(row.commissionUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.commissionIls)}
                        </div>

                        {/* FX */}
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(true)].join(" ")}>
                          {cell(row.fxPurchaseIls)}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.fxPurchaseUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.fxRemainderCashIls)}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.fxRemainderBankIls)}
                        </div>

                        {/* FX PL */}
                        <div
                          dir="ltr"
                          className={[
                            "border-b border-slate-200/70 px-2 py-3 text-right dark:border-slate-800/70",
                            groupDividerClass(true),
                          ].join(" ")}
                        >
                          <button
                            type="button"
                            className="w-full rounded-md px-1 py-1 text-right hover:bg-slate-100/80 dark:hover:bg-slate-900/40"
                            title="פירוט רווח מט״ח"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFxProfitClick?.(row.week);
                            }}
                          >
                            {(() => {
                              const net = fcNum(row.fxProfitIls) - fcNum(row.fxLossIls);
                              if (Math.abs(net) < 0.005) return "—";
                              return fmtDailyMoney("ILS", net);
                            })()}
                          </button>
                        </div>

                        {/* Turkey */}
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(true)].join(" ")}>
                          {cell(row.turkeyOpeningUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.turkeyAddedUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.turkeyTransferredUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.turkeyClosingUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.turkeyTransferUsd, "USD")}
                        </div>

                        {/* Expense */}
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(true)].join(" ")}>
                          {cell(row.expensesIls)}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.expensesUsd, "USD")}
                        </div>

                        {/* Balance */}
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(true)].join(" ")}>
                          {cell(row.drawerRemainingIls)}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.drawerRemainingUsd, "USD")}
                        </div>
                        <div dir="ltr" className={["border-b px-2 py-3 text-right", groupDividerClass(false)].join(" ")}>
                          {cell(row.bankBalanceIls)}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <Lock size={12} aria-hidden /> נתונים מבקרת קופה בלבד · לחץ על הבלוק כדי לבחור שבוע
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FlowWeeksOverviewBlocks;

