import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { employeesPerfEnd, employeesPerfRun, employeesPerfStart } from "@/lib/employees-source-perf";
import { DEFAULT_WEEK_CODE, formatLocalYmd, getAhWeekRange } from "@/lib/work-week";

export type EmployeeRoleFilter = "" | "ADMIN" | "EMPLOYEE";
export type EmployeeActiveFilter = "" | "true" | "false";

export type EmployeesSourceFilters = {
  search?: string;
  name?: string;
  phone?: string;
  role?: EmployeeRoleFilter;
  isActive?: EmployeeActiveFilter;
  lastLoginFromYmd?: string;
  lastLoginToYmd?: string;
};

export type EmployeesSourceListQuery = {
  page?: number;
  limit?: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: EmployeesSourceFilters;
};

export type EmployeeRoleTone = "manager" | "employee" | "disabled";

export type EmployeesSourceRow = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
  roleLabel: string;
  roleTone: EmployeeRoleTone;
  isActive: boolean;
  lastLoginYmd: string;
  lastLoginAt: Date | null;
};

export type EmployeesSourceListResult = {
  rows: EmployeesSourceRow[];
  page: number;
  limit: number;
  hasMore: boolean;
};

export type EmployeesSourceKpis = {
  totalEmployees: number;
  managersCount: number;
  activeCount: number;
  loggedInWeekCount: number;
  weekCode: string;
};

export type EmployeesSourcePreview = {
  fullName: string;
  phone: string;
  roleLabel: string;
  lastLoginYmd: string;
  statusLabel: string;
  isActive: boolean;
};

function parseYmdStart(ymd: string): Date {
  return new Date(`${ymd.trim()}T00:00:00`);
}

function parseYmdEnd(ymd: string): Date {
  return new Date(`${ymd.trim()}T23:59:59.999`);
}

function roleLabel(role: UserRole): string {
  if (role === UserRole.ADMIN) return "מנהל";
  return "עובד";
}

function roleTone(role: UserRole, isActive: boolean): EmployeeRoleTone {
  if (!isActive) return "disabled";
  if (role === UserRole.ADMIN) return "manager";
  return "employee";
}

