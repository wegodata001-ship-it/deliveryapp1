import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/admin-auth";
import { LoginForm } from "./LoginForm";
import "./admin-login.css";

export const dynamic = "force-dynamic";

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
        <div className="al-brand">
          <h1>וויגו פרו</h1>
          <p>מערכת ניהול משלוחים, תשלומים ולקוחות</p>
        </div>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
