"use client";

import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";
import { PaymentSummaryTable } from "@/components/admin/flow-control/PaymentSummaryTable";

export type WeeklySummarySectionProps = {
  week: string;
  weekOptions: string[];
  summary: CashDailyWeekSummaryPayload | null;
  loading: boolean;
  onWeekChange: (w: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
};

export function WeeklySummarySection({
  week,
  weekOptions,
  summary,
  loading,
  onWeekChange,
  onPrevWeek,
  onNextWeek,
}: WeeklySummarySectionProps) {
  const dayRows = summary?.rows.filter((r) => !r.isTotal) ?? [];
  const totalRow = summary?.rows.find((r) => r.isTotal);

  return (
    <section className="fc-section fc-section--blue">
      <header className="fc-section__head">
        <div>
          <h2>כספים שהתקבלו</h2>
          <p className="fc-section__sub">
            <Lock size={12} aria-hidden /> נתונים מאושרים מספירת קופה — ללא עריכה · דוח ניהולי בלבד
          </p>
        </div>
        <div className="fc-week-nav">
          <button type="button" className="fc-btn fc-btn--icon" aria-label="שבוע קודם" onClick={onPrevWeek}>
            <ChevronRight size={18} />
          </button>
          <select className="fc-week-select" value={week} onChange={(e) => onWeekChange(e.target.value)}>
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button type="button" className="fc-btn fc-btn--icon" aria-label="שבוע הבא" onClick={onNextWeek}>
            <ChevronLeft size={18} />
          </button>
        </div>
      </header>
      {loading ? (
        <p className="fc-muted">טוען סיכום שבוע…</p>
      ) : (
        <PaymentSummaryTable dayRows={dayRows} totalRow={totalRow} />
      )}
    </section>
  );
}

export default WeeklySummarySection;
