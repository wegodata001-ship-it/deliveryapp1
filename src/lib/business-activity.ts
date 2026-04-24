import type { Prisma } from "@prisma/client";

/** AuditLog.actionType values shown on the business dashboard (whitelist). */
export const DASHBOARD_BUSINESS_ACTION_TYPES = [
  "ORDER_CREATED",
  "PAYMENT_RECEIVED",
  "CUSTOMER_CREATED",
  "ORDER_UPDATED",
] as const;

export type ActivityIconKind = "order" | "payment" | "customer";

export function activityIconKind(actionType: string): ActivityIconKind {
  switch (actionType) {
    case "ORDER_CREATED":
    case "ORDER_UPDATED":
      return "order";
    case "PAYMENT_RECEIVED":
      return "payment";
    case "CUSTOMER_CREATED":
      return "customer";
    default:
      return "order";
  }
}

export function activityTitleHe(actionType: string): string {
  switch (actionType) {
    case "ORDER_CREATED":
      return "נוצרה הזמנה חדשה";
    case "PAYMENT_RECEIVED":
      return "נקלט תשלום";
    case "CUSTOMER_CREATED":
      return "לקוח חדש נוסף";
    case "ORDER_UPDATED":
      return "עודכנה הזמנה";
    default:
      return "פעולה";
  }
}

function metaRecord(metadata: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (metadata != null && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Hide generic system seed user from subtitle (business-facing). */
function actorLabel(userName: string | null | undefined): string | null {
  if (!userName?.trim()) return null;
  const n = userName.trim().toLowerCase();
  if (n === "system admin" || n === "system administrator") return null;
  return userName.trim();
}

/**
 * One subtitle line (max ~2 lines visually via CSS); built from metadata + actor.
 */
export function activityDetailLine(
  actionType: string,
  metadata: Prisma.JsonValue | null | undefined,
  userName: string | null | undefined,
): string {
  const m = metaRecord(metadata);
  const actor = actorLabel(userName);
  const parts: string[] = [];

  if (actionType === "ORDER_CREATED" || actionType === "ORDER_UPDATED") {
    const on = str(m?.orderNumber);
    const cust = str(m?.customerName);
    if (on) parts.push(`הזמנה ${on}`);
    if (cust) parts.push(cust);
  } else if (actionType === "PAYMENT_RECEIVED") {
    const on = str(m?.orderNumber);
    const code = str(m?.paymentCode);
    const cur = str(m?.currency);
    const amt = str(m?.amountDisplay);
    if (amt) parts.push(amt);
    else if (cur === "USD" && str(m?.amountUsd)) parts.push(`${str(m?.amountUsd)} USD`);
    else if (cur === "ILS" && str(m?.amountIls)) parts.push(`${str(m?.amountIls)} ₪`);
    if (on) parts.push(`הזמנה ${on}`);
    if (code) parts.push(code);
  } else if (actionType === "CUSTOMER_CREATED") {
    const cust = str(m?.customerName) ?? str(m?.displayName);
    if (cust) parts.push(cust);
    const code = str(m?.customerCode);
    if (code) parts.push(code);
  }

  if (actor) parts.push(`ע״י ${actor}`);

  return parts.join(" · ");
}
