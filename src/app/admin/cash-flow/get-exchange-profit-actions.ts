"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  loadExchangeProfitOrderDetail,
  loadExchangeProfitWeekSummary,
} from "@/lib/flow-control/services/exchange-profit-service";
import type {
  ExchangeProfitOrderDetailDto,
  ExchangeProfitWeekSummaryDto,
} from "@/app/admin/cash-flow/exchange-profit-types";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getExchangeProfitWeekSummaryAction(
  week: string,
): Promise<ExchangeProfitWeekSummaryDto | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadExchangeProfitWeekSummary(week.trim());
}

export async function getExchangeProfitOrderDetailAction(input: {
  week: string;
  orderId: string;
}): Promise<ExchangeProfitOrderDetailDto | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadExchangeProfitOrderDetail(input.week.trim(), input.orderId.trim());
}
