import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionPayload } from "@/lib/admin-auth";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

const CUSTOMER_SELECT = {
  id: true,
  displayName: true,
  customerCode: true,
  oldCustomerCode: true,
  customerType: true,
  city: true,
  address: true,
  phone: true,
  secondPhone: true,
  nameAr: true,
  nameEn: true,
  nameHe: true,
} as const;

function toRow(r: {
  id: string;
  displayName: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  customerType: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  secondPhone: string | null;
  nameAr: string | null;
  nameEn: string | null;
  nameHe: string | null;
}) {
  return {
    id: r.id,
    label: primaryCustomerDisplayName({
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      nameHe: r.nameHe,
      displayName: r.displayName,
    }),
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
    phone: r.phone,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    nameHe: r.nameHe,
    secondPhone: r.secondPhone,
    oldCustomerCode: r.oldCustomerCode,
    address: r.address,
  };
}

export async function GET(req: Request) {
  return withPerfTimer("api.customers.search-fast.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const q = (searchParams.get("q") ?? "").trim();
      const exactOnly = searchParams.get("exact") === "1";
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(q);
      if (!q || (!isUuid && q.length < 2)) return NextResponse.json(exactOnly ? null : []);

      const baseWhere: Prisma.CustomerWhereInput = { isActive: true, deletedAt: null };

      // Fastest path for office flow: full customer code is unique, so do not
      // pay for a broad OR query when the user typed/scanned an exact code.
      const codeHit = await prisma.customer.findFirst({
        where: { ...baseWhere, customerCode: q },
        select: CUSTOMER_SELECT,
      });
      if (codeHit) {
        const row = toRow(codeHit);
        return NextResponse.json(exactOnly ? row : [row]);
      }

      const exactOr: Prisma.CustomerWhereInput[] = [
        { oldCustomerCode: { equals: q, mode: "insensitive" } },
        { phone: { equals: q } },
        { secondPhone: { equals: q } },
      ];
      if (isUuid) exactOr.push({ id: q });

      const exactHits = await prisma.customer.findMany({
        where: { ...baseWhere, OR: exactOr },
        take: exactOnly ? 1 : 20,
        orderBy: { displayName: "asc" },
        select: CUSTOMER_SELECT,
      });

      if (exactHits.length > 0 || exactOnly) {
        const rows = exactHits.map(toRow);
        return NextResponse.json(exactOnly ? rows[0] ?? null : rows);
      }

      const rows = await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { nameHe: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
            { customerCode: { contains: q, mode: "insensitive" } },
            { oldCustomerCode: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { secondPhone: { contains: q } },
          ],
        },
        take: 20,
        orderBy: { displayName: "asc" },
        select: CUSTOMER_SELECT,
      });

      return NextResponse.json(rows.map(toRow));
    } catch (error) {
      perfError("api.customers.search-fast.GET.failed", error);
      return NextResponse.json({ error: "טעינת לקוחות נכשלה" }, { status: 500 });
    }
  });
}
