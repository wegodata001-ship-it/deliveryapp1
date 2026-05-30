import { requireAuth } from "@/lib/admin-auth";
import { getLoginTraceFromCookies } from "@/lib/login-trace-server";
import { loginTraceMark } from "@/lib/login-trace";

export async function DashboardGreeting() {
  const trace = await getLoginTraceFromCookies();
  if (trace) loginTraceMark(trace, "8.adminPage", { segment: "greeting" });
  const me = await requireAuth();
  const displayName = me.fullName?.trim() || me.username || "משתמש";
  return (
    <header className="adm-dash-home-bar adm-dash-reveal">
      <p className="adm-dash-home-bar__greet">
        שלום, <strong>{displayName}</strong>
      </p>
    </header>
  );
}
