"use client";

import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { CurrentWorkWeekButton } from "@/components/admin/CurrentWorkWeekButton";
import { AdminWeekPicker } from "@/components/admin/AdminWeekPicker";
import { DEFAULT_WEEK_CODE, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

export type ReportWeekNavProps = {
  weekCode: string | undefined;
  disabled?: boolean;
  loading?: boolean;
  /** נקרא עם קוד AH מנורמל וטווח תאריכים של השבוע */
  onWeekChange: (normalizedWeek: string, fromYmd: string, toYmd: string) => void;
};

export function ReportWeekNav({ weekCode, disabled, loading, onWeekChange }: ReportWeekNavProps) {
  const code = normalizeAhWeekCode(weekCode) ?? DEFAULT_WEEK_CODE;

  function goToActiveWeek() {
    const r = getAhWeekRange(ACTIVE_WORK_WEEK_CODE);
    if (!r) return;
    onWeekChange(ACTIVE_WORK_WEEK_CODE, r.from, r.to);
  }

  return (
    <div className="adm-report-week-nav" dir="ltr">
      <AdminWeekPicker
        weekCode={code}
        disabled={disabled}
        loading={loading}
        chipClassName="adm-report-week-nav__chip"
        arrowClassName="adm-report-week-nav__arrow"
        onWeekChange={onWeekChange}
      />
      <CurrentWorkWeekButton disabled={disabled} weekCode={code} onClick={goToActiveWeek} />
    </div>
  );
}
