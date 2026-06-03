/**
 * בדיקת אחידות חיבור DB בין קבצי env.
 * node scripts/check-db-env.js [userId-from-jwt]
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local", override: true });
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function maskUrl(raw) {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(String(raw).replace(/^postgres(ql)?:\/\//, "https://"));
    const host = u.hostname + (u.port ? `:${u.port}` : "");
    const user = u.username ? `${u.username.slice(0, 2)}***` : "";
    const db = (u.pathname || "/postgres").replace(/^\//, "");
    return { masked: `postgresql://${user}@${host}/${db}`, host, projectRef: host.split(".")[0] };
  } catch {
    if (raw.startsWith("http")) {
      try {
        const u = new URL(raw);
        return { masked: `${u.protocol}//${u.hostname.slice(0, 8)}***`, host: u.hostname, projectRef: u.hostname.split(".")[0] };
      } catch {
        return { masked: "(unparseable)", host: null, projectRef: null };
      }
    }
    return { masked: raw.slice(0, 20) + "…", host: null, projectRef: null };
  }
}

function readEnvFile(relPath) {
  const p = path.join(process.cwd(), relPath);
  if (!fs.existsSync(p)) return { exists: false, keys: {} };
  const text = fs.readFileSync(p, "utf8");
  const keys = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys[m[1]] = true;
  }
  const get = (name) => {
    const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m");
    const m = text.match(re);
    if (!m) return null;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  };
  return {
    exists: true,
    keys: Object.keys(keys),
    DATABASE_URL: get("DATABASE_URL"),
    DIRECT_URL: get("DIRECT_URL"),
    SHADOW_DATABASE_URL: get("SHADOW_DATABASE_URL"),
    DATABASE_URL_OLD: get("DATABASE_URL_OLD"),
    SUPABASE_URL: get("SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_URL: get("NEXT_PUBLIC_SUPABASE_URL"),
  };
}

async function main() {
  const sessionUserId = process.argv[2]?.trim() || null;

  console.log("\n=== NODE_ENV (process) ===");
  console.log({ NODE_ENV: process.env.NODE_ENV ?? "(unset)" });

  console.log("\n=== קבצי env מקומיים ===");
  for (const f of [".env", ".env.local"]) {
    const file = readEnvFile(f);
    if (!file.exists) {
      console.log(`${f}: לא קיים`);
      continue;
    }
    const db = maskUrl(file.DATABASE_URL);
    const direct = maskUrl(file.DIRECT_URL);
    console.log(`\n${f}:`);
    console.log("  keys:", file.keys.filter((k) => /DATABASE|SUPABASE|DIRECT|SHADOW/i.test(k)).join(", ") || "(none)");
    console.log("  DATABASE_URL:", db?.masked ?? "(missing)");
    console.log("  host fingerprint:", db?.host ?? "—");
    if (file.DATABASE_URL_OLD) console.log("  ⚠ DATABASE_URL_OLD:", maskUrl(file.DATABASE_URL_OLD)?.masked);
    if (file.SHADOW_DATABASE_URL) console.log("  SHADOW_DATABASE_URL:", maskUrl(file.SHADOW_DATABASE_URL)?.masked);
    if (file.SUPABASE_URL) console.log("  SUPABASE_URL:", maskUrl(file.SUPABASE_URL)?.masked);
  }

  console.log("\n=== process.env (מה שהאפליקציה רואה עכשיו) ===");
  const vars = [
    "DATABASE_URL",
    "DIRECT_URL",
    "SHADOW_DATABASE_URL",
    "DATABASE_URL_OLD",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
  ];
  const hosts = new Set();
  for (const name of vars) {
    const raw = process.env[name];
    if (!raw) continue;
    const m = maskUrl(raw);
    console.log(`  ${name}:`, m?.masked);
    if (m?.host) hosts.add(m.host);
  }
  if (hosts.size > 1) {
    console.log("\n  ⚠ מספר hosts שונים ב-env:", [...hosts].join(" | "));
  } else {
    console.log("\n  ✓ host יחיד (או רק DATABASE_URL):", [...hosts][0] ?? "—");
  }

  const combined = [process.env.DATABASE_URL, process.env.DIRECT_URL, process.env.SUPABASE_URL]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (combined.includes("sweet")) console.log('  ⚠ נמצא "sweet" ב-URL');
  if (combined.includes("delivery")) console.log('  ⚠ נמצא "delivery" ב-URL');

  console.log("\n=== Prisma → DB ===");
  const prisma = new PrismaClient();
  try {
    const [userCount, orderCount, paymentCount] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.payment.count(),
    ]);
    console.log({ userCount, orderCount, paymentCount });

    const users = await prisma.user.findMany({
      select: { id: true, fullName: true, username: true, email: true, role: true, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    console.log("\nמשתמשים ב-User:");
    console.table(
      users.map((u) => ({
        id: u.id.slice(0, 8) + "…",
        fullName: u.fullName,
        username: u.username,
        role: u.role,
        isActive: u.isActive,
      })),
    );

    if (sessionUserId) {
      const match = await prisma.user.findUnique({ where: { id: sessionUserId } });
      console.log("\n=== JWT sub / createdById ===", sessionUserId);
      console.log({ userExists: match != null, user: match });
      if (!match) {
        console.log("  ❌ המשתמש מה-JWT לא קיים ב-User — order.create ייכשל ב-FK");
      }
    } else {
      console.log("\n(העבר userId כארגומנט לבדיקת JWT: node scripts/check-db-env.js <uuid>)");
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n=== Vercel ===");
  console.log("הרץ ידנית: vercel env ls  (Production / Preview / Development)");
  console.log("השווה host של DATABASE_URL ל-host המקומי למעלה.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
