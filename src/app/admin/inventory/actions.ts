"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/admin-auth";
import { formatLocalYmd } from "@/lib/work-week";
import type { InventoryCountStatus } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type InventoryItemDto = {
  id: string;
  name: string;
  unit: string;
  pricePerUnit: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
};

export type InventoryCountLineInput = {
  itemId: string;
  systemQty: number;
  countedQty: number;
  notes?: string | null;
};

export type InventoryCountSummary = {
  id: string;
  weekCode: string;
  countDateYmd: string;
  status: InventoryCountStatus;
  notes: string | null;
  createdByName: string | null;
  totalItems: number;
  exceptions: number;
  totalDiffQty: number;
  totalDiffValue: number;
};

export type InventoryCountDetail = InventoryCountSummary & {
  lines: Array<{
    itemId: string;
    itemName: string;
    unit: string;
    pricePerUnit: number;
    currency: string;
    systemQty: number;
    countedQty: number;
    diffQty: number;
    diffValue: number;
    notes: string | null;
  }>;
};

export type InventoryWeekCompareRow = {
  itemId: string;
  itemName: string;
  unit: string;
  weekA: { countedQty: number; diffQty: number; diffValue: number } | null;
  weekB: { countedQty: number; diffQty: number; diffValue: number } | null;
  changeQty: number | null;
  changeValue: number | null;
  trend: "up" | "down" | "stable" | null;
};

export type InventoryKpiDto = {
  lastCountDateYmd: string | null;
  lastWeekCode: string | null;
  totalItems: number;
  exceptions: number;
  totalDiffValue: number;
  totalInventoryValue: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function summaryFromLines(
  lines: Array<{
    systemQty: { toFixed: (d: number) => string };
    countedQty: { toFixed: (d: number) => string };
    item: { pricePerUnit: { toFixed: (d: number) => string }; currency: string };
  }>,
) {
  let totalItems = lines.length;
  let exceptions = 0;
  let totalDiffQty = 0;
  let totalDiffValue = 0;
  for (const l of lines) {
    const sys = Number(l.systemQty.toFixed(3));
    const cnt = Number(l.countedQty.toFixed(3));
    const price = Number(l.item.pricePerUnit.toFixed(4));
    const diff = round2(cnt - sys);
    const val = round2(diff * price);
    if (Math.abs(diff) > 0.001) exceptions++;
    totalDiffQty = round2(totalDiffQty + diff);
    totalDiffValue = round2(totalDiffValue + val);
  }
  return { totalItems, exceptions, totalDiffQty, totalDiffValue };
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function listInventoryItemsAction(): Promise<{
  ok: true;
  items: InventoryItemDto[];
} | { ok: false; error: string }> {
  await requireAuth();
  const rows = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      pricePerUnit: Number(r.pricePerUnit.toFixed(4)),
      currency: r.currency,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      notes: r.notes,
    })),
  };
}

