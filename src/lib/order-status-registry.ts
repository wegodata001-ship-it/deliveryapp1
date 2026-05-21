import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import {
  ORDER_STATUS_META,
  ORDER_STATUS_QUICK_SELECT_OPTIONS,
  orderStatusLabelByEditText,
} from "@/constants/order-status";
import { isLegacyOrderStatusSlug, LEGACY_ORDER_STATUS_SLUGS, OS } from "@/lib/order-status-slugs";

export type OrderStatusTag = {
  id: string;
  nameHe: string;
  colorHex: string;
  isActive: boolean;
  sortOrder: number;
};

export type OrderStatusSelectOption = { value: string; label: string };

const PRESET_HEX: Record<string, string> = {
  success: "#22c55e",
  danger: "#ef4444",
  warning: "#f97316",
  info: "#3b82f6",
};

const LEGACY_SORT: Record<string, number> = {
  [OS.OPEN]: 0,
  [OS.WAITING_FOR_EXECUTION]: 10,
  [OS.WITHDRAWAL_FROM_SUPPLIER]: 20,
  [OS.SENT]: 30,
  [OS.WAITING_FOR_CHINA_EXECUTION]: 40,
  [OS.COMPLETED]: 50,
  [OS.DEBT_WITHDRAWAL]: 60,
  [OS.CANCELLED]: 70,
};

export const STATUS_COLOR_PRESETS = [
  { hex: "#22c55e", label: "ירוק" },
  { hex: "#3b82f6", label: "כחול" },
  { hex: "#f97316", label: "כתום" },
  { hex: "#ef4444", label: "אדום" },
  { hex: "#a855f7", label: "סגול" },
  { hex: "#64748b", label: "אפור" },
  { hex: "#eab308", label: "צהוב" },
  { hex: "#06b6d4", label: "טורקיז" },
] as const;

