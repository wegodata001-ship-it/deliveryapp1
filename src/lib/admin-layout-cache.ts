import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { PAYMENT_METHOD_AUTO_ADJUSTED_ACTION, parsePaymentMethodAutoAdjustedAuditMetadata } from "@/lib/payment-method-adjustment-audit";
import {
  getCurrentFinancialSettingsWithUser,
  serializeFinancialSettings,
  serializeFinancialRowFromDb,
  type SerializedFinancial,
} from "@/lib/financial-settings";
import { logFinanceLoadedValues, logFinanceSourceTable } from "@/lib/finance-log";
import { OrderEditRequestStatus, ApprovalRequestStatus, ApprovalRequestType } from "@prisma/client";

export const FINANCIAL_LAYOUT_CACHE_TAG = "wego-admin-financial-layout";

/** הגדרות כספים ל-layout — cache 5 דקות, ללא ensure/insert ב-hot path */
export const getLayoutFinancialSettings = unstable_cache(
  async (): Promise<SerializedFinancial | null> => {
    logFinanceSourceTable("admin-layout");
    const row = await getCurrentFinancialSettingsWithUser();
    const out = serializeFinancialSettings(row);
    if (out) {
      logFinanceLoadedValues("admin-layout", {
        id: row?.id ?? null,
        baseDollarRate: out.baseDollarRate,
        dollarFee: out.dollarFee,
        finalDollarRate: out.finalDollarRate,
        defaultCommissionPercent: out.defaultCommissionPercent,
      });
    } else {
      const defaults = serializeFinancialRowFromDb(null);
      logFinanceLoadedValues("admin-layout", {
        id: null,
        baseDollarRate: defaults.baseDollarRate,
        dollarFee: defaults.dollarFee,
        finalDollarRate: defaults.finalDollarRate,
        defaultCommissionPercent: defaults.defaultCommissionPercent,
      });
    }
    return out;
  },
  [FINANCIAL_LAYOUT_CACHE_TAG],
  { revalidate: 300, tags: [FINANCIAL_LAYOUT_CACHE_TAG] },
);

/** ספירת בקשות עריכה ממתינות — cache 45 שניות, ללא DDL bootstrap */
export const getPendingOrderEditRequestCount = unstable_cache(
  async (): Promise<number> => {
    return prisma.orderEditRequest.count({
      where: { status: OrderEditRequestStatus.PENDING },
    });
  },
  ["wego-pending-order-edit-requests"],
  { revalidate: 45 },
);

/** ספירת בקשות ביטול חשבונית ממתינות */
export const getPendingInvoiceCancelRequestCount = unstable_cache(
  async (): Promise<number> => {
    try {
      const { ensureApprovalRequestTablesOnce } = await import("@/lib/approval-request-bootstrap");
      await ensureApprovalRequestTablesOnce();
      return prisma.approvalRequest.count({
        where: {
          type: ApprovalRequestType.INVOICE_CANCEL,
          status: ApprovalRequestStatus.PENDING,
          requestedBy: { role: { not: "ADMIN" } },
        },
      });
    } catch {
      return 0;
    }
  },
  ["wego-pending-invoice-cancel-requests"],
  { revalidate: 45 },
);

export const getPendingPaymentMethodAdjustmentCount = unstable_cache(
  async (): Promise<number> => {
    const logs = await prisma.auditLog.findMany({
      where: { actionType: PAYMENT_METHOD_AUTO_ADJUSTED_ACTION },
      select: { metadata: true },
    });
    return logs.reduce((sum, log) => {
      const details = parsePaymentMethodAutoAdjustedAuditMetadata(log.metadata);
      return sum + (details && !details.reviewedAtIso ? 1 : 0);
    }, 0);
  },
  ["wego-pending-payment-method-adjustments"],
  { revalidate: 45 },
);
