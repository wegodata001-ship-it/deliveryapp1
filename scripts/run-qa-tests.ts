/**
 * Run all *.qa.test.ts with server-only shim; writes docs/qa-summary.json
 */
import { execSync } from "node:child_process";
import { writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files: string[] = [];

function walk(dir: string) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== "node_modules" && ent.name !== ".next") walk(p);
    else if (ent.name.endsWith(".qa.test.ts")) files.push(p.replace(/\\/g, "/"));
  }
}

walk(join(root, "src"));

let output = "";
let exitCode = 0;
try {
  output = execSync(
    `node -r ./scripts/shims/register-server-only.cjs --import tsx --test ${files.map((f) => `"${f}"`).join(" ")}`,
    { cwd: root, encoding: "utf8", env: process.env },
  );
  console.log(output);
} catch (e: unknown) {
  exitCode = 1;
  const err = e as { stdout?: string; stderr?: string };
  output = (err.stdout ?? "") + (err.stderr ?? "");
  console.log(output);
}

const passMatch = output.match(/ℹ pass (\d+)/);
const failMatch = output.match(/ℹ fail (\d+)/);
const totalMatch = output.match(/ℹ tests (\d+)/);

const summary = {
  total: totalMatch ? Number(totalMatch[1]) : files.length,
  pass: passMatch ? Number(passMatch[1]) : 0,
  fail: failMatch ? Number(failMatch[1]) : exitCode ? 1 : 0,
  failures: [] as { file: string; reason: string }[],
};

if (summary.fail > 0) {
  for (const line of output.split("\n")) {
    if (line.includes("✖") && line.includes(".qa.test.ts")) {
      summary.failures.push({ file: line.trim(), reason: "See test output" });
    }
  }
}

writeFileSync(join(root, "docs", "qa-summary.json"), JSON.stringify(summary, null, 2), "utf8");
process.exit(exitCode);
