"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { NavIconId, NavItemDef, NavSectionDef } from "@/lib/sidebar-nav";
import {
  BarChart3,
  ClipboardCheck,
  CreditCard,
  Database,
  FileSpreadsheet,
  Home,
  ListOrdered,
  LogOut,
  PlusCircle,
  ScrollText,
  Settings,
  CircleDollarSign,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { logoutAction } from "@/app/admin/actions";

function NavIcon({ id }: { id: NavIconId }) {
  const common = { size: 18 as const };
  switch (id) {
    case "home":
      return <Home {...common} />;
    case "users":
      return <Users {...common} />;
    case "orderIn":
      return <PlusCircle {...common} />;
    case "orderList":
      return <ListOrdered {...common} />;
    case "import":
      return <FileSpreadsheet {...common} />;
    case "payIn":
      return <Wallet {...common} />;
    case "receipt":
      return <ClipboardCheck {...common} />;
    case "ledger":
      return <CreditCard {...common} />;
    case "balances":
      return <TrendingUp {...common} />;
    case "sourceTables":
      return <Database {...common} />;
    case "reports":
      return <BarChart3 {...common} />;
    case "activity":
      return <ScrollText {...common} />;
    case "settings":
      return <Settings {...common} />;
    case "finance":
      return <CircleDollarSign {...common} />;
    default:
      return <Home {...common} />;
  }
}

function resolveNavHref(item: NavItemDef, sp: URLSearchParams): string {
  if (item.href === "/admin") {
    const p = new URLSearchParams();
    for (const key of ["week", "from", "to"] as const) {
      const v = sp.get(key);
      if (v) p.set(key, v);
    }
    const qs = p.toString();
    return qs ? `/admin?${qs}` : "/admin";
  }

  if (item.href.startsWith("/admin?")) {
    const base = new URL(item.href, "http://local.invalid");
    const out = new URLSearchParams(base.search);
    for (const key of ["week", "from", "to"] as const) {
      const v = sp.get(key);
      if (v) out.set(key, v);
    }
    const qs = out.toString();
    return `/admin?${qs}`;
  }

  return item.href;
}

function linkActive(pathname: string, itemHref: string, resolvedHref: string, sp: URLSearchParams): boolean {
  if (itemHref === "/admin") {
    return pathname === "/admin" && !sp.get("modal");
  }

  const q = resolvedHref.indexOf("?");
  const path = q >= 0 ? resolvedHref.slice(0, q) : resolvedHref;
  const query = q >= 0 ? resolvedHref.slice(q + 1) : "";

  if (!query) {
    return pathname === resolvedHref || pathname.startsWith(`${resolvedHref}/`);
  }

  if (pathname !== path) return false;
  const want = new URLSearchParams(query);
  for (const [k, v] of want.entries()) {
    if (sp.get(k) !== v) return false;
  }
  return true;
}

function NavBlock({ section, pathname, sp }: { section: NavSectionDef; pathname: string; sp: URLSearchParams }) {
  return (
    <div className="adm-nav-section">
      <div className="adm-nav-label">{section.title}</div>
      {section.items.map((item) => {
        const resolved = resolveNavHref(item, sp);
        return (
          <Link
            key={resolved}
            href={resolved}
            className="adm-nav-link"
            data-active={linkActive(pathname, item.href, resolved, sp) ? "true" : "false"}
          >
            <NavIcon id={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AdminSidebar({ sections }: { sections: NavSectionDef[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <aside className="adm-sidebar">
      <div className="adm-brand">
        <div className="adm-brand-title">וויגו פרו</div>
        <div className="adm-brand-sub">ניהול משלוחים ותשלומים</div>
      </div>
      <nav className="adm-nav">
        {sections.map((section) => (
          <NavBlock key={section.title} section={section} pathname={pathname} sp={sp} />
        ))}
      </nav>
      <div className="adm-sidebar-foot">
        <form action={logoutAction}>
          <button
            type="submit"
            className="adm-nav-link"
            style={{ width: "100%", border: "none", background: "transparent", cursor: "pointer" }}
          >
            <LogOut size={18} />
            יציאה
          </button>
        </form>
      </div>
    </aside>
  );
}
