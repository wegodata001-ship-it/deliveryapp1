function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export const RESET_OPERATION_AUDIT_TYPES = [
  "ORDER_COMMISSION_RESET",
  "ORDER_BALANCE_RESET",
  "CUSTOMER_BALANCES_RESET",
] as const;

export type ResetOperationAudit = {
  id: string;
  actionType: string;
  createdAt: Date;
  metadata?: unknown;
};

/** מזהה פעולה עסקית אחת — כמה audit records באותה טרנזקציה. */
export function resetOperationId(input: {
  createdAt: Date;
  metadata?: unknown;
}): string {
  return `op:${input.createdAt.toISOString()}`;
}

export function isGroupedResetAuditType(actionType: string): boolean {
  return (RESET_OPERATION_AUDIT_TYPES as readonly string[]).includes(actionType);
}

export function auditOrderAmountUnchanged(metadata: unknown): boolean {
  const meta = asRecord(metadata);
  return meta?.orderAmountUnchanged === true;
}

/**
 * פעולת איפוס אחת = השפעה כספית אחת על חוב.
 * אם ההזמנה לא השתנתה (רק עמלה / audit) — אין השפעה על running debt.
 */
export function resetOperationAffectsRunningDebt(input: {
  audits: Array<{ metadata?: unknown }>;
  draftAffectsRunningBalance: boolean;
}): boolean {
  if (!input.draftAffectsRunningBalance) return false;
  if (input.audits.some((a) => auditOrderAmountUnchanged(a.metadata))) return false;
  return true;
}

export function groupAuditsByResetOperation<T extends ResetOperationAudit>(
  audits: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const audit of audits) {
    if (!isGroupedResetAuditType(audit.actionType)) continue;
    const key = resetOperationId(audit);
    const list = groups.get(key) ?? [];
    list.push(audit);
    groups.set(key, list);
  }
  return groups;
}
