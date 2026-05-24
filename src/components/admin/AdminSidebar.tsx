"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHydratedSearchParams } from "@/lib/use-hydrated-search-params";
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
  UserPlus,
  CircleDollarSign,
  ClipboardList,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { WegoBrandLogo } from "@/components/admin/WegoBrandLogo";
import { useAdminFinancialModal } from "@/components/admin/AdminFinancialModalContext";
import { useAdminNavLayout } from "@/components/admin/AdminNavLayoutContext";
import type { AdminWindowPayload } from "@/lib/admin-windows";

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
    case "customerNew":
      return <UserPlus {...common} />;
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
    case "editRequests":
      return <ClipboardList {...common} />;
    default:
      return <Home {...common} />;
  }
}

const ORDERS_LIST_KEYS = [
  "ordersWeek",
  "ordersFrom",
  "ordersTo",
  "ordersPreset",
  "preset",
  "ordersCountry",
  "q",
  "status",
  "createdBy",
  "paymentType",
  "amountMin",
  "amountMax",
] as const;

function resolveNavHref(item: NavItemDef, sp: URLSearchParams): string {
  const globals = new URLSearchParams();
  for (const key of ["week", "from", "to", "country"] as const) {
    const v = sp.get(key);
    if (v) globals.set(key, v);
  }

  if (item.href === "/admin") {
    const qs = globals.toString();
    return qs ? `/admin?${qs}` : "/admin";
  }

  if (item.href.startsWith("/admin?")) {
    const base = new URL(item.href, "http://local.invalid");
    const out = new URLSearchParams(base.search);
    for (const [k, v] of globals.entries()) out.set(k, v);
    const qs = out.toString();
    return `/admin?${qs}`;
  }

  if (item.href.startsWith("/admin/")) {
    const u = new URL(item.href, "http://local.invalid");
    const out = new URLSearchParams(u.search);
    for (const [k, v] of globals.entries()) out.set(k, v);
    if (u.pathname === "/admin/orders" || u.pathname.startsWith("/admin/orders/")) {
      for (const key of ORDERS_LIST_KEYS) {
        const v = sp.get(key);
        if (v) out.set(key, v);
      }
    }
    const qs = out.toString();
    return qs ? `${u.pathname}?${qs}` : u.pathname;
  }

  return item.href;
}

function linkActive(pathname: string, item: NavItemDef, resolvedHref: string, sp: URLSearchParams): boolean {
  if (item.href === "/admin" && !item.openWindow) {
    return pathname === "/admin" && !sp.get("modal");
  }

  const q = resolvedHref.indexOf("?");
  const path = q >= 0 ? resolvedHref.slice(0, q) : resolvedHref;
  const query = q >= 0 ? resolvedHref.slice(q + 1) : "";

  if (!query) {
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  if (pathname !== path) return false;
  const want = new URLSearchParams(query);
  for (const [k, v] of want.entries()) {
    if (sp.get(k) !== v) return false;
  }
  return true;
}

function NavBlock({
  section,
  pathname,
  sp,
  openWindow,
  navBadges,
  onNavigate,
}: {
  section: NavSectionDef;
  pathname: string;
  sp: URLSearchParams;
  openWindow: (p: AdminWindowPayload) => void;
  navBadges?: { pendingOrderEditRequests?: number };
  onNavigate?: () => void;
}) {
  const { openFinancialModal } = useAdminFinancialModal();

  return (
    <div className="adm-nav-section">
      <div className="adm-nav-label">{section.title}</div>
      {section.items.map((item) => {
        const resolved = resolveNavHref(item, sp);
        const active =
          item.openWindow || item.openFinancialModal ? false : linkActive(pathname, item, resolved, sp);
        const key = `${section.title}-${item.label}-${item.openWindow?.type ?? item.openFinancialModal ? "fin" : "link"}`;
        if (item.openFinancialModal) {
          return (
            <button
              key={key}
              type="button"
              className="adm-nav-link adm-nav-link--action"
              data-active={active ? "true" : "false"}
              onClick={() => {
                openFinancialModal();
                onNavigate?.();
              }}
            >
              <NavIcon id={item.icon} />
              <span className="adm-nav-link__label">{item.label}</span>
            </button>
          );
        }
        if (item.openWindow) {
          return (
            <button
              key={key}
              type="button"
              className="adm-nav-link adm-nav-link--action"
              data-active={active ? "true" : "false"}
              onClick={() => {
                openWindow(item.openWindow!);
                onNavigate?.();
              }}
            >
              <NavIcon id={item.icon} />
              <span className="adm-nav-link__label">{item.label}</span>
            </button>
          );
        }
        const editReqBadge =
          item.href === "/admin/order-edit-requests" && navBadges?.pendingOrderEditRequests
            ? navBadges.pendingOrderEditRequests
            : 0;
        const disablePrefetch = item.href === "/admin" || item.href === "/admin/";
        return (
          <Link
            key={key}
            href={resolved}
            prefetch={disablePrefetch ? false : undefined}
            className="adm-nav-link"
            data-active={active ? "true" : "false"}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate?.()}
          >
            <NavIcon id={item.icon} />
            <span className="adm-nav-link__label">{item.label}</span>
            {editReqBadge > 0 ? (
              <span className="adm-nav-badge" aria-label={`${editReqBadge} בקשות ממתינות`}>
                {editReqBadge > 99 ? "99+" : editReqBadge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export function AdminSidebar({
  sections,
  navBadges,
}: {
  sections: NavSectionDef[];
  navBadges?: { pendingOrderEditRequests?: number };
}) {
  const pathname = usePathname();
  const sp = useHydratedSearchParams();
  const { openWindow } = useAdminWindows();
  const closeNav = useAdminNavLayout()?.closeNav;

  return (
    <aside className="adm-sidebar">
      <div className="adm-brand">
        <WegoBrandLogo />
        <p className="adm-brand-title">וויגו פרו — מערכת לוגיסטיקה</p>
      </div>
      <nav className="adm-nav">
        {sections.map((section) => (
          <NavBlock
            key={section.title}
            section={section}
            pathname={pathname}
            sp={sp}
            openWindow={openWindow}
            navBadges={navBadges}
            onNavigate={closeNav}
          />
        ))}
      </nav>
      <div className="adm-sidebar-foot">
        <form action="/admin/logout" method="post">
          <button
            type="submit"
            className="adm-nav-link"
            style={{ width: "100%", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => closeNav?.()}
          >
            <LogOut size={18} />
            <span className="adm-nav-link__label">יציאה</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
