import type { CaptureCustomerSnapshotInput } from "@/lib/capture-form-snapshot";
import { capturePerfLog } from "@/lib/capture-perf";
import { isCustomerCodeTaken, normalizeCustomerCodeInput } from "@/lib/customer-code";
import { recordActivityAudit } from "@/lib/activity-audit";
import { prisma } from "@/lib/prisma";
import { scheduleRevalidateAfterCustomerCreate } from "@/lib/revalidate-customer-create";

export type CaptureCustomerRow = {
  id: string;
  customerCode: string | null;
  displayName: string;
  customerType: string | null;
  nameAr: string | null;
  nameEn: string | null;
  nameHe: string | null;
};

export type ResolveCustomerForCaptureResult = {
  customer: CaptureCustomerRow;
  /** נוצר עכשיו בטבלת Customer (לא היה קיים לפני שמירת ההזמנה) */
  created: boolean;
};

const CUSTOMER_SELECT = {
  id: true,
  customerCode: true,
  displayName: true,
  customerType: true,
  nameAr: true,
  nameEn: true,
  nameHe: true,
  isActive: true,
  deletedAt: true,
} as const;

function toCaptureRow(row: {
  id: string;
  customerCode: string | null;
  displayName: string;
  customerType: string | null;
  nameAr: string | null;
  nameEn: string | null;
  nameHe: string | null;
}): CaptureCustomerRow {
  return {
    id: row.id,
    customerCode: row.customerCode,
    displayName: row.displayName,
    customerType: row.customerType,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    nameHe: row.nameHe,
  };
}

function isActiveCustomer(row: { isActive: boolean; deletedAt: Date | null }): boolean {
  return row.isActive && row.deletedAt == null;
}

async function logCustomerTableStats(created: boolean): Promise<void> {
  const total = await prisma.customer.count({ where: { deletedAt: null } });
  capturePerfLog({
    customersInCustomerTable: total,
    customerCreatedFromOrderCapture: created,
  });
  if (process.env.NODE_ENV === "development" || process.env.CAPTURE_PERF === "1") {
    console.info("[capture] customers in Customer table (deletedAt=null):", total);
  }
}

/**
 * מקור יחיד ללקוח בשמירת הזמנה: DB קודם, אחר כך קוד, ואם חסר — create ב-Customer.
 * לא מסתמך על snapshot בלבד (מנע הזמנה עם customerId בלי שורת Customer).
 */
export async function resolveCustomerForCapture(params: {
  customerId: string;
  snapshot?: CaptureCustomerSnapshotInput | null;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  actorUserId?: string | null;
}): Promise<ResolveCustomerForCaptureResult | null> {
  const id = params.customerId.trim();
  if (!id) return null;

  const snap = params.snapshot?.id === id ? params.snapshot : null;
  const code = normalizeCustomerCodeInput(snap?.customerCode ?? "");
  const nameAr = (params.draftNameAr?.trim() || snap?.nameAr?.trim() || snap?.displayName?.trim() || "").trim();
  const nameEn = params.draftNameEn?.trim() || snap?.nameEn?.trim() || null;

  const byId = await prisma.customer.findUnique({
    where: { id },
    select: CUSTOMER_SELECT,
  });
  if (byId && isActiveCustomer(byId)) {
    return { customer: toCaptureRow(byId), created: false };
  }

  if (code) {
    const byCode = await prisma.customer.findFirst({
      where: {
        customerCode: { equals: code, mode: "insensitive" },
        deletedAt: null,
        isActive: true,
      },
      select: CUSTOMER_SELECT,
    });
    if (byCode) {
      return { customer: toCaptureRow(byCode), created: false };
    }
  }

  if (!code || !nameAr) {
    capturePerfLog({
      customerResolveFailed: true,
      reason: "missing_code_or_name",
      customerId: id,
      hasCode: !!code,
      hasName: !!nameAr,
    });
    return null;
  }

  if (await isCustomerCodeTaken(code)) {
    const existing = await prisma.customer.findFirst({
      where: { customerCode: { equals: code, mode: "insensitive" }, deletedAt: null, isActive: true },
      select: CUSTOMER_SELECT,
    });
    if (existing) return { customer: toCaptureRow(existing), created: false };
    return null;
  }

  const typeSnap = snap?.customerType?.trim() || "רגיל";
  const created = await prisma.customer.create({
    data: {
      id,
      customerCode: code,
      displayName: nameAr,
      nameAr,
      nameEn,
      customerType: typeSnap || "רגיל",
      isActive: true,
    },
    select: {
      id: true,
      customerCode: true,
      displayName: true,
      customerType: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
    },
  });

  scheduleRevalidateAfterCustomerCreate(created.id);

  if (params.actorUserId) {
    recordActivityAudit({
      userId: params.actorUserId,
      actionType: "CUSTOMER_CREATED",
      entityType: "Customer",
      entityId: created.id,
      metadata: {
        customerName: created.displayName,
        customerCode: created.customerCode ?? code,
        source: "order_capture",
      },
    });
  }

  console.info("Customer created:", {
    id: created.id,
    code: created.customerCode,
    name: created.displayName,
  });
  void logCustomerTableStats(true);

  return { customer: toCaptureRow(created), created: true };
}
