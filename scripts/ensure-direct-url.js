const fs = require("fs");
const path = require("path");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const root = process.cwd();
const envPath = path.join(root, ".env");
const localPath = path.join(root, ".env.local");

const fromEnv = parseEnvFile(envPath);
const fromLocal = parseEnvFile(localPath);

const databaseUrl =
  fromEnv.DATABASE_URL || fromLocal.DATABASE_URL || process.env.DATABASE_URL;
const directUrl =
  fromEnv.DIRECT_URL ||
  fromLocal.DIRECT_URL ||
  process.env.DIRECT_URL ||
  databaseUrl;

if (!databaseUrl) {
  console.error("MISSING_DATABASE_URL");
  process.exit(2);
}

const lines = [
  `# Generated for Prisma CLI (reads .env, not .env.local).`,
  `# Source values synced from .env.local when needed.`,
  `DATABASE_URL=${quote(databaseUrl)}`,
  `DIRECT_URL=${quote(directUrl)}`,
  "",
];

fs.writeFileSync(envPath, lines.join("\n"), "utf8");
console.log("ENV_SYNCED_FOR_PRISMA");
console.log(directUrl === databaseUrl ? "DIRECT_URL_EQUALS_DATABASE_URL" : "DIRECT_URL_FROM_LOCAL");
