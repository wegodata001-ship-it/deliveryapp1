import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/admin-auth";
import { LoginForm } from "./LoginForm";
import { WegoBrandLogo } from "@/components/admin/WegoBrandLogo";
import "./admin-login.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const logged = await getCurrentUser();
  if (logged) redirect("/admin");

  const sp = await searchParams;
  const nextPath =
    sp.next && sp.next.startsWith("/admin") && !sp.next.startsWith("//") ? sp.next : "/admin";

  return (
    <div className="al-page" dir="rtl" lang="he">
      <div className="al-card">
        <header className="al-header">
          <WegoBrandLogo size={72} className="al-logo-wrap" />
          <h1>וויגו פרו — מערכת לוגיסטיקה</h1>
        </header>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
