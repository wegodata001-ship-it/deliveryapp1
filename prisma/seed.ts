/**
 * זריעה דטרמיניסטית (WGP) — נתונים מחוברים לבדיקת דשבורד, פילטרים ותשלומים.
 *
 * מחיקה לזריעה חוזרת: הזמנות עם WGP-SEED ב־notes, תשלומים קשורים, WGP-P-*, לקוחות WGP-C-*,
 * audit לפעילות עסקית (ORDER_CREATED וכו׳) עם metadata.wgpSeed לניקוי, עובדים employee*@test.com.
 * FinancialSettings: deleteMany מלא ואז שורת ברירת מחדל (3.40+0.10=3.50).
 * אין CREDIT_CARD ב-enum — CASH / BANK_TRANSFER / CHECK וכו׳. PAID→COMPLETED, PARTIAL→OPEN.
 */
import { OrderStatus, PaymentMethod, Prisma, PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const RM = 4 as const;
const SEED_MARKER = ">[WGP-SEED]<";
const PAYMENT_PREFIX = "WGP-P-";
const CUSTOMER_PREFIX = "WGP-C-";
const ORDER_NUM_START = 13561;
const VAT_RATE = new Prisma.Decimal("18");
const VAT_FACTOR = new Prisma.Decimal("1.18");

const WORK_WEEK_RANGES: Record<string, { from: string; to: string }> = {
  "AH-108": { from: "2026-03-03", to: "2026-03-09" },
  "AH-109": { from: "2026-03-10", to: "2026-03-16" },
  "AH-110": { from: "2026-03-17", to: "2026-03-23" },
  "AH-115": { from: "2026-03-24", to: "2026-03-30" },
  "AH-117": { from: "2026-04-05", to: "2026-04-11" },
  "AH-118": { from: "2026-04-12", to: "2026-04-18" },
  "AH-119": { from: "2026-04-19", to: "2026-04-25" },
};

/** (base, fee) לפי שבוע — צילום בהזמנה */
const WEEK_RATES: Record<string, { base: string; fee: string }> = {
  "AH-108": { base: "3.20", fee: "0" },
  "AH-109": { base: "3.20", fee: "0" },
  "AH-110": { base: "3.22", fee: "0" },
  "AH-115": { base: "3.25", fee: "0" },
  "AH-117": { base: "3.27", fee: "0" },
  "AH-118": { base: "3.40", fee: "0.10" },
  "AH-119": { base: "3.40", fee: "0.10" },
};

const DEFAULT_PERMISSIONS: { key: string; name: string; description?: string }[] = [
  { key: "manage_users", name: "Manage users", description: "Create, update, and deactivate users." },
  { key: "manage_permissions", name: "Manage permissions", description: "Assign and revoke permissions." },
  { key: "view_customers", name: "View customers", description: "Read customer records." },
  { key: "manage_customers", name: "Manage customers", description: "Create and update customers." },
  { key: "create_orders", name: "Create orders", description: "Create new orders." },
  { key: "view_orders", name: "View orders", description: "Read orders." },
  { key: "edit_orders", name: "Edit orders", description: "Update order details and status." },
  { key: "receive_payments", name: "Receive payments", description: "Record and confirm payments." },
  { key: "view_payment_control", name: "View payment control", description: "Access receipt / control views." },
  { key: "view_customer_card", name: "View customer card", description: "View sensitive customer card details." },
  { key: "view_reports", name: "View reports", description: "Access operational and financial reports." },
  { key: "import_excel", name: "Import Excel", description: "Run data imports from spreadsheets." },
  { key: "manage_settings", name: "Manage settings", description: "Change application settings." },
];

const CUSTOMERS: {
  displayName: string;
  nameHe?: string;
  nameAr?: string;
  customerNumber: string;
  phone: string;
  email: string;
  city: string;
}[] = [
  { displayName: "ARWA JAZMAWI", nameHe: "ארואה ג׳זמאוי", customerNumber: "24001", phone: "052-701-1001", email: "arwa.j@example.net", city: "נצרת" },
  { displayName: "SHRIN HOSH", nameHe: "שרין חוש", customerNumber: "24002", phone: "052-701-1002", email: "shrin.h@example.net", city: "חיפה" },
  { displayName: "NASRINE AZAME", customerNumber: "24003", phone: "052-701-1003", email: "nasrine.a@example.net", city: "עכו" },
  { displayName: "NUR ALCMOR", nameAr: "نور الكمور", customerNumber: "24004", phone: "052-701-1004", email: "nur.a@example.net", city: "טמרה" },
  { displayName: "SALIM ABU ALKAH", customerNumber: "24005", phone: "052-701-1005", email: "salim.ab@example.net", city: "שפרעם" },
  { displayName: "AMAN OBEID ZABI", customerNumber: "24006", phone: "052-701-1006", email: "aman.o@example.net", city: "רהט" },
  { displayName: "RAGHAD ALBATOUF", customerNumber: "24007", phone: "052-701-1007", email: "raghad.a@example.net", city: "סח׳נין" },
  { displayName: "MUHAMED ALKARNWI", customerNumber: "24008", phone: "052-701-1008", email: "muhamed.a@example.net", city: "כפר קאסם" },
  { displayName: "HANEN HASSAN", customerNumber: "24009", phone: "052-701-1009", email: "hanen.h@example.net", city: "טייבה" },
  { displayName: "JOEL ASLAN", customerNumber: "24010", phone: "052-701-1010", email: "joel.a@example.net", city: "ירושלים" },
  { displayName: "DIMA DRAWSHA", customerNumber: "24011", phone: "052-701-1011", email: "dima.d@example.net", city: "רמלה" },
  { displayName: "AFNAN ABU MOKH", nameHe: "אפנאן אבו מוך", customerNumber: "24012", phone: "052-701-1012", email: "afnan.a@example.net", city: "לוד" },
  { displayName: "YASEER ABU GHANEM", customerNumber: "24013", phone: "052-701-1013", email: "yaseer.a@example.net", city: "רהט" },
  { displayName: "ALAA GHANEM", customerNumber: "24014", phone: "052-701-1014", email: "alaa.g@example.net", city: "באר שבע" },
  { displayName: "TAGHREED KHALAF", nameAr: "تغريد خلف", customerNumber: "24015", phone: "052-701-1015", email: "taghreed.k@example.net", city: "חורה" },
  { displayName: "WAEL MAKALDA", customerNumber: "24016", phone: "052-701-1016", email: "wael.m@example.net", city: "דימונה" },
  { displayName: "LEYAT BARAKHA", customerNumber: "24017", phone: "052-701-1017", email: "leyat.b@example.net", city: "אום אל-פחם" },
  { displayName: "AMAR KLAIN", customerNumber: "24018", phone: "052-701-1018", email: "amar.k@example.net", city: "נצרת עילית" },
  { displayName: "IYAD KARIM", customerNumber: "24019", phone: "052-701-1019", email: "iyad.k@example.net", city: "מגדל שמס" },
  { displayName: "KHODRA MASRI", customerNumber: "24020", phone: "052-701-1020", email: "khodra.m@example.net", city: "טמרה" },
  { displayName: "SAM ATLAS", customerNumber: "24021", phone: "052-701-1021", email: "sam.a@example.net", city: "תל אביב" },
  { displayName: "NOURA ALSANEH", customerNumber: "24022", phone: "052-701-1022", email: "noura.a@example.net", city: "חיפה" },
  { displayName: "RANA HADDAD", customerNumber: "24023", phone: "052-701-1023", email: "rana.h@example.net", city: "נצרת" },
  { displayName: "MAJD ABU SWES", customerNumber: "24024", phone: "052-701-1024", email: "majd.a@example.net", city: "רהט" },
  { displayName: "MIRA AZAM", customerNumber: "24025", phone: "052-701-1025", email: "mira.a@example.net", city: "עפולה" },
];

/** פרופיל תשלום לפי סוג הזמנה (ממופה מ-PAID/PARTIAL/OPEN) */
type PayProfile =
  | "none"
  | "full_one"
  | "full_split"
  | "partial_45"
  | "advance_small"
  | "overpay"
  | "late_entry"
  | "same_day";

type PlannedOrder = {
  seq: number;
  weekCode: keyof typeof WORK_WEEK_RANGES;
  customerIndex: number;
  usd: Prisma.Decimal;
  /** COMPLETED = שולם במלואו, OPEN = פתוח/חלקי לפי payProfile, CANCELLED */
  status: OrderStatus;
  payProfile: PayProfile;
  orderDate: Date;
  notes: string;
  /** אינדקס לבחירת אמצעי תשלום דטרמיניסטי */
  methodSalt: number;
};

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayInWeek(weekCode: string, dayOffset: number): Date {
  const r = WORK_WEEK_RANGES[weekCode];
  const start = parseYmd(r.from);
  return addDays(start, dayOffset);
}

function orderTotals(usd: Prisma.Decimal, base: Prisma.Decimal, fee: Prisma.Decimal) {
  const final = base.add(fee).toDecimalPlaces(4, RM);
  const totalIlsWithVat = usd.mul(final).toDecimalPlaces(2, RM);
  const totalIlsWithoutVat = totalIlsWithVat.div(VAT_FACTOR).toDecimalPlaces(2, RM);
  const vatAmount = totalIlsWithVat.sub(totalIlsWithoutVat).toDecimalPlaces(2, RM);
  return {
    snapshotBaseDollarRate: base.toDecimalPlaces(4, RM),
    snapshotDollarFee: fee.toDecimalPlaces(4, RM),
    snapshotFinalDollarRate: final,
    totalIlsWithVat,
    totalIlsWithoutVat,
    vatAmount,
    exchangeRate: final,
  };
}

function paymentFromIls(
  ils: Prisma.Decimal,
  snapBase: Prisma.Decimal,
  snapFee: Prisma.Decimal,
  snapFinal: Prisma.Decimal,
) {
  const totalIlsWithVat = ils.toDecimalPlaces(2, RM);
  const totalIlsWithoutVat = totalIlsWithVat.div(VAT_FACTOR).toDecimalPlaces(2, RM);
  const vatAmount = totalIlsWithVat.sub(totalIlsWithoutVat).toDecimalPlaces(2, RM);
  return {
    snapshotBaseDollarRate: snapBase,
    snapshotDollarFee: snapFee,
    snapshotFinalDollarRate: snapFinal,
    totalIlsWithVat,
    totalIlsWithoutVat,
    vatAmount,
    amountWithoutVat: totalIlsWithoutVat,
    amountIls: totalIlsWithVat,
    amountUsd: null as Prisma.Decimal | null,
  };
}

function paymentFromUsdPart(
  usd: Prisma.Decimal,
  snapBase: Prisma.Decimal,
  snapFee: Prisma.Decimal,
) {
  const o = orderTotals(usd, snapBase, snapFee);
  return {
    snapshotBaseDollarRate: o.snapshotBaseDollarRate,
    snapshotDollarFee: o.snapshotDollarFee,
    snapshotFinalDollarRate: o.snapshotFinalDollarRate,
    totalIlsWithVat: o.totalIlsWithVat,
    totalIlsWithoutVat: o.totalIlsWithoutVat,
    vatAmount: o.vatAmount,
    amountWithoutVat: o.totalIlsWithoutVat,
    amountIls: o.totalIlsWithVat,
    amountUsd: usd,
  };
}

const PAY_METHODS_CYCLE: PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.CHECK,
  PaymentMethod.RECEIVED_AT_POINT,
  PaymentMethod.BANK_TRANSFER_DONE,
];

