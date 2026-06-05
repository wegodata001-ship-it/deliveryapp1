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
        <div className="al-page__glow" aria-hidden />
        <div className="al-card">
          <header className="al-header">
            <div className="al-logo-wrap adm-brand-logo adm-brand-logo--erp">
              <WegoWMarkSvg size={104} />
            </div>
            <h1 className="al-title" dir="ltr" lang="en">
              WEGO ERP
            </h1>
            <p className="al-tagline" dir="ltr" lang="en">
              Business Logistics &amp; Financial Control Center
            </p>
          </header>
          <LoginForm nextPath={nextPath} />
        </div>
      </div>
    );
  });
}
