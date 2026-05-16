import Link from "next/link";
import { WegoBrandLogo } from "@/components/admin/WegoBrandLogo";

export default function Home() {
  return (
    <main className="wego-home" dir="rtl" lang="he">
      <div className="wego-home__card">
        <WegoBrandLogo size={64} />
        <h1 className="wego-home__title">וויגו פרו — מערכת לוגיסטיקה</h1>
        <p className="wego-home__sub">פלטפורמת תפעול לוגיסטי</p>
        <Link href="/admin-login" className="wego-home__cta">
          כניסה למערכת
        </Link>
      </div>
    </main>
  );
}
