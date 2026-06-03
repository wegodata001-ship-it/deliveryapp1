/** Performance logs for intake locations API — INTAKE_LOCATIONS_PERF=1 (default in dev) */

export type IntakeLocationsPerfScope =
  | "intakeLocations.total"
  | "intakeLocations.query"
  | "intakeLocations.map"
  | "intakeLocations.serialize";

export function intakeLocationsPerfEnabled(): boolean {
  const flag = process.env.INTAKE_LOCATIONS_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function intakeLocationsPerfStart(scope: IntakeLocationsPerfScope): void {
  if (!intakeLocationsPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function intakeLocationsPerfEnd(scope: IntakeLocationsPerfScope): void {
  if (!intakeLocationsPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export function intakeLocationsPerfLog(message: string, data?: Record<string, unknown>): void {
  if (!intakeLocationsPerfEnabled()) return;
  console.log(`[intake-locations] ${message}`, data ?? "");
}
