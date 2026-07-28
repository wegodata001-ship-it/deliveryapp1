/**
 * סינון גבייה לפי אמצעי תשלום — SSOT מפירוט שורות התשלום (לא מדמי משלוח).
 * תומך בבחירה בודדת או מרובה (OR בתוך המסנן).
 */
import type { ShipmentPaymentLineDto, ShipmentRecordDto } from "@/app/admin/shipments/types";
import { normalizePaymentMethodId } from "@/lib/payment-method-slugs";

export type ShipmentPaymentMethodOption = {
  id: string;
  label: string;
};

function normalizeMethodIds(methodIds: string | string[] | null | undefined): string[] {
  if (methodIds == null) return [];
  const list = Array.isArray(methodIds) ? methodIds : [methodIds];
  return [
    ...new Set(
      list
        .map((m) => normalizePaymentMethodId(String(m ?? "").trim()))
        .filter(Boolean),
    ),
  ];
}

/** סכום שנגבה בשורות התשלום לפי אמצעי אחד/רבים (או הכל אם ריק) */
export function sumCollectedByPaymentMethod(
  payments: ShipmentPaymentLineDto[] | null | undefined,
  methodId: string | string[] | null | undefined,
): number {
  if (!payments?.length) return 0;
  const wants = normalizeMethodIds(methodId);
  const wantSet = wants.length ? new Set(wants) : null;
  let sum = 0;
  for (const p of payments) {
    const method = normalizePaymentMethodId(p.method);
    if (wantSet && !wantSet.has(method)) continue;
    const amount = Number(p.amountIls);
    if (Number.isFinite(amount)) sum += amount;
  }
  return Math.round(sum * 100) / 100;
}

/** האם למשלוח יש לפחות תשלום באחד מהאמצעים שנבחרו */
export function recordHasPaymentMethod(
  record: ShipmentRecordDto,
  methodId: string | string[] | null | undefined,
): boolean {
  const wants = normalizeMethodIds(methodId);
  if (wants.length === 0) return true;
  const wantSet = new Set(wants);
  return (record.payments ?? []).some(
    (p) => wantSet.has(normalizePaymentMethodId(p.method)) && Number(p.amountIls) > 0.005,
  );
}

export function filterRecordsByPaymentMethod(
  records: ShipmentRecordDto[],
  methodId: string | string[] | null | undefined,
): ShipmentRecordDto[] {
  const wants = normalizeMethodIds(methodId);
  if (wants.length === 0) return records;
  return records.filter((r) => recordHasPaymentMethod(r, wants));
}

export function sumRecordsCollectedByPaymentMethod(
  records: ShipmentRecordDto[],
  methodId: string | string[] | null | undefined,
): number {
  return (
    Math.round(
      records.reduce((s, r) => s + sumCollectedByPaymentMethod(r.payments, methodId), 0) * 100,
    ) / 100
  );
}

/** תאריך תשלום בפועל משורת תשלום (details.paymentDate או createdAt) */
export function paymentLineYmd(payment: ShipmentPaymentLineDto): string | null {
  const fromDetails = payment.details?.paymentDate?.trim().slice(0, 10);
  if (fromDetails && /^\d{4}-\d{2}-\d{2}$/.test(fromDetails)) return fromDetails;
  const created = payment.createdAt?.trim().slice(0, 10);
  if (created && /^\d{4}-\d{2}-\d{2}$/.test(created)) return created;
  return null;
}

/** האם למשלוח יש תשלום ביום נתון (אופציונלית רק באמצעים שנבחרו) */
export function recordHasPaymentOnDate(
  record: ShipmentRecordDto,
  ymd: string | null | undefined,
  methodId?: string | string[] | null,
): boolean {
  const day = ymd?.trim().slice(0, 10);
  if (!day) return true;
  const wants = normalizeMethodIds(methodId);
  const wantSet = wants.length ? new Set(wants) : null;
  return (record.payments ?? []).some((p) => {
    if (wantSet && !wantSet.has(normalizePaymentMethodId(p.method))) return false;
    return paymentLineYmd(p) === day;
  });
}