function pickMethod(salt: number): PaymentMethod {
  return PAY_METHODS_CYCLE[salt % PAY_METHODS_CYCLE.length]!;
}

/** בונה 100 הזמנות: התפלגות שבועות + סטטוסים (ממופים ל-Prisma) */
function buildPlannedOrders(): PlannedOrder[] {
  const weeks: (keyof typeof WORK_WEEK_RANGES)[] = [];
  for (let i = 0; i < 20; i++) weeks.push("AH-118");
  for (let i = 0; i < 15; i++) weeks.push("AH-117");
  for (let i = 0; i < 10; i++) weeks.push("AH-115");
  for (let i = 0; i < 10; i++) weeks.push("AH-110");
  for (let i = 0; i < 10; i++) weeks.push("AH-109");
  for (let i = 0; i < 10; i++) weeks.push("AH-108");
  for (let i = 0; i < 25; i++) weeks.push("AH-119");

  const n = weeks.length;
  const planned: PlannedOrder[] = [];

  /** דטרמיניסטי: 5% בוטל, 30% פתוח ללא מלא, 20% חלקי, 45% שולם, +יתר */
  const statusRoll = (i: number): { status: OrderStatus; pay: PayProfile } => {
    const bucket = i % 100;
    if (bucket < 5) return { status: OrderStatus.CANCELLED, pay: "none" };
    if (bucket < 35) return { status: OrderStatus.OPEN, pay: "none" };
    if (bucket < 55) return { status: OrderStatus.OPEN, pay: "partial_45" };
    if (bucket < 85) return { status: OrderStatus.COMPLETED, pay: "full_one" };
    if (bucket < 95) return { status: OrderStatus.COMPLETED, pay: "full_split" };
    if (bucket < 98) return { status: OrderStatus.OPEN, pay: "advance_small" };
    return { status: OrderStatus.COMPLETED, pay: "overpay" };
  };

  for (let i = 0; i < n; i++) {
    const weekCode = weeks[i]!;
    const { status, pay } = statusRoll(i);

    let usdNum: number;
    const tier = i % 11;
    if (tier === 0) usdNum = 250 + (i % 650);
    else if (tier <= 3) usdNum = 1000 + ((i * 137) % 4001);
    else if (tier <= 7) usdNum = 6000 + ((i * 211) % 9001);
    else usdNum = 20000 + ((i * 503) % 50001);

    const dayOffset = (i * 3) % 7;
    let orderDate = dayInWeek(weekCode, dayOffset);
    if (i % 13 === 0) orderDate = addDays(orderDate, -((i % 5) + 1));
    orderDate.setHours(9 + (i % 8), (i * 7) % 60, 0, 0);

    let payProfile: PayProfile = pay;
    if (status === OrderStatus.CANCELLED) payProfile = "none";

    planned.push({
      seq: i,
      weekCode,
      customerIndex: i % CUSTOMERS.length,
      usd: new Prisma.Decimal(usdNum),
      status,
      payProfile,
      orderDate,
      notes: `${SEED_MARKER} סדרה ${i + 1}`,
      methodSalt: i,
    });
  }

  const ix = (name: string) => CUSTOMERS.findIndex((c) => c.displayName === name);

  const patch = (seq: number, patch: Partial<PlannedOrder>) => {
    const p = planned.find((x) => x.seq === seq);
    if (p) Object.assign(p, patch);
  };

  patch(0, {
    customerIndex: ix("AFNAN ABU MOKH"),
    weekCode: "AH-118",
    usd: new Prisma.Decimal("21718"),
    status: OrderStatus.OPEN,
    payProfile: "partial_45",
    orderDate: dayInWeek("AH-118", 0),
    notes: `${SEED_MARKER} קצה: AFNAN חלקי 21718 USD AH-118`,
  });

  patch(1, {
    customerIndex: ix("ARWA JAZMAWI"),
    weekCode: "AH-118",
    usd: new Prisma.Decimal("270"),
    status: OrderStatus.COMPLETED,
    payProfile: "full_one",
    orderDate: dayInWeek("AH-118", 1),
    notes: `${SEED_MARKER} קצה: ARWA שולם 270 USD`,
  });

  patch(2, {
    customerIndex: ix("SHRIN HOSH"),
    weekCode: "AH-118",
    usd: new Prisma.Decimal("1700"),
    status: OrderStatus.OPEN,
    payProfile: "none",
    orderDate: dayInWeek("AH-118", 2),
    notes: `${SEED_MARKER} קצה: SHRIN פתוח ללא תשלום`,
  });

  patch(3, {
    weekCode: "AH-108",
    status: OrderStatus.COMPLETED,
    payProfile: "full_one",
    orderDate: parseYmd("2026-03-03"),
    notes: `${SEED_MARKER} קצה: AH-108 ישן שולם 2026-03-03`,
  });

  patch(4, {
    weekCode: "AH-117",
    orderDate: parseYmd("2026-04-05"),
    status: OrderStatus.COMPLETED,
    payProfile: "late_entry",
    notes: `${SEED_MARKER} קצה: תשלום נקלט מאוחר`,
  });

  patch(5, {
    weekCode: "AH-118",
    status: OrderStatus.COMPLETED,
    payProfile: "same_day",
    orderDate: parseYmd("2026-04-12"),
    notes: `${SEED_MARKER} קצה: תשלום באותו יום כהזמנה`,
  });

  patch(6, {
    weekCode: "AH-119",
    status: OrderStatus.OPEN,
    payProfile: "none",
    notes: `${SEED_MARKER} קצה: AH-119 ללא תשלום`,
  });

  patch(7, {
    status: OrderStatus.COMPLETED,
    payProfile: "overpay",
    notes: `${SEED_MARKER} קצה: יתר תשלום`,
  });

  return planned;
}