function normalizeHex(color: string | null | undefined, fallback = "#64748b"): string {
  const t = (color ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  if (t in PRESET_HEX) return PRESET_HEX[t];
  return fallback;
}

function legacyDefaultName(id: string): string {
  if (id in ORDER_STATUS_META) return ORDER_STATUS_META[id as keyof typeof ORDER_STATUS_META].editLabel;
  return id;
}

function legacyDefaultHex(id: string): string {
  if (id in ORDER_STATUS_META) {
    const c = ORDER_STATUS_META[id as keyof typeof ORDER_STATUS_META].color;
    if (c === "green") return "#22c55e";
    if (c === "red") return "#ef4444";
    if (c === "orange") return "#f97316";
    if (c === "purple") return "#a855f7";
  }
  return "#64748b";
}

/** טבלת SourceStatus — מקור יחיד לכל הסטטוסים */
export async function ensureOrderStatusSourceTable(): Promise<void> {
  await ensureOnce("order-status-source-table-v3", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "SourceStatus" (
        "id" TEXT PRIMARY KEY,
        "nameHe" TEXT NOT NULL,
        "color" TEXT NOT NULL DEFAULT 'info',
        "colorHex" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`ALTER TABLE "SourceStatus" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`;
    await prisma.$executeRaw`ALTER TABLE "SourceStatus" ADD COLUMN IF NOT EXISTS "colorHex" TEXT`;

    // Order.status: enum → TEXT (תואם prisma schema; בטוח להרצה חוזרת)
    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Order' AND column_name = 'status'
            AND udt_name = 'OrderStatus'
        ) THEN
          ALTER TABLE "Order" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
        END IF;
      END $$
    `;

    let sort = 0;
    for (const slug of LEGACY_ORDER_STATUS_SLUGS) {
      const meta = ORDER_STATUS_META[slug as keyof typeof ORDER_STATUS_META];
      const color = meta?.color === "green" ? "success" : meta?.color === "red" ? "danger" : meta?.color === "orange" ? "warning" : "info";
      const hex = legacyDefaultHex(slug);
      await prisma.$executeRaw`
        INSERT INTO "SourceStatus" ("id", "nameHe", "color", "colorHex", "sortOrder")
        VALUES (${slug}, ${legacyDefaultName(slug)}, ${color}, ${hex}, ${LEGACY_SORT[slug] ?? sort})
        ON CONFLICT ("id") DO NOTHING
      `;
      sort += 10;
    }

    await prisma.$executeRaw`
      DELETE FROM "SourceStatus" s
      WHERE s."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1 FROM "Order" o WHERE o."status"::text = s."id" AND o."deletedAt" IS NULL
        )
    `;
  });
}

export async function listOrderStatusTags(includeInactive = false): Promise<OrderStatusTag[]> {
  await ensureOrderStatusSourceTable();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; nameHe: string; color: string | null; colorHex: string | null; isActive: boolean; sortOrder: number }>
  >`
    SELECT "id", "nameHe", "color", "colorHex", "isActive", "sortOrder"
    FROM "SourceStatus"
    ORDER BY "sortOrder" ASC, "nameHe" ASC
  `;
  return rows
    .filter((r) => includeInactive || r.isActive)
    .map((r) => ({
      id: r.id,
      nameHe: r.nameHe?.trim() || legacyDefaultName(r.id),
      colorHex: normalizeHex(r.colorHex || r.color, legacyDefaultHex(r.id)),
      isActive: r.isActive,
      sortOrder: Number(r.sortOrder) || 0,
    }));
}

export async function getOrderStatusLabelMap(): Promise<Record<string, string>> {
  const rows = await listOrderStatusTags(true);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.nameHe;
  for (const slug of LEGACY_ORDER_STATUS_SLUGS) {
    if (!map[slug]) map[slug] = legacyDefaultName(slug);
  }
  return map;
}

export function labelFromMap(map: Record<string, string>, status: string): string {
  if (map[status]) return map[status];
  if (status in ORDER_STATUS_META) return ORDER_STATUS_META[status as keyof typeof ORDER_STATUS_META].label;
  return status;
}

export function buildEditSelectOptions(rows: OrderStatusTag[]): OrderStatusSelectOption[] {
  return rows.filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.nameHe }));
}

export function buildQuickSelectOptions(rows: OrderStatusTag[]): OrderStatusSelectOption[] {
  const nameById = Object.fromEntries(rows.map((r) => [r.id, r.nameHe]));
  const quickIds = ORDER_STATUS_QUICK_SELECT_OPTIONS.map((o) => o.value as string);
  const activeQuick = quickIds.filter((id) => rows.some((r) => r.id === id && r.isActive));
  const ids = activeQuick.length > 0 ? activeQuick : rows.slice(0, 5).map((r) => r.id);
  return ids.map((id) => {
    const meta = ORDER_STATUS_META[id as keyof typeof ORDER_STATUS_META];
    const label =
      meta?.label && (id === OS.WAITING_FOR_EXECUTION || !nameById[id])
        ? meta.label
        : nameById[id] || legacyDefaultName(id);
    return { value: id, label };
  });
}

export async function isValidOrderStatusId(id: string): Promise<boolean> {
  const rows = await listOrderStatusTags(false);
  return rows.some((r) => r.id === id);
}

export async function resolveOrderStatusFromDisplayText(text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  const rows = await listOrderStatusTags(true);
  const byId = rows.find((r) => r.id === t);
  if (byId) return byId.id;
  const byName = rows.find((r) => r.nameHe === t);
  if (byName) return byName.id;
  if (isLegacyOrderStatusSlug(t)) return t;
  return orderStatusLabelByEditText(t);
}

export async function countOrdersWithStatus(statusId: string): Promise<number> {
  return prisma.order.count({ where: { deletedAt: null, status: statusId } });
}

export async function createOrderStatusTag(input: {
  nameHe: string;
  colorHex: string;
  isActive?: boolean;
}): Promise<{ ok: true; tag: OrderStatusTag } | { ok: false; error: string }> {
  await ensureOrderStatusSourceTable();
  const nameHe = input.nameHe.trim();
  if (!nameHe) return { ok: false, error: "שם סטטוס חובה" };
  const colorHex = normalizeHex(input.colorHex);
  const id = `st_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const maxSort = await prisma.$queryRaw<[{ m: number | null }]>`
    SELECT MAX("sortOrder")::int AS m FROM "SourceStatus"
  `;
  const sortOrder = (maxSort[0]?.m ?? 0) + 10;
  await prisma.$executeRaw`
    INSERT INTO "SourceStatus" ("id", "nameHe", "color", "colorHex", "isActive", "sortOrder", "updatedAt")
    VALUES (${id}, ${nameHe}, ${"info"}, ${colorHex}, ${input.isActive !== false}, ${sortOrder}, CURRENT_TIMESTAMP)
  `;
  return {
    ok: true,
    tag: { id, nameHe, colorHex, isActive: input.isActive !== false, sortOrder },
  };
}

export async function updateOrderStatusTag(
  id: string,
  patch: { nameHe?: string; colorHex?: string; isActive?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureOrderStatusSourceTable();
  const nameHe = patch.nameHe?.trim();
  if (nameHe !== undefined && !nameHe) return { ok: false, error: "שם סטטוס חובה" };
  if (nameHe !== undefined) {
    await prisma.$executeRaw`UPDATE "SourceStatus" SET "nameHe" = ${nameHe}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}`;
  }
  if (patch.colorHex !== undefined) {
    const hex = normalizeHex(patch.colorHex);
    await prisma.$executeRaw`
      UPDATE "SourceStatus" SET "colorHex" = ${hex}, "color" = ${"info"}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}
    `;
  }
  if (patch.isActive !== undefined) {
    await prisma.$executeRaw`
      UPDATE "SourceStatus" SET "isActive" = ${patch.isActive}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}
    `;
  }
  return { ok: true };
}

export async function reorderOrderStatusTags(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureOrderStatusSourceTable();
  let order = 0;
  for (const id of ids) {
    await prisma.$executeRaw`UPDATE "SourceStatus" SET "sortOrder" = ${order}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}`;
    order += 10;
  }
  return { ok: true };
}

export async function deleteOrderStatusTag(
  id: string,
  replaceWithId?: string,
): Promise<{ ok: true } | { ok: false; error: string; usageCount?: number }> {
  await ensureOrderStatusSourceTable();
  const usage = await countOrdersWithStatus(id);
  if (usage > 0) {
    if (!replaceWithId?.trim()) {
      return { ok: false, error: "הסטטוס בשימוש בהזמנות", usageCount: usage };
    }
    await prisma.order.updateMany({ where: { status: id }, data: { status: replaceWithId.trim() } });
  }
  await prisma.$executeRaw`DELETE FROM "SourceStatus" WHERE "id" = ${id}`;
  return { ok: true };
}

/** @deprecated */
export function isKnownOrderStatusId(id: string): boolean {
  return isLegacyOrderStatusSlug(id);
}

export type OrderStatusSourceRow = OrderStatusTag;
export async function listOrderStatusSourceRows(): Promise<OrderStatusTag[]> {
  return listOrderStatusTags(false);
}
