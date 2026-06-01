"use server";

import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import {
  isCustomerCodeTaken,
  normalizeCustomerCodeInput,
  suggestNextCustomerCode,
} from "@/lib/customer-code";
import { normalizeCustomerPlaceInput } from "@/lib/customer-place";
import { prisma } from "@/lib/prisma";
import { revalidateAfterCustomerCreate } from "@/lib/revalidate-customer-create";
import { perfEnabled } from "@/lib/perf-log";
import type { ClientCreateInput, ClientCreateResult, ClientLedgerPayload } from "@/app/admin/customers/ledger-types";

function customerLedgerListWhere(): Prisma.CustomerWhereInput {
  return { deletedAt: null, isActive: true };
}

async function isCustomerVisibleInLedgerList(customerId: string): Promise<boolean> {
  const count = await prisma.customer.count({
    where: { id: customerId.trim(), ...customerLedgerListWhere() },
  });
  return count > 0;
}

export async function suggestNextCustomerCodeAction(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_customers", "edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const code = await suggestNextCustomerCode();
  return { ok: true, code };
}

export async function createClientAction(
  input: ClientCreateInput,
): Promise<{ ok: true; client: ClientCreateResult } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_customers", "edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const customerCode = normalizeCustomerCodeInput(input.customerCode);
  const nameAr = input.nameAr.trim();
  const nameEn = input.nameEn?.trim() || null;
  const phone = input.phone?.trim() || null;
  const phone2 = input.phone2?.trim() || null;
  const country = normalizeCustomerPlaceInput(input.country);
  const email = input.email?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (!customerCode) return { ok: false, error: "יש להזין קוד לקוח" };
  if (!nameAr) return { ok: false, error: "שם ערבית חובה" };

  if (await isCustomerCodeTaken(customerCode)) {
    return { ok: false, error: "קוד לקוח כבר קיים במערכת" };
  }

  const created = await prisma.customer.create({
    data: {
      customerCode,
      displayName: nameAr,
      nameAr,
      nameEn,
      phone,
      phone2,
      country,
      email,
      notes,
      isActive: true,
    },
    select: {
      id: true,
      customerCode: true,
      displayName: true,
      nameAr: true,
      nameEn: true,
      phone: true,
      phone2: true,
      country: true,
      email: true,
      createdAt: true,
    },
  });

  revalidateAfterCustomerCreate(created.id);

  const ar = created.nameAr ?? created.displayName ?? nameAr;
  const en = created.nameEn ?? nameEn;
  const client: ClientCreateResult = {
    customerId: created.id,
    id: created.id,
    customerCode: created.customerCode ?? customerCode,
    customerNameAr: ar,
    customerNameEn: en,
    name: ar,
    phone: created.phone ?? phone ?? null,
    phone2: created.phone2 ?? phone2 ?? null,
    country: created.country ?? country ?? null,
    email: created.email,
    createdAt: created.createdAt.toISOString(),
  };

  console.info("Customer created:", {
    id: created.id,
    code: client.customerCode,
    name: client.name,
  });
  const totalInTable = await prisma.customer.count({ where: { deletedAt: null } });
  if (perfEnabled()) {
    console.info("[customer] customers in Customer table (deletedAt=null):", totalInTable);
    console.info("[customer] customer found in ledger:", await isCustomerVisibleInLedgerList(created.id));
  }

  return { ok: true, client };
}

export async function listClientsLedgerAction(params: {
  query?: string;
  page?: number;
  pageSize?: number;
  fromYmd?: string;
  toYmd?: string;
  sort?: "new_old" | "old_new" | "name_az";
}): Promise<ClientLedgerPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return { rows: [], total: 0, page: 1, pageSize: 8, totalPages: 1 };
  }

  const pageSize = Math.min(50, Math.max(1, Math.floor(params.pageSize || 8)));
  const requestedPage = Math.max(1, Math.floor(params.page || 1));
  const q = params.query?.trim() || "";
  const fromYmd = params.fromYmd?.trim() || "";
  const toYmd = params.toYmd?.trim() || "";
  const sort = params.sort ?? "new_old";

  const createdAtFilter =
    fromYmd || toYmd
      ? {
          ...(fromYmd ? { gte: new Date(`${fromYmd}T00:00:00`) } : {}),
          ...(toYmd ? { lte: new Date(`${toYmd}T23:59:59.999`) } : {}),
        }
      : undefined;

  const where: Prisma.CustomerWhereInput = {
    ...customerLedgerListWhere(),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    ...(q
      ? {
          OR: [
            { customerCode: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
            { nameHe: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { phone2: { contains: q } },
            { country: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await prisma.customer.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * pageSize;
  const now = Date.now();
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    sort === "name_az"
      ? [{ displayName: "asc" }]
      : sort === "old_new"
        ? [{ createdAt: "asc" }]
        : [{ createdAt: "desc" }];

  const rows = await prisma.customer.findMany({
    where,
    orderBy,
    skip,
    take: pageSize,
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
      phone: true,
      email: true,
      createdAt: true,
    },
  });

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: primaryCustomerDisplayName({
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        nameHe: r.nameHe,
        displayName: r.displayName,
      }),
      customerCode: r.customerCode,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      phone: r.phone,
      email: r.email,
      createdAt: r.createdAt.toISOString(),
      isNew: now - r.createdAt.getTime() <= 1000 * 60 * 60 * 24 * 3,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}
