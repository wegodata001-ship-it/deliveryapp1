"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import type {
  CashControlDeviationRow,
  CashControlDeviationStatus,
} from "@/lib/cash-control-deviations-shared";
import { cashControlMethodLineStatusLabel } from "@/lib/cash-control-deviations-shared";
import {
  buildDeviationSummary,
  detailDeviationTypeLabel,
  filterDeviationsByCategory,
  formatDeviationAmountUsd,
  orderMethodBreakdown,
  type DeviationSummaryCategoryId,
} from "@/lib/cash-control-deviations-view";

function deviationStatusLabel(status: CashControlDeviationStatus): string {
  if (status === "approved") return "אושר";
  if (status === "cancelled") return "בוטל";
  return "פתוח";
}

function methodLineStatusDisplay(status: "ok" | "shortfall" | "excess"): string {
  if (status === "excess") return "🔴 חריגה";
  if (status === "shortfall") return "חסר";
  return "תקין";
}

function usdAmount(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CashControlDeviationsHierarchy({
  rows,
  onOpenIntake,
}: {
  rows: CashControlDeviationRow[];
  onOpenIntake: (customerId: string | null, orderId: string | null) => void;
}) {
  const summary = useMemo(() => buildDeviationSummary(rows), [rows]);
  const [expandedCategory, setExpandedCategory] = useState<DeviationSummaryCategoryId | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const detailRows = useMemo(
    () => (expandedCategory ? filterDeviationsByCategory(rows, expandedCategory) : []),
    [rows, expandedCategory],
  );

  const breakdown = useMemo(
    () => (expandedOrderId ? orderMethodBreakdown(rows, expandedOrderId) : []),
    [rows, expandedOrderId],
  );

  function toggleCategory(id: DeviationSummaryCategoryId) {
    setExpandedOrderId(null);
    setExpandedCategory((cur) => (cur === id ? null : id));
  }

  function toggleOrder(orderId: string) {
    setExpandedOrderId((cur) => (cur === orderId ? null : orderId));
  }

  if (rows.length === 0) {
    return (
      <div className="adm-cash-dev-hier adm-cash-dev-hier--ok" role="status">
        <span aria-hidden>🟢</span>
        <span>אין חריגות בשבוע — כל הקליטות תואמות להזמנות.</span>
      </div>
    );
  }

  return (
    <section className="adm-cash-dev-hier" aria-label="חריגות בקרת קופה">
      <h3 className="adm-cash-dev-hier__title">סיכום חריגות</h3>
      <div className="adm-cash-maintbl__scroll">
        <table className="adm-table-excel adm-cash-dev-hier__tbl">
          <thead>
            <tr>
              <th className="adm-cash-dev-hier__col-expand" aria-label="הרחבה" />
              <th>סוג חריגה</th>
              <th>כמות</th>
              <th>סכום כולל</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => {
              const isOpen = expandedCategory === s.id;
              return (
                <Fragment key={s.id}>
                  <tr
                    className={`adm-cash-dev-hier__sumrow ${isOpen ? "is-open" : ""}`}
                    onClick={() => toggleCategory(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleCategory(s.id);
                      }
                    }}
                  >
                    <td className="adm-cash-dev-hier__col-expand">
                      {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronLeft size={16} aria-hidden />}
                    </td>
                    <td>{s.label}</td>
                    <td>{s.count}</td>
                    <td dir="ltr">{usdAmount(s.totalUsd)}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="adm-cash-dev-hier__detail-wrap">
                      <td colSpan={4}>
                        <div className="adm-cash-dev-hier__detail">
                          <table className="adm-table-excel adm-cash-dev-hier__detail-tbl">
                            <thead>
                              <tr>
                                <th className="adm-cash-dev-hier__col-expand" aria-label="פירוט אמצעי" />
                                <th>הזמנה</th>
                                <th>לקוח</th>
                                <th>סוג חריגה</th>
                                <th>סכום חריגה</th>
                                <th>סטטוס</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {detailRows.map((r) => {
                                const orderOpen = expandedOrderId === r.orderId;
                                const hasBreakdown = orderMethodBreakdown(rows, r.orderId).length > 0;
                                return (
                                  <Fragment key={r.id}>
                                    <tr
                                      className={`adm-cash-dev-hier__orderrow ${orderOpen ? "is-open" : ""} ${hasBreakdown ? "is-expandable" : ""}`}
                                      onClick={hasBreakdown ? () => toggleOrder(r.orderId) : undefined}
                                      role={hasBreakdown ? "button" : undefined}
                                      tabIndex={hasBreakdown ? 0 : undefined}
                                      onKeyDown={
                                        hasBreakdown
                                          ? (e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                toggleOrder(r.orderId);
                                              }
                                            }
                                          : undefined
                                      }
                                    >
                                      <td className="adm-cash-dev-hier__col-expand">
                                        {hasBreakdown ? (
                                          orderOpen ? (
                                            <ChevronDown size={14} aria-hidden />
                                          ) : (
                                            <ChevronLeft size={14} aria-hidden />
                                          )
                                        ) : null}
                                      </td>
                                      <td dir="ltr">{r.orderNumber ?? "—"}</td>
                                      <td>{r.customerName ?? "—"}</td>
                                      <td>{detailDeviationTypeLabel(r)}</td>
                                      <td dir="ltr" className="adm-cash-dev-hier__amt">
                                        {formatDeviationAmountUsd(r)}
                                      </td>
                                      <td>{deviationStatusLabel(r.status)}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="adm-cash-dev-minibtn adm-cash-dev-minibtn--primary"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onOpenIntake(r.customerId, r.orderId);
                                          }}
                                        >
                                          קליטה
                                        </button>
                                      </td>
                                    </tr>
                                    {orderOpen && breakdown.length > 0 ? (
                                      <tr className="adm-cash-dev-hier__breakdown-wrap">
                                        <td colSpan={7}>
                                          <table className="adm-cash-deviations-method-tbl adm-cash-dev-hier__method-tbl">
                                            <thead>
                                              <tr>
                                                <th>אמצעי</th>
                                                <th>תוכנן</th>
                                                <th>נקלט</th>
                                                <th>נשאר</th>
                                                <th>חריגה</th>
                                                <th>סטטוס</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {breakdown.map((line) => (
                                                <tr
                                                  key={`${r.orderId}-${line.method}`}
                                                  className={`adm-cash-deviations-method-tbl__line is-${line.lineStatus}`}
                                                >
                                                  <td>{line.methodLabel}</td>
                                                  <td dir="ltr">${line.plannedUsd}</td>
                                                  <td dir="ltr">${line.receivedUsd}</td>
                                                  <td dir="ltr">${line.remainingUsd}</td>
                                                  <td dir="ltr" className="adm-cash-deviations-method-tbl__dev">
                                                    {line.deviationUsd ?? "—"}
                                                  </td>
                                                  <td>{methodLineStatusDisplay(line.lineStatus)}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </td>
                                      </tr>
                                    ) : null}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