export async function upsertInventoryItemAction(input: {
  id?: string | null;
  name: string;
  unit: string;
  pricePerUnit: string;
  currency: string;
  notes?: string | null;
  sortOrder?: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAuth();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "שם מוצר נדרש" };
  const price = Number(input.pricePerUnit);
  if (!isFinite(price) || price < 0) return { ok: false, error: "מחיר לא תקין" };

  if (input.id) {
    await prisma.inventoryItem.update({
      where: { id: input.id },
      data: {
        name,
        unit: input.unit.trim() || "יח'",
        pricePerUnit: price.toFixed(4),
        currency: input.currency.trim() || "ILS",
        notes: input.notes?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return { ok: true, id: input.id };
  }

  const item = await prisma.inventoryItem.create({
    data: {
      name,
      unit: input.unit.trim() || "יח'",
      pricePerUnit: price.toFixed(4),
      currency: input.currency.trim() || "ILS",
      notes: input.notes?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return { ok: true, id: item.id };
}

export async function deleteInventoryItemAction(
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  await prisma.inventoryItem.update({
    where: { id: itemId },
    data: { isActive: false },
  });
  return { ok: true };
}

// ─── Counts ───────────────────────────────────────────────────────────────────

export async function listInventoryCountsAction(limit = 20): Promise<{
  ok: true;
  counts: InventoryCountSummary[];
} | { ok: false; error: string }> {
  await requireAuth();
  const rows = await prisma.inventoryCount.findMany({
    orderBy: [{ countDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      createdBy: { select: { fullName: true } },
      lines: {
        include: { item: { select: { pricePerUnit: true, currency: true } } },
      },
    },
  });
  return {
    ok: true,
    counts: rows.map((r) => {
      const { totalItems, exceptions, totalDiffQty, totalDiffValue } = summaryFromLines(r.lines);
      return {
        id: r.id,
        weekCode: r.weekCode,
        countDateYmd: formatLocalYmd(r.countDate),
        status: r.status,
        notes: r.notes,
        createdByName: r.createdBy?.fullName ?? null,
        totalItems,
        exceptions,
        totalDiffQty,
        totalDiffValue,
      };
    }),
  };
}

export async function getInventoryCountDetailAction(countId: string): Promise<{
  ok: true;
  count: InventoryCountDetail;
} | { ok: false; error: string }> {
  await requireAuth();
  const row = await prisma.inventoryCount.findUnique({
    where: { id: countId },
    include: {
      createdBy: { select: { fullName: true } },
      lines: {
        include: {
          item: {
            select: { name: true, unit: true, pricePerUnit: true, currency: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return { ok: false, error: "ספירה לא נמצאה" };

  const lines = row.lines.map((l) => {
    const sys = Number(l.systemQty.toFixed(3));
    const cnt = Number(l.countedQty.toFixed(3));
    const price = Number(l.item.pricePerUnit.toFixed(4));
    const diff = round2(cnt - sys);
    return {
      itemId: l.itemId,
      itemName: l.item.name,
      unit: l.item.unit,
      pricePerUnit: price,
      currency: l.item.currency,
      systemQty: sys,
      countedQty: cnt,
      diffQty: diff,
      diffValue: round2(diff * price),
      notes: l.notes,
    };
  });

  const { totalItems, exceptions, totalDiffQty, totalDiffValue } = summaryFromLines(row.lines);
  return {
    ok: true,
    count: {
      id: row.id,
      weekCode: row.weekCode,
      countDateYmd: formatLocalYmd(row.countDate),
      status: row.status,
      notes: row.notes,
      createdByName: row.createdBy?.fullName ?? null,
      totalItems,
      exceptions,
      totalDiffQty,
      totalDiffValue,
      lines,
    },
  };
}

export async function saveInventoryCountAction(input: {
  id?: string | null;
  weekCode: string;
  countDateYmd: string;
  notes?: string | null;
  lines: InventoryCountLineInput[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  const weekCode = input.weekCode.trim();
  if (!weekCode) return { ok: false, error: "קוד שבוע נדרש" };
  if (input.lines.length === 0) return { ok: false, error: "יש להוסיף לפחות מוצר אחד לספירה" };

  const countDate = new Date(input.countDateYmd);
  if (isNaN(countDate.getTime())) return { ok: false, error: "תאריך לא תקין" };

  const linesData = input.lines.map((l) => ({
    itemId: l.itemId,
    systemQty: String(Math.max(0, Number(l.systemQty))),
    countedQty: String(Math.max(0, Number(l.countedQty))),
    notes: l.notes?.trim() || null,
    updatedAt: new Date(),
  }));

  if (input.id) {
    // Update existing count
    await prisma.$transaction(async (tx) => {
      await tx.inventoryCount.update({
        where: { id: input.id! },
        data: { weekCode, countDate, notes: input.notes?.trim() || null, updatedAt: new Date() },
      });
      // Upsert lines
      for (const l of linesData) {
        await tx.inventoryCountLine.upsert({
          where: { countId_itemId: { countId: input.id!, itemId: l.itemId } },
          create: { countId: input.id!, ...l },
          update: l,
        });
      }
    });
    return { ok: true, id: input.id };
  }

  const count = await prisma.inventoryCount.create({
    data: {
      weekCode,
      countDate,
      notes: input.notes?.trim() || null,
      createdById: me.id,
      lines: {
        create: linesData.map((l) => ({ ...l, updatedAt: undefined })),
      },
    },
  });
  return { ok: true, id: count.id };
}

export async function submitInventoryCountAction(
  countId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  await prisma.inventoryCount.update({
    where: { id: countId },
    data: { status: "SUBMITTED" },
  });
  return { ok: true };
}

// ─── Comparison ───────────────────────────────────────────────────────────────

export async function compareInventoryWeeksAction(
  weekCodeA: string,
  weekCodeB: string,
): Promise<{
  ok: true;
  rows: InventoryWeekCompareRow[];
  summaryA: { totalItems: number; exceptions: number; totalDiffValue: number };
  summaryB: { totalItems: number; exceptions: number; totalDiffValue: number };
} | { ok: false; error: string }> {
  await requireAuth();

  const [countA, countB] = await Promise.all([
    prisma.inventoryCount.findFirst({
      where: { weekCode: weekCodeA },
      orderBy: { createdAt: "desc" },
      include: {
        lines: {
          include: { item: { select: { name: true, unit: true, pricePerUnit: true } } },
        },
      },
    }),
    prisma.inventoryCount.findFirst({
      where: { weekCode: weekCodeB },
      orderBy: { createdAt: "desc" },
      include: {
        lines: {
          include: { item: { select: { name: true, unit: true, pricePerUnit: true } } },
        },
      },
    }),
  ]);

  if (!countA && !countB) return { ok: false, error: "לא נמצאו ספירות לשבועות שנבחרו" };

  type LineEntry = { countedQty: number; diffQty: number; diffValue: number };
  const aMap = new Map<string, LineEntry>();
  const bMap = new Map<string, LineEntry>();
  const itemMeta = new Map<string, { name: string; unit: string }>();

  for (const l of countA?.lines ?? []) {
    const sys = Number(l.systemQty);
    const cnt = Number(l.countedQty);
    const price = Number(l.item.pricePerUnit);
    const diff = round2(cnt - sys);
    aMap.set(l.itemId, { countedQty: cnt, diffQty: diff, diffValue: round2(diff * price) });
    itemMeta.set(l.itemId, { name: l.item.name, unit: l.item.unit });
  }
  for (const l of countB?.lines ?? []) {
    const sys = Number(l.systemQty);
    const cnt = Number(l.countedQty);
    const price = Number(l.item.pricePerUnit);
    const diff = round2(cnt - sys);
    bMap.set(l.itemId, { countedQty: cnt, diffQty: diff, diffValue: round2(diff * price) });
    itemMeta.set(l.itemId, { name: l.item.name, unit: l.item.unit });
  }

  const rows: InventoryWeekCompareRow[] = [];
  for (const [itemId, meta] of itemMeta) {
    const a = aMap.get(itemId) ?? null;
    const b = bMap.get(itemId) ?? null;
    let changeQty: number | null = null;
    let changeValue: number | null = null;
    let trend: InventoryWeekCompareRow["trend"] = null;
    if (a !== null && b !== null) {
      changeQty = round2(b.countedQty - a.countedQty);
      changeValue = round2(b.diffValue - a.diffValue);
      trend = Math.abs(changeQty) < 0.001 ? "stable" : changeQty > 0 ? "up" : "down";
    }
    rows.push({ itemId, itemName: meta.name, unit: meta.unit, weekA: a, weekB: b, changeQty, changeValue, trend });
  }
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName, "he"));

  const makeSummary = (map: Map<string, LineEntry>) => {
    let totalItems = 0, exceptions = 0, totalDiffValue = 0;
    for (const v of map.values()) {
      totalItems++;
      if (Math.abs(v.diffQty) > 0.001) exceptions++;
      totalDiffValue = round2(totalDiffValue + v.diffValue);
    }
    return { totalItems, exceptions, totalDiffValue };
  };

  return {
    ok: true,
    rows,
    summaryA: makeSummary(aMap),
    summaryB: makeSummary(bMap),
  };
}

// ─── KPI ─────────────────────────────────────────────────────────────────────

export async function getInventoryKpiAction(): Promise<{
  ok: true;
  kpi: InventoryKpiDto;
} | { ok: false; error: string }> {
  try {
    await requireAuth();
    const [lastCount, items] = await Promise.all([
      prisma.inventoryCount.findFirst({
        orderBy: [{ countDate: "desc" }, { createdAt: "desc" }],
        include: {
          lines: {
            include: { item: { select: { pricePerUnit: true, currency: true } } },
          },
        },
      }),
      prisma.inventoryItem.findMany({
        where: { isActive: true },
        select: { pricePerUnit: true },
      }),
    ]);

    const totalInventoryValue = round2(
      items.reduce((s, i) => s + Number(i.pricePerUnit), 0),
    );

    if (!lastCount) {
      return {
        ok: true,
        kpi: {
          lastCountDateYmd: null,
          lastWeekCode: null,
          totalItems: 0,
          exceptions: 0,
          totalDiffValue: 0,
          totalInventoryValue,
        },
      };
    }

    const { totalItems, exceptions, totalDiffValue } = summaryFromLines(lastCount.lines);
    return {
      ok: true,
      kpi: {
        lastCountDateYmd: formatLocalYmd(lastCount.countDate),
        lastWeekCode: lastCount.weekCode,
        totalItems,
        exceptions,
        totalDiffValue,
        totalInventoryValue,
      },
    };
  } catch {
    return { ok: false, error: "שגיאה בטעינת KPI מלאי" };
  }
}

// ─── Chart data ───────────────────────────────────────────────────────────────

export type InventoryChartPoint = {
  weekCode: string;
  exceptions: number;
  totalDiffValue: number;
};

export async function getInventoryChartDataAction(limit = 12): Promise<{
  ok: true;
  points: InventoryChartPoint[];
} | { ok: false; error: string }> {
  await requireAuth();
  const counts = await prisma.inventoryCount.findMany({
    orderBy: [{ countDate: "desc" }],
    take: limit,
    include: {
      lines: {
        include: { item: { select: { pricePerUnit: true, currency: true } } },
      },
    },
  });

  const points: InventoryChartPoint[] = counts
    .map((c) => {
      const { exceptions, totalDiffValue } = summaryFromLines(c.lines);
      return { weekCode: c.weekCode, exceptions, totalDiffValue };
    })
    .reverse();

  return { ok: true, points };
}
