/**
 * Validates .env.staging and, only after that, can migrate or create the test user.
 * Does not read .env and does not connect unless a mutation flag is passed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertStagingEnv, checkStagingEnv, type EnvMap } from "../src/lib/staging-guard";

const STAGING_FILE = resolve(process.cwd(), ".env.staging");
const CONNECTION_KEYS = ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL", "DATABASE_URL_OLD"];

const KNOWN_MANUAL_MIGRATION = {
  folder: "20261112103000_document_cash_flow_archive",
  manualSql: "prisma/sql/document_cash_flow_archive.sql",
  note: "The same additive columns were applied earlier with prisma db execute. The migration is idempotent. Do not run it against production from this check.",
};

function parseEnvFile(filePath: string): EnvMap {
  const parsed: EnvMap = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

function applyStagingProcessEnv(parsed: EnvMap): void {
  for (const key of CONNECTION_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(parsed)) {
    if (value != null) process.env[key] = value;
  }
}

function printMigrationPlan(): void {
  console.log("Migration plan (not executed):");
  console.log(`- ${KNOWN_MANUAL_MIGRATION.folder}: ${KNOWN_MANUAL_MIGRATION.note}`);
  console.log(`- manual SQL twin: ${KNOWN_MANUAL_MIGRATION.manualSql}`);
  console.log("- 20261112140000_document_cash_flow_version_unique: partial unique index, not applied by this command");
  console.log("- prisma migrate deploy is the staging path. It is not production migrate dev, and it does not reset data.");
}

function stopBeforeDatabase(message: string): never {
  console.error(message);
  printMigrationPlan();
  console.error("No database connection was opened.");
  process.exit(2);
}

async function createTestUser(parsed: EnvMap): Promise<void> {
  const username = (parsed.STAGING_TEST_USERNAME || "staging-qa").trim();
  const password = (parsed.STAGING_TEST_PASSWORD || "").trim();
  if (password.length < 12) {
    throw new Error("STAGING_TEST_PASSWORD must be at least 12 characters");
  }
  applyStagingProcessEnv(parsed);
  const [{ PrismaClient, UserRole }, bcrypt] = await Promise.all([
    import("@prisma/client"),
    import("bcryptjs"),
  ]);
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const email = `${username}@staging.local`;
    const user = await prisma.user.upsert({
      where: { username },
      create: {
        fullName: "Staging QA",
        username,
        email,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
      },
      update: {
        fullName: "Staging QA",
        email,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
      },
    });
    console.log(`Staging test user ready: ${user.username} role=${user.role}`);
  } finally {
    await prisma.$disconnect();
  }
}

function migrateStaging(parsed: EnvMap): void {
  applyStagingProcessEnv(parsed);
  const child = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: true,
  });
  if (child.status !== 0) process.exit(child.status ?? 1);
}

async function main(): Promise<void> {
  const migrate = process.argv.includes("--migrate");
  const createUser = process.argv.includes("--create-test-user");
  if (!existsSync(STAGING_FILE)) {
    stopBeforeDatabase("Missing .env.staging. Copy .env.staging.example and fill a separate Supabase project.");
  }
  const parsed = parseEnvFile(STAGING_FILE);
  const check = checkStagingEnv(parsed);
  for (const warning of check.warnings) console.log(`warning: ${warning}`);
  if (!check.ok) {
    stopBeforeDatabase(check.errors.join("\n"));
  }
  const { projectRef } = assertStagingEnv(parsed);
  console.log(`Staging project ref: ${projectRef}`);
  printMigrationPlan();
  if (!migrate && !createUser) {
    console.log("Staging file is valid. No migration and no test user were run.");
    return;
  }
  if (migrate) migrateStaging(parsed);
  if (createUser) await createTestUser(parsed);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "staging preflight failed";
  console.error(message);
  process.exit(1);
});
