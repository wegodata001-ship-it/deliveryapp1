import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";

const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

function browsersPath(): string {
  return (
    process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ||
    path.join(process.cwd(), ".playwright-browsers")
  );
}

function resolveExecutablePath(): string | undefined {
  const fromEnv =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  return fromEnv || undefined;
}

function isMissingExecutableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("browserType.launch") ||
    message.includes("chromium_headless_shell")
  );
}

async function installPlaywrightChromium(withDeps: boolean): Promise<void> {
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath(),
  };
  const cmd = withDeps
    ? "npx playwright install --with-deps chromium"
    : "npx playwright install chromium";
  execSync(cmd, { stdio: "inherit", env });
}

export async function launchPdfBrowser(): Promise<Browser> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath();
  const playwright = await import("playwright");
  const executablePath = resolveExecutablePath();
  const launchOptions = {
    headless: true,
    args: LAUNCH_ARGS,
    ...(executablePath ? { executablePath } : {}),
  };

  try {
    return await playwright.chromium.launch(launchOptions);
  } catch (error) {
    if (!executablePath && isMissingExecutableError(error)) {
      console.warn("[playwright-pdf] chromium missing — installing…");
      try {
        await installPlaywrightChromium(true);
      } catch {
        await installPlaywrightChromium(false);
      }
      return playwright.chromium.launch(launchOptions);
    }
    throw error;
  }
}

export async function verifyPdfBrowserAtStartup(): Promise<void> {
  if (process.env.SKIP_PLAYWRIGHT_INSTALL === "1") return;

  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath();

  try {
    const playwright = await import("playwright");
    const executablePath = resolveExecutablePath() ?? playwright.chromium.executablePath();
    if (existsSync(executablePath)) return;
    console.warn("[playwright-pdf] chromium not found at startup — installing…");
    try {
      await installPlaywrightChromium(true);
    } catch {
      await installPlaywrightChromium(false);
    }
  } catch (error) {
    console.warn("[playwright-pdf] startup chromium check failed:", error);
  }
}
