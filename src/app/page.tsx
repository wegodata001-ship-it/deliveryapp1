import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { WegoWMarkSvg } from "@/components/brand/WegoWMarkSvg";

export default function Home() {
  return (
    <main className="wego-home" dir="rtl" lang="he">
      <div className="wego-home__glow" aria-hidden />
      <div className="wego-home__card">
        <div className="wego-home__logo">
          <WegoWMarkSvg size={104} />
        </div>
        <h1 className="wego-home__title" dir="ltr" lang="en">
          WEGO ERP
        </h1>
        <p className="wego-home__sub" dir="ltr" lang="en">
          Business Logistics &amp; Financial Control Center
        </p>
        <Link href="/admin-login" className="wego-home__cta">
          כניסה למערכת
        </Link>
        <ul className="wego-home__features" aria-label="יכולות המערכת">
          <li><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden /> ניהול הזמנות</li>
          <li><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden /> ניהול תשלומים</li>
          <li><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden /> דוחות ויתרות</li>
        </ul>
      </div>
    </main>
  );
}
