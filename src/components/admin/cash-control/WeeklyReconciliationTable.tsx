"use client";

import { Fragment, type CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { fmtDailyMoney, channelCurrency, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { channelColLabels } from "@/lib/cash-control-channel";
import type { CashDailySummaryRowDto } from "@/app/admin/cash-control/daily-types";
import {
  CASH_CONTROL_TABLE_METHODS,
  MethodIcon,
  StatusIcon,
  num,
  statusLabel,
} from "@/components/admin/cash-flow/shared";
import {
  SHIPPING_CASH_METHOD_LABELS,
  SHIPPING_CASH_TABLE_METHODS,
} from "@/components/admin/cash-control/shipping-table-config";
import { PaymentMethodColorDot } from "@/components/admin/PaymentMethodColorDot";
import { getPaymentMethodUI } from "@/lib/payment-method-ui";

const METHOD_HEADER = channelColLabels();

export type CashControlTableMode = "regular" | "shipping";

function methodGroupClass(_mode: CashControlTableMode, method: string): string {
  return getPaymentMethodUI(method).cssClass;
}

function methodColumnStyle(method: string): CSSProperties {
  const ui = getPaymentMethodUI(method);
  return {
    ["--pm-bg" as string]: ui.background,
    ["--pm-border" as string]: ui.border,
    ["--pm-text" as string]: ui.textColor,
  };
}

function amountLinkStyle(method: string): CSSProperties {
  return { color: getPaymentMethodUI(method).textColor };
}

function methodLabel(mode: CashControlTableMode, method: string): string {
  if (mode === "shipping") return SHIPPING_CASH_METHOD_LABELS[method] ?? method;
  return METHOD_HEADER[method as CashDailyMethodId];
}

function fmtPaid(mode: CashControlTableMode, method: string, value: string): string {
  const n = num(value);
  if (n <= 0) return "—";
  if (mode === "shipping") return fmtDailyMoney("ILS", n);
  return fmtDailyMoney(channelCurrency(method as CashDailyMethodId), n);
}

function fmtReceived(mode: CashControlTableMode, method: string, value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = num(value);
  if (n <= 0) return "—";
  if (mode === "shipping") return fmtDailyMoney("ILS", n);
  return fmtDailyMoney(channelCurrency(method as CashDailyMethodId), n);
}

function intakeValue(row: CashDailySummaryRowDto, method: string): string {
  return (row.intake as Record<string, string>)[method] ?? "0";
}

function drawerValue(row: CashDailySummaryRowDto, method: string): string | null | undefined {
  return (row.drawer as Partial<Record<string, string | null>>)[method];
}

export type WeeklyReconciliationTableProps = {
  mode?: CashControlTableMode;
  dayRows: CashDailySummaryRowDto[];
  totalRow: CashDailySummaryRowDto | undefined;
  selectedDay: string | null;
  activeDrill: string | null;
  onSelectDay: (row: CashDailySummaryRowDto) => void;
  onPaidClick: (row: CashDailySummaryRowDto, method: string) => void;
  onReceivedClick: (row: CashDailySummaryRowDto, method: string) => void;
  onVarianceClick?: (row: CashDailySummaryRowDto) => void;
};

/** טבלת שבוע — זוגות שולם/נקלט (קליטה) / התקבל/נספר (ספירה) לכל אמצעי תשלום */
export function WeeklyReconciliationTable({
  mode = "regular",
  dayRows,
  totalRow,
  selectedDay,
  activeDrill,
  onSelectDay,
  onPaidClick,
  onReceivedClick,
  onVarianceClick,
}: WeeklyReconciliationTableProps) {
  const tableMethods = mode === "shipping" ? SHIPPING_CASH_TABLE_METHODS : CASH_CONTROL_TABLE_METHODS;
  const paidLabel = mode === "shipping" ? "נקלט" : "שולם";
  const receivedLabel = mode === "shipping" ? "נספר" : "התקבל";
  const infoThirdLabel = mode === "shipping" ? "סוג" : "מדינה";

  return (
    <div className="cc-summary__scroll">
      <table className="cc-table cc-table--pairs">
        <thead>
          <tr className="cc-table__group-row">
            <th colSpan={3} className="cc-col--info">
              מידע כללי
            </th>
            {tableMethods.map((m) => (
              <th
                key={m}
                colSpan={2}
                className={methodGroupClass(mode, m)}
                style={methodColumnStyle(m)}
              >
                <span className="cc-group-head">
                  {mode === "regular" ? <MethodIcon method={m as CashDailyMethodId} size={13} /> : null}
                  <PaymentMethodColorDot method={m} label={methodLabel(mode, m)} size={8} />
                </span>
              </th>
            ))}
            <th colSpan={2} className="cc-col--status">
              סטטוס
            </th>
          </tr>
          <tr>
            <th className="cc-col--info">יום</th>
            <th className="cc-col--info">תקופה</th>
            <th className="cc-col--info cc-col--sep">{infoThirdLabel}</th>
            {tableMethods.map((m) => (
              <Fragment key={m}>
                <th
                  className={`cc-num ${methodGroupClass(mode, m)}`}
                  style={methodColumnStyle(m)}
                >
                  {paidLabel}
                </th>
                <th
                  className={`cc-num ${methodGroupClass(mode, m)} cc-col--sep`}
                  style={methodColumnStyle(m)}
                >
                  <span className="cc-pair-hint">
                    <ArrowDown size={10} aria-hidden />
                    {receivedLabel}
                  </span>
                </th>
              </Fragment>
            ))}
            <th className="cc-num cc-col--status">הפרש</th>
            <th className="cc-col--status">מצב</th>
          </tr>
        </thead>
        <tbody>
          {dayRows.map((row) => {
            const active = selectedDay === row.dateYmd;
            return (
              <tr
                key={row.dateYmd}
                className={`cc-row cc-row--day is-${row.status}${active ? " is-selected" : ""}`}
                onClick={() => onSelectDay(row)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelectDay(row);
                }}
              >
                <td className="cc-daycell cc-col--info">{row.dayName}</td>
                <td className="cc-col--info">{row.dateDisplay}</td>
                <td className="cc-col--info cc-col--sep">{row.countryLabel}</td>
                {tableMethods.map((m) => {
                  const paid = num(intakeValue(row, m));
                  const recv = drawerValue(row, m);
                  const paidClickable = paid > 0;
                  const drillActive = active && activeDrill === m;
                  const columnClasses = methodGroupClass(mode, m);
                  const colStyle = methodColumnStyle(m);
                  const amountStyle = amountLinkStyle(m);
                  return (
                    <Fragment key={m}>
                      <td dir="ltr" className={`cc-num ${columnClasses}`} style={colStyle}>
                        {paidClickable ? (
                          <button
                            type="button"
                            className={`cc-amount-link cc-amount-link--pm${drillActive ? " is-active" : ""}`}
                            style={amountStyle}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPaidClick(row, m);
                            }}
                          >
                            {fmtPaid(mode, m, intakeValue(row, m))}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td dir="ltr" className={`cc-num ${columnClasses} cc-col--sep`} style={colStyle}>
                        <button
                          type="button"
                          className="cc-amount-link cc-amount-link--pm cc-amount-link--count"
                          style={amountStyle}
                          onClick={(e) => {
                            e.stopPropagation();
                            onReceivedClick(row, m);
                          }}
                        >
                          {fmtReceived(mode, m, recv)}
                        </button>
                      </td>
                    </Fragment>
                  );
                })}
                <td dir="ltr" className={`cc-num cc-diff is-${row.status} cc-col--status`}>
                  {row.diff != null && row.status !== "pending" && Math.abs(num(row.diff)) > 0.009 ? (
                    <button
                      type="button"
                      className="cc-variance-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onVarianceClick?.(row);
                      }}
                      title="פירוט חריגה"
                    >
                      {fmtDailyMoney(row.diffCurrency ?? "ILS", num(row.diff))}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="cc-col--status">
                  {onVarianceClick ? (
                    <button
                      type="button"
                      className={`cc-badge cc-badge--clickable is-${row.status}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onVarianceClick(row);
                      }}
                      title="פירוט סטטוס"
                    >
                      <StatusIcon kind={row.status} size={12} />
                      {statusLabel(row.status)}
                    </button>
                  ) : (
                    <span className={`cc-badge is-${row.status}`}>
                      <StatusIcon kind={row.status} size={12} />
                      {statusLabel(row.status)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {totalRow ? (
            <tr className="cc-row cc-row--total">
              <td colSpan={3} className="cc-col--info cc-col--sep">
                <strong>{totalRow.dateDisplay}</strong>
              </td>
              {tableMethods.map((m) => {
                const amountStyle = amountLinkStyle(m);
                const colStyle = methodColumnStyle(m);
                return (
                  <Fragment key={m}>
                    <td
                      dir="ltr"
                      className={`cc-num ${methodGroupClass(mode, m)}`}
                      style={colStyle}
                    >
                      <strong className="cc-amount-strong cc-amount-link--pm" style={amountStyle}>
                        {fmtPaid(mode, m, intakeValue(totalRow, m))}
                      </strong>
                    </td>
                    <td
                      dir="ltr"
                      className={`cc-num ${methodGroupClass(mode, m)} cc-col--sep`}
                      style={colStyle}
                    >
                      <strong className="cc-amount-strong cc-amount-link--pm" style={amountStyle}>
                        {fmtReceived(mode, m, drawerValue(totalRow, m))}
                      </strong>
                    </td>
                  </Fragment>
                );
              })}
              <td colSpan={2} className="cc-col--status" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default WeeklyReconciliationTable;
