/** Discriminated payloads for the admin window manager (no route changes). */

export type AdminWindowType = "orderCapture" | "customerCard" | "createCustomer" | "payments";

export type OrderCaptureWindowProps = { mode: "create" } | { mode: "edit"; orderId: string };

export type CustomerCardWindowProps = {
  customerId?: string | null;
};

export type AdminWindowPayload =
  | { type: "orderCapture"; props: OrderCaptureWindowProps }
  | { type: "customerCard"; props: CustomerCardWindowProps }
  | { type: "createCustomer" }
  | { type: "payments" };

export type AdminWindowEntry = { id: string } & AdminWindowPayload;

export function newWindowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
