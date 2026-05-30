import { cookies } from "next/headers";
import {
  LOGIN_TRACE_COOKIE,
  loginTraceEnabled,
  parseLoginTraceCookie,
  type LoginTraceContext,
} from "@/lib/login-trace";

export async function getLoginTraceFromCookies(): Promise<LoginTraceContext | null> {
  if (!loginTraceEnabled()) return null;
  const raw = (await cookies()).get(LOGIN_TRACE_COOKIE)?.value;
  return parseLoginTraceCookie(raw);
}
