/** Discriminated payloads for the admin window manager (no route changes). */

import type { CustomerCardSnapshot } from "@/app/admin/capture/actions";

export type AdminWindowType = "orderCapture" | "customerCard" | "createCustomer" | "payments" | "paymentsUpdated";

export type OrderCaptureWindowProps =
  | { mode: "create" }
  | { mode: "edit"; orderId: string; /** נפתח מיד מודל בקשת אישור (הזמנה נעולה) */ startWithEditRequest?: boolean };

export type CustomerCardWindowProps = {
  customerId?: string | null;
  customerName?: string | null;
  initialTab?: "details" | "ledger";
  /** נתונים שנטענו בשרת — מונע POST /admin בכניסה לדף */
  initialSnap?: CustomerCardSnapshot | null;
};

export type CreateCustomerWindowProps = {
  /** קוד שהוקלד בקליטת הזמנה לפני פתיחת החלון */
  initialCustomerCode?: string;
};

export type PaymentWindowProps = {
  paymentId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  amountIls?: string | null;
  amountUsd?: string | null;
};

export type AdminWindowPayload =
  | { type: "orderCapture"; props: OrderCaptureWindowProps }
  | { type: "customerCard"; props: CustomerCardWindowProps }
  | { type: "createCustomer"; props?: CreateCustomerWindowProps }
  | { type: "payments"; props?: PaymentWindowProps }
  | { type: "paymentsUpdated"; props?: PaymentWindowProps };

export type AdminWindowEntry = { id: string } & AdminWindowPayload;

export function newWindowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
