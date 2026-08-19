/**
 * Full system audit orchestrator.
 * DISCOVER → MEASURE → REPORT (no fixes in this phase)
 *
 * Usage: npm run audit:full
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const shim = "node -r ./scripts/shims/register-server-only.cjs --import tsx";

function run(cmd: string, label: string) {
  console.log(`\n=== ${label} ===\n`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
}

async function main() {
  console.log("FULL SYSTEM AUDIT — baseline measurement only\n");

  // 1. Build (sanity, not sufficient alone)
  run("npm run build", "PHASE 0 — Build");

  // 2. Server-side performance benchmarks
  run(`${shim} scripts/perf-audit.ts`, "PHASE 2–15 — Server benchmarks (perf-audit)");

  // 3. Load test on safe read: flow overview concurrency
  run(`${shim} scripts/audit-load-test.ts`, "PHASE 15 — Load tests (safe reads)");

  // 4. QA unit tests (with shim)
  let qaSummary = { total: 0, pass: 0, fail: 0, failures: [] as { file: string; reason: string }[] };
  try {
    run(`${shim} scripts/run-qa-tests.ts`, "PHASE — QA tests");
    const qaPath = join(root, "docs", "qa-summary.json");
    if (existsSync(qaPath)) {
      qaSummary = JSON.parse(readFileSync(qaPath, "utf8"));
    }
  } catch {
    qaSummary.failures.push({ file: "qa runner", reason: "See console output" });
  }

  // 5. Merge load + qa into perf JSON
  const perfPath = join(root, "docs", "perf-baseline.json");
  const loadPath = join(root, "docs", "audit-load.json");
  if (existsSync(perfPath)) {
    const perf = JSON.parse(readFileSync(perfPath, "utf8"));
    if (existsSync(loadPath)) {
      perf.loadTests = JSON.parse(readFileSync(loadPath, "utf8"));
    }
    perf.qaTests = qaSummary;
    writeFileSync(perfPath, JSON.stringify(perf, null, 2), "utf8");
  }

  // 6. Generate all markdown reports
  run(`${shim} scripts/generate-audit-reports.ts`, "FINAL — Generate docs/system-audit/*");

  console.log("\n✅ Audit complete. See docs/system-audit/09-FINAL-HEALTH-REPORT.md\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