async function assertFinancialSettingsTableExists() {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'FinancialSettings'
    ) AS "exists"
  `;
  if (!rows[0]?.exists) {
    console.error(
      "\n[שגיאה] טבלת FinancialSettings לא קיימת במסד הנתונים.\n" +
        "הקוד ב-prisma/schema.prisma לא סונכרן ל-DB (למשל אחרי הוספת המודל).\n\n" +
        "פתרון:  npx prisma db push\n" +
        "ואז:     npm run db:seed\n",
    );
    process.exit(1);
  }
}

async function wipeSeedData() {
  const seedOrders = await prisma.order.findMany({
    where: { notes: { contains: "WGP-SEED" } },
    select: { id: true },
  });
  const ids = seedOrders.map((o) => o.id);
  if (ids.length) {
    await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.payment.deleteMany({ where: { paymentCode: { startsWith: PAYMENT_PREFIX } } });
  await prisma.customer.deleteMany({ where: { customerCode: { startsWith: CUSTOMER_PREFIX } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actionType: "WGP_SEED_AUDIT" },
        { metadata: { path: ["wgpSeed"], equals: true } },
      ],
    },
  });
  await prisma.userPermission.deleteMany({
    where: { user: { email: { in: ["employee1@test.com", "employee2@test.com"] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: ["employee1@test.com", "employee2@test.com"] } },
  });
}

async function main() {
  for (const p of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: {
        key: p.key,
        name: p.name,
        description: p.description ?? null,
        isActive: true,
      },
      update: {
        name: p.name,
        description: p.description ?? null,
        isActive: true,
      },
    });
  }

  const passwordHash = await bcrypt.hash("Admin123456!", 12);
  const employeeHash = await bcrypt.hash("Employee123!", 12);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    create: {
      fullName: "System Admin",
      username: "admin",
      email: "admin@test.com",
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
    update: {
      fullName: "System Admin",
      email: "admin@test.com",
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  await wipeSeedData();

  const emp1 = await prisma.user.create({
    data: {
      fullName: "Employee 1",
      username: "employee1",
      email: "employee1@test.com",
      passwordHash: employeeHash,
      role: UserRole.EMPLOYEE,
      isActive: true,
    },
  });
  const emp2 = await prisma.user.create({
    data: {
      fullName: "Employee 2",
      username: "employee2",
      email: "employee2@test.com",
      passwordHash: employeeHash,
      role: UserRole.EMPLOYEE,
      isActive: true,
    },
  });

  const permKeys = [
    "view_orders",
    "create_orders",
    "receive_payments",
    "view_reports",
    "view_customers",
  ] as const;
  const perms = await prisma.permission.findMany({
    where: { key: { in: [...permKeys] } },
  });
  const pid = (k: string) => perms.find((p) => p.key === k)?.id;
  const upRows: { userId: string; permissionId: string }[] = [];
  for (const u of [emp1, emp2]) {
    for (const k of permKeys) {
      const id = pid(k);
      if (id) upRows.push({ userId: u.id, permissionId: id });
    }
  }
  if (upRows.length) await prisma.userPermission.createMany({ data: upRows, skipDuplicates: true });

  await assertFinancialSettingsTableExists();
  await prisma.financialSettings.deleteMany({});
  await prisma.financialSettings.create({
    data: {
      baseDollarRate: new Prisma.Decimal("3.40"),
      dollarFee: new Prisma.Decimal("0.10"),
      finalDollarRate: new Prisma.Decimal("3.50"),
      source: "MANUAL",
      updatedById: admin.id,
    },
  });

  const customerRows = CUSTOMERS.map((c) => ({
    displayName: c.displayName,
    nameEn: c.displayName,
    nameHe: c.nameHe ?? null,
    nameAr: c.nameAr ?? null,
    customerCode: `${CUSTOMER_PREFIX}${c.customerNumber}`,
    phone: c.phone,
    email: c.email,
    city: c.city,
    isActive: true,
  }));
  await prisma.customer.createMany({ data: customerRows });

  const captureTestCustomers = [
    { displayName: "SAMI ATIGA", customerCode: "90001", customerType: "רגיל", phone: "0501234567" },
    { displayName: "AHMAD KAREEM", customerCode: "90002", customerType: "עסקי", phone: "0529876543" },
    { displayName: "MOHAMMED SALEH", customerCode: "90003", customerType: "רגיל", phone: "0541112233" },
    { displayName: "YOUSEF HASSAN", customerCode: "90004", customerType: "עסקי", phone: "0533334444" },
    { displayName: "OMAR BAZAR", customerCode: "90005", customerType: "רגיל", phone: "0522223333" },
  ];
  for (const c of captureTestCustomers) {
    await prisma.customer.upsert({
      where: { customerCode: c.customerCode },
      update: { displayName: c.displayName, phone: c.phone, customerType: c.customerType, isActive: true },
      create: {
        displayName: c.displayName,
        nameEn: c.displayName,
        customerCode: c.customerCode,
        customerType: c.customerType,
        phone: c.phone,
        isActive: true,
      },
    });
  }

  const customers = await prisma.customer.findMany({
    where: { customerCode: { startsWith: CUSTOMER_PREFIX } },
    orderBy: { customerCode: "asc" },
  });
  const custByIndex = (i: number) => customers[i % customers.length]!;

  const planned = buildPlannedOrders();
  type Created = {
    id: string;
    totalIls: Prisma.Decimal;
    planned: PlannedOrder;
    fin: ReturnType<typeof orderTotals>;
  };
  const created: Created[] = [];

  for (const p of planned) {
    const cust = custByIndex(p.customerIndex);
    const wr = WEEK_RATES[p.weekCode]!;
    const base = new Prisma.Decimal(wr.base);
    const fee = new Prisma.Decimal(wr.fee);
    const fin = orderTotals(p.usd, base, fee);
    const legacyNum = ORDER_NUM_START + p.seq;
    const orderNumber = `WGP-${legacyNum}`;

    const row = await prisma.order.create({
      data: {
        orderNumber,
        oldOrderNumber: String(legacyNum),
        customerId: cust.id,
        customerCodeSnapshot: cust.customerCode,
        customerNameSnapshot: cust.displayName,
        weekCode: p.weekCode,
        orderDate: p.orderDate,
        status: p.status,
        amountUsd: p.usd,
        totalUsd: p.usd,
        exchangeRate: fin.exchangeRate,
        vatRate: VAT_RATE,
        amountWithoutVat: fin.totalIlsWithoutVat,
        snapshotBaseDollarRate: fin.snapshotBaseDollarRate,
        snapshotDollarFee: fin.snapshotDollarFee,
        snapshotFinalDollarRate: fin.snapshotFinalDollarRate,
        totalIlsWithVat: fin.totalIlsWithVat,
        totalIlsWithoutVat: fin.totalIlsWithoutVat,
        vatAmount: fin.vatAmount,
        totalIls: fin.totalIlsWithVat,
        amountIls: fin.totalIlsWithVat,
        notes: p.notes,
        createdById: admin.id,
        paymentMethod: pickMethod(p.methodSalt),
      },
    });
    created.push({ id: row.id, totalIls: fin.totalIlsWithVat, planned: p, fin });
  }

  let paySeq = 0;
  const payments: Prisma.PaymentCreateManyInput[] = [];

  const addPay = (
    meta: Created,
    ilsPortion: Prisma.Decimal,
    currency: "ILS" | "USD",
    paymentDate: Date,
    createdAt: Date,
    isPaid: boolean,
    manualDateChanged: boolean,
    method: PaymentMethod,
    notes?: string,
  ) => {
    paySeq += 1;
    const code = `${PAYMENT_PREFIX}${String(paySeq).padStart(6, "0")}`;
    const cust = custByIndex(meta.planned.customerIndex);
    const { snapshotBaseDollarRate, snapshotDollarFee, snapshotFinalDollarRate } = meta.fin;

    let row: Prisma.PaymentCreateManyInput;
    if (!isPaid) {
      const snap = paymentFromIls(ilsPortion, snapshotBaseDollarRate, snapshotDollarFee, snapshotFinalDollarRate);
      row = {
        paymentCode: code,
        customerId: cust.id,
        orderId: meta.id,
        weekCode: meta.planned.weekCode,
        paymentDate,
        currency: "ILS",
        amountUsd: null,
        amountIls: snap.amountIls,
        exchangeRate: snapshotFinalDollarRate,
        vatRate: VAT_RATE,
        amountWithoutVat: snap.amountWithoutVat,
        snapshotBaseDollarRate: snap.snapshotBaseDollarRate,
        snapshotDollarFee: snap.snapshotDollarFee,
        snapshotFinalDollarRate: snap.snapshotFinalDollarRate,
        totalIlsWithVat: snap.totalIlsWithVat,
        totalIlsWithoutVat: snap.totalIlsWithoutVat,
        vatAmount: snap.vatAmount,
        manualDateChanged,
        paymentMethod: method,
        isPaid: false,
        notes: notes ?? "ממתין לאישור",
        createdAt,
        createdById: admin.id,
      };
    } else if (currency === "ILS") {
      const snap = paymentFromIls(ilsPortion, snapshotBaseDollarRate, snapshotDollarFee, snapshotFinalDollarRate);
      row = {
        paymentCode: code,
        customerId: cust.id,
        orderId: meta.id,
        weekCode: meta.planned.weekCode,
        paymentDate,
        currency: "ILS",
        amountUsd: null,
        amountIls: snap.amountIls,
        exchangeRate: snapshotFinalDollarRate,
        vatRate: VAT_RATE,
        amountWithoutVat: snap.amountWithoutVat,
        snapshotBaseDollarRate: snap.snapshotBaseDollarRate,
        snapshotDollarFee: snap.snapshotDollarFee,
        snapshotFinalDollarRate: snap.snapshotFinalDollarRate,
        totalIlsWithVat: snap.totalIlsWithVat,
        totalIlsWithoutVat: snap.totalIlsWithoutVat,
        vatAmount: snap.vatAmount,
        manualDateChanged,
        paymentMethod: method,
        isPaid: true,
        notes: notes ?? null,
        createdAt,
        createdById: admin.id,
      };
    } else {
      const usdPart = ilsPortion.div(snapshotFinalDollarRate).toDecimalPlaces(4, RM);
      const snap = paymentFromUsdPart(usdPart, snapshotBaseDollarRate, snapshotDollarFee);
      row = {
        paymentCode: code,
        customerId: cust.id,
        orderId: meta.id,
        weekCode: meta.planned.weekCode,
        paymentDate,
        currency: "USD",
        amountUsd: usdPart,
        amountIls: snap.amountIls,
        exchangeRate: snapshotFinalDollarRate,
        vatRate: VAT_RATE,
        amountWithoutVat: snap.amountWithoutVat,
        snapshotBaseDollarRate: snap.snapshotBaseDollarRate,
        snapshotDollarFee: snap.snapshotDollarFee,
        snapshotFinalDollarRate: snap.snapshotFinalDollarRate,
        totalIlsWithVat: snap.totalIlsWithVat,
        totalIlsWithoutVat: snap.totalIlsWithoutVat,
        vatAmount: snap.vatAmount,
        manualDateChanged,
        paymentMethod: method,
        isPaid: true,
        notes: notes ?? null,
        createdAt,
        createdById: admin.id,
      };
    }
    payments.push(row);
  };

  for (const meta of created) {
    const { payProfile, orderDate, status } = meta.planned;
    const total = meta.totalIls;
    const m = pickMethod(meta.planned.methodSalt + 1);

    if (status === OrderStatus.CANCELLED) continue;

    if (payProfile === "none") {
      if (meta.planned.seq % 11 === 0) {
        const adv = total.mul(new Prisma.Decimal("0.08")).toDecimalPlaces(2, RM);
        const pd = addDays(orderDate, 1);
        addPay(meta, adv, "ILS", pd, addDays(pd, 2), true, false, m, "מקדמה קטנה");
      }
      continue;
    }

    if (payProfile === "partial_45") {
      const frac = meta.planned.seq === 0 ? new Prisma.Decimal("0.52") : new Prisma.Decimal("0.45");
      const part = total.mul(frac).toDecimalPlaces(2, RM);
      const pd = addDays(orderDate, 1);
      addPay(
        meta,
        part,
        "ILS",
        pd,
        addDays(pd, meta.planned.seq === 0 ? 5 : 1),
        true,
        meta.planned.seq === 0,
        m,
      );
      continue;
    }

    if (payProfile === "advance_small") {
      const part = total.mul(new Prisma.Decimal("0.12")).toDecimalPlaces(2, RM);
      const pd = addDays(orderDate, 2);
      addPay(meta, part, "ILS", pd, addDays(pd, 0), true, false, m);
      continue;
    }

    if (payProfile === "full_one") {
      let pd = addDays(orderDate, 1);
      let cr = addDays(pd, 0);
      if (meta.planned.seq === 1) {
        pd = addDays(orderDate, 0);
        cr = addDays(pd, 1);
      }
      const cur = meta.planned.seq % 7 === 0 ? "USD" : "ILS";
      const manualLate = cr.getTime() - pd.getTime() > 36 * 3600 * 1000;
      addPay(meta, total, cur, pd, cr, true, manualLate, m);
      continue;
    }

    if (payProfile === "full_split") {
      const a = total.mul(new Prisma.Decimal("0.55")).toDecimalPlaces(2, RM);
      const b = total.sub(a).toDecimalPlaces(2, RM);
      const d0 = addDays(orderDate, 1);
      const d1 = addDays(d0, 3);
      addPay(meta, a, "ILS", d0, addDays(d0, 1), true, false, PaymentMethod.CASH);
      addPay(meta, b, "ILS", d1, addDays(d1, 4), true, true, PaymentMethod.BANK_TRANSFER);
      continue;
    }

    if (payProfile === "overpay") {
      const over = total.mul(new Prisma.Decimal("1.045")).toDecimalPlaces(2, RM);
      const pd = addDays(orderDate, 2);
      addPay(meta, over, "ILS", pd, addDays(pd, 1), true, false, PaymentMethod.CHECK, "יתר קליטה");
      continue;
    }

    if (payProfile === "late_entry") {
      const pd = parseYmd("2026-04-06");
      const cr = parseYmd("2026-04-18");
      addPay(meta, total, "ILS", pd, cr, true, true, PaymentMethod.BANK_TRANSFER, "קליטה מאוחרת");
      continue;
    }

    if (payProfile === "same_day") {
      const pd = new Date(orderDate);
      pd.setHours(11, 0, 0, 0);
      const cr = new Date(orderDate);
      cr.setHours(18, 0, 0, 0);
      addPay(meta, total, "ILS", pd, cr, true, false, PaymentMethod.CASH);
      continue;
    }
  }

  const pendingCandidates = created.filter(
    (c) => c.planned.status === OrderStatus.OPEN && c.planned.payProfile === "none" && c.planned.seq % 7 === 3,
  );
  for (const meta of pendingCandidates.slice(0, 8)) {
    const pd = addDays(meta.planned.orderDate, 4);
    const expect = meta.totalIls.mul(new Prisma.Decimal("0.5")).toDecimalPlaces(2, RM);
    addPay(meta, expect, "ILS", pd, addDays(pd, 1), false, true, PaymentMethod.BANK_TRANSFER, "ממתין לאישור בנק");
  }

  if (payments.length) await prisma.payment.createMany({ data: payments });

  const auditRows: Prisma.AuditLogCreateManyInput[] = [];

  for (const meta of created.slice(0, 48)) {
    const legacyNum = ORDER_NUM_START + meta.planned.seq;
    const orderNumber = `WGP-${legacyNum}`;
    const cust = custByIndex(meta.planned.customerIndex);
    auditRows.push({
      userId: admin.id,
      actionType: "ORDER_CREATED",
      entityType: "Order",
      entityId: meta.id,
      metadata: {
        wgpSeed: true,
        orderNumber,
        customerName: cust.displayName,
      } as Prisma.InputJsonValue,
      createdAt: meta.planned.orderDate,
    });
  }

  const seedPaidPayments = await prisma.payment.findMany({
    where: { paymentCode: { startsWith: PAYMENT_PREFIX }, isPaid: true },
    orderBy: { paymentDate: "desc" },
    take: 28,
    select: {
      id: true,
      paymentCode: true,
      currency: true,
      amountUsd: true,
      amountIls: true,
      totalIlsWithVat: true,
      paymentDate: true,
      order: { select: { orderNumber: true } },
    },
  });
  for (const p of seedPaidPayments) {
    const amountDisplay =
      p.currency === "USD" && p.amountUsd != null
        ? `${p.amountUsd.toString()} USD`
        : p.amountIls != null
          ? `${p.amountIls.toString()} ₪`
          : p.totalIlsWithVat != null
            ? `${p.totalIlsWithVat.toString()} ₪`
            : "תשלום";
    auditRows.push({
      userId: admin.id,
      actionType: "PAYMENT_RECEIVED",
      entityType: "Payment",
      entityId: p.id,
      metadata: {
        wgpSeed: true,
        currency: p.currency,
        amountDisplay,
        orderNumber: p.order?.orderNumber ?? undefined,
        paymentCode: p.paymentCode ?? undefined,
      } as Prisma.InputJsonValue,
      createdAt: p.paymentDate ?? new Date(),
    });
  }

  for (let i = 0; i < Math.min(5, customers.length); i++) {
    const c = customers[i]!;
    auditRows.push({
      userId: admin.id,
      actionType: "CUSTOMER_CREATED",
      entityType: "Customer",
      entityId: c.id,
      metadata: {
        wgpSeed: true,
        customerName: c.displayName,
        customerCode: c.customerCode,
      } as Prisma.InputJsonValue,
      createdAt: addDays(parseYmd("2026-03-01"), i),
    });
  }

  if (auditRows.length) await prisma.auditLog.createMany({ data: auditRows });

  console.log(
    [
      "WGP seed complete.",
      `Customers: ${customers.length}`,
      `Orders: ${created.length}`,
      `Payments: ${payments.length}`,
      `Audit: ${auditRows.length}`,
      "Admin: admin / Admin123456!  |  Employees: employee1, employee2 / Employee123!",
    ].join("\n"),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
