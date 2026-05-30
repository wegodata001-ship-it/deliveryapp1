import { redirect } from "next/navigation";
import { WegoWMarkSvg } from "@/components/brand/WegoWMarkSvg";
import { hasValidAdminSession } from "@/lib/session";
import { withPerfTimer } from "@/lib/perf-log";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return withPerfTimer("login.page", async () => {
    const loggedIn = await hasValidAdminSession();
    if (loggedIn) redirect("/admin");

    const sp = await withPerfTimer("login.searchParams", () => searchParams);
    const nextPath =
      sp.next && sp.next.startsWith("/admin") && !sp.next.startsWith("//") ? sp.next : "/admin";

    return (
      <div className="al-page" dir="rtl" lang="he">
        <div className="al-card">
          <header className="al-header">
            <div className="al-logo-wrap adm-brand-logo adm-brand-logo--erp" style={{ width: 72, height: 72 }}>
              <WegoWMarkSvg size={72} />
            </div>
            <h1>וויגו פרו — מערכת לוגיסטיקה</h1>
          </header>
          <LoginForm nextPath={nextPath} />
        </div>
      </div>
    );
  });
}
