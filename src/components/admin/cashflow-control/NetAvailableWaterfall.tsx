"use client";

import type { NetBreakdownLine } from "@/lib/flow-control/services/net-available-breakdown.shared";
import { money, signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";

function lineClass(line: NetBreakdownLine): string {
  if (line.sign === "subtotal") return "cfc-waterfall__line--total";
  if (line.isConversion) return "cfc-waterfall__line--transfer";
  if (line.sign === "−") return "cfc-waterfall__line--out";
  if (line.sign === "+") return "cfc-waterfall__line--in";
  return "cfc-waterfall__line--opening";
}

export function NetAvailableWaterfall({
  lines,
  compact = false,
}: {
  lines: NetBreakdownLine[];
  compact?: boolean;
}) {
  return (
    <div className={`cfc-waterfall${compact ? " cfc-waterfall--compact" : ""}`}>
      {lines.map((line) => (
        <div key={line.id} className={`cfc-waterfall__line ${lineClass(line)}`}>
          <span className="cfc-waterfall__sign">
            {line.sign === "subtotal" ? "" : line.sign}
          </span>
          <span className="cfc-waterfall__label">
            {line.label}
            {line.isConversion ? (
              <em className="cfc-waterfall__tag" title="המרת נכס — לא הוצאה">
                המרה
              </em>
            ) : null}
          </span>
          <span className="cfc-waterfall__amount" dir="ltr">
            {line.sign === "subtotal" && line.section === "net"
              ? signedMoney("ILS", line.amount)
              : money("ILS", line.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function NetAvailableHelpTooltip() {
  return (
    <span
      className="cfc-help-tip"
      title="הסכום בשקלים שנשאר זמין לאחר יתרת הפתיחה וכל התקבולים, ההוצאות, ההעברות ורכישות המט״ח שנרשמו בשבוע. נוסחה: ברוטו מזומן ₪ + יתרת בנק ₪."
      aria-label="מה זה יתרת שקלים זמינה?"
    >
      ?
    </span>
  );
}