function contactLine(username: string | null, email: string | null): string {
  const parts = [username?.trim(), email?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export function buildEmployeesSourceWhere(filters: EmployeesSourceFilters = {}): Prisma.UserWhereInput {
    const and: Prisma.UserWhereInput[] = [];

    const name = filters.name?.trim();
    if (name) {
      and.push({
        OR: [
          { fullName: { contains: name, mode: "insensitive" } },
          { username: { contains: name, mode: "insensitive" } },
        ],
      });
    }

    const phone = filters.phone?.trim();
    if (phone) {
      and.push({
        OR: [
          { username: { contains: phone, mode: "insensitive" } },
          { email: { contains: phone, mode: "insensitive" } },
        ],
      });
    }

    const role = filters.role?.trim();
    if (role === "ADMIN" || role === "EMPLOYEE") {
      and.push({ role: role as UserRole });
    }

    const active = filters.isActive?.trim();
    if (active === "true") and.push({ isActive: true });
    if (active === "false") and.push({ isActive: false });

    if (filters.lastLoginFromYmd?.trim()) {
      and.push({ lastLoginAt: { gte: parseYmdStart(filters.lastLoginFromYmd) } });
    }
    if (filters.lastLoginToYmd?.trim()) {
      and.push({ lastLoginAt: { lte: parseYmdEnd(filters.lastLoginToYmd) } });
    }

    const search = filters.search?.trim();
    if (search && !name && !phone) {
      and.push({
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { username: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    return and.length ? { AND: and } : {};
}

function orderByFromQuery(query: EmployeesSourceListQuery): Prisma.UserOrderByWithRelationInput {
  const sortKey = query.sortKey?.trim();
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  switch (sortKey) {
    case "name":
      return { fullName: sortDir };
    case "role":
      return { role: sortDir };
    case "phone":
      return { username: sortDir };
    case "active":
      return { isActive: sortDir };
    case "lastLogin":
      return { lastLoginAt: sortDir };
    default:
      return { createdAt: "desc" };
  }
}

const userListSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
} as const;

function mapUserRow(r: Prisma.UserGetPayload<{ select: typeof userListSelect }>): EmployeesSourceRow {
  const tone = roleTone(r.role, r.isActive);
  return {
    id: r.id,
    fullName: r.fullName?.trim() || "—",
    username: r.username?.trim() || "—",
    email: r.email?.trim() || "—",
    phone: contactLine(r.username, r.email),
    role: r.role,
    roleLabel: r.isActive ? roleLabel(r.role) : "מושבת",
    roleTone: tone,
    isActive: r.isActive,
    lastLoginYmd: r.lastLoginAt ? formatLocalYmd(r.lastLoginAt) : "—",
    lastLoginAt: r.lastLoginAt,
  };
}

export async function listEmployeesSourceTable(
  query: EmployeesSourceListQuery = {},
): Promise<EmployeesSourceListResult> {
  return employeesPerfRun("employees.load", async () => {
    const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 25)));
    const page = Math.max(1, Math.floor(query.page || 1));
    const skip = (page - 1) * limit;
    const where = buildEmployeesSourceWhere(query.filters ?? {});

    employeesPerfStart("employees.query");
    let raw: Prisma.UserGetPayload<{ select: typeof userListSelect }>[];
    try {
      raw = await prisma.user.findMany({
        where,
        orderBy: orderByFromQuery(query),
        skip,
        take: limit + 1,
        select: userListSelect,
      });
    } finally {
      employeesPerfEnd("employees.query");
    }

    employeesPerfStart("employees.response");
    const hasMore = raw.length > limit;
    const slice = hasMore ? raw.slice(0, limit) : raw;
    const rows = slice.map(mapUserRow);
    employeesPerfEnd("employees.response");

    return { rows, page, limit, hasMore };
  });
}

export async function listEmployeesSourceForExport(
  query: EmployeesSourceListQuery = {},
  maxRows = 2000,
): Promise<EmployeesSourceRow[]> {
  const where = buildEmployeesSourceWhere(query.filters ?? {});
  const raw = await prisma.user.findMany({
    where,
    orderBy: orderByFromQuery(query),
    take: maxRows,
    select: userListSelect,
  });
  return raw.map(mapUserRow);
}

export async function getEmployeesSourceKpis(
  filters: EmployeesSourceFilters = {},
): Promise<EmployeesSourceKpis> {
  return employeesPerfRun("employees.kpis", async () => {
    const where = buildEmployeesSourceWhere(filters);
    const weekCode = DEFAULT_WEEK_CODE;
    const weekRange = getAhWeekRange(weekCode);
    const weekStart = weekRange?.from ? parseYmdStart(weekRange.from) : null;

    employeesPerfStart("employees.count");
    const [totalEmployees, managersCount, activeCount, loggedInWeekCount] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.count({ where: { ...where, role: UserRole.ADMIN } }),
      prisma.user.count({ where: { ...where, isActive: true } }),
      weekStart
        ? prisma.user.count({
            where: { ...where, lastLoginAt: { gte: weekStart } },
          })
        : Promise.resolve(0),
    ]);
    employeesPerfEnd("employees.count");

    return {
      totalEmployees,
      managersCount,
      activeCount,
      loggedInWeekCount,
      weekCode,
    };
  });
}

export async function getEmployeeSourcePreview(userId: string): Promise<EmployeesSourcePreview | null> {
  return employeesPerfRun("employees.preview", async () => {
    const id = userId.trim();
    if (!id) return null;

    const u = await prisma.user.findUnique({
      where: { id },
      select: userListSelect,
    });
    if (!u) return null;

    const row = mapUserRow(u);
    return {
      fullName: row.fullName,
      phone: row.phone,
      roleLabel: row.roleLabel,
      lastLoginYmd: row.lastLoginYmd,
      statusLabel: row.isActive ? "פעיל" : "לא פעיל",
      isActive: row.isActive,
    };
  });
}
