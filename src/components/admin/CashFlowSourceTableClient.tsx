"use client";

import { useEffect, useState } from "react";
import { getCashFlowCapabilitiesAction } from "@/app/admin/cash-flow/actions";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import { CashflowControlScreen } from "@/components/admin/cashflow-control/CashflowControlScreen";

const DEFAULT_CAPS: CashFlowCapabilities = {
  canView: false,
  canCountCreate: false,
  canCountEdit: false,
  canCountApprove: false,
  canExpenseCreate: false,
  canExpenseEdit: false,
  canExpenseDelete: false,
  canExport: false,
  canManageFlow: false,
};

/** טבלת מקור — אותו מסך חדש של בקרת תזרים */
export function CashFlowSourceTableClient() {
  const [caps, setCaps] = useState<CashFlowCapabilities>(DEFAULT_CAPS);

  useEffect(() => {
    void getCashFlowCapabilitiesAction().then((c) => setCaps(c ?? DEFAULT_CAPS));
  }, []);

  return <CashflowControlScreen caps={caps} initialWeek={ACTIVE_WORK_WEEK_CODE} />;
}
