import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BROWSERS_PATH = path.join(process.cwd(), ".playwright-browsers");

function installChromium(withDeps) {
  const args = withDeps
    ? "npx playwright install --with-deps chromium"
    : "npx playwright install chromium";
  execSync(args, {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH,
    },
  });
}

async function chromiumExecutableExists() {
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;
    const playwright = await import("playwright");
    const executablePath = playwright.chromium.executablePath();
    return existsSync(executablePath);
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.SKIP_PLAYWRIGHT_INSTALL === "1") {
    console.log("[playwright] SKIP_PLAYWRIGHT_INSTALL=1 — skipping chromium install");
    return;
  }

  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;

  if (await chromiumExecutableExists()) {
    console.log("[playwright] chromium is already installed at", BROWSERS_PATH);
    return;
  }

  console.log("[playwright] chromium not found — installing to", BROWSERS_PATH);
  try {
    installChromium(true);
  } catch (error) {
    console.warn("[playwright] install --with-deps failed, retrying without deps…", error);
    installChromium(false);
  }

  if (!(await chromiumExecutableExists())) {
    console.error("[playwright] chromium install finished but executable is still missing");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[playwright] failed to ensure chromium:", error);
  process.exit(1);
});
