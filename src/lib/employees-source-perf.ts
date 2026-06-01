/** Performance logs for employees source table — EMPLOYEES_PERF=1 */

export type EmployeesPerfScope =
  | "employees.load"
  | "employees.query"
  | "employees.count"
  | "employees.response"
  | "employees.kpis"
  | "employees.preview";

export function employeesPerfEnabled(): boolean {
  const flag = process.env.EMPLOYEES_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function employeesPerfStart(scope: EmployeesPerfScope): void {
  if (!employeesPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function employeesPerfEnd(scope: EmployeesPerfScope): void {
  if (!employeesPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function employeesPerfRun<T>(scope: EmployeesPerfScope, fn: () => Promise<T>): Promise<T> {
  employeesPerfStart(scope);
  try {
    return await fn();
  } finally {
    employeesPerfEnd(scope);
  }
}
