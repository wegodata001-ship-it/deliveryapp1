"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { getActiveWorkWeekRange } from "@/lib/active-work-week";
import { BALANCES_TO_PARAM, BALANCES_WEEK_PARAM } from "@/lib/balances-week-filter";
import { balancesSnapshotToYmd } from "@/lib/work-week";
import { useHydratedSearchParams } from "@/lib/use-hydrated-search-params";
import type { NavGroupDef, NavIconId, NavItemDef } from "@/lib/sidebar-nav";
import { navGroupIdForPathname } from "@/lib/sidebar-nav";
import {
  BarChart3,
  ClipboardCheck,
  CreditCard,
  Database,
  FileSpreadsheet,
  Home,
  ListOrdered,
  PlusCircle,
  Scale,
  ScrollText,
  Settings,
  UserPlus,
  CircleDollarSign,
  ClipboardList,
  Coins,
  TrendingUp,
  Users,
  Wallet,
  Archive,
  Truck,
} from "lucide-react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { WegoBrandLogo } from "@/components/admin/WegoBrandLogo";
import { useAdminFinancialModal } from "@/components/admin/AdminFinancialModalContext";
import { resolveGlobalCountry } from "@/lib/current-country";
import { resolveShipmentNavHref } from "@/lib/shipment-country-scope.shared";
import { useAdminNavLayout } from "@/components/admin/AdminNavLayoutContext";
import type { AdminWindowPayload } from "@/lib/admin-windows";

function NavIcon({ id }: { id: NavIconId }) {
  const common = { size: 18 as const, strokeWidth: 2 as const };
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
    case "reconcile":
      return <Scale {...common} />;
    case "cashbox":
      return <Coins {...common} />;
    case "documents":
      return <Archive {...common} />;
    case "shipments":
      return <Truck {...common} />;
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

const ACTIVE_WEEK_NAV_PATHS = new Set(["/admin/orders", "/admin/balances"]);

function applyActiveWorkWeekToParams(out: URLSearchParams, pathname: string, globalSp: URLSearchParams): void {
  const active = getActiveWorkWeekRange();
  if (pathname === "/admin/balances") {
    for (const key of ["week", "from", "to"] as const) {
      const v = globalSp.get(key);
      if (v) out.set(key, v);
    }
    out.set(BALANCES_WEEK_PARAM, active.weekCode);
    out.set(BALANCES_TO_PARAM, balancesSnapshotToYmd(active.weekCode));
    out.delete("upto");
    return;
  }
  out.set("week", active.weekCode);
  out.set("from", active.fromYmd);
  out.set("to", active.toYmd);
  if (pathname === "/admin/orders") {
    out.set("ordersWeek", active.weekCode);
    out.set("ordersFrom", active.fromYmd);
    out.set("ordersTo", active.toYmd);
    out.delete("ordersPreset");
    out.delete("preset");
  }
}

function resolveNavHref(item: NavItemDef, sp: URLSearchParams, pathname: string): string {
  const globals = new URLSearchParams();
  for (const key of ["week", "from", "to"] as const) {
    const v = sp.get(key);
    if (v) globals.set(key, v);
  }
  globals.set("country", resolveGlobalCountry(sp.get("country")));

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
    const resolvedPath =
      u.pathname.startsWith("/admin/shipments") && u.pathname !== "/admin/shipments"
        ? resolveShipmentNavHref(u.pathname, pathname)
        : u.pathname;
    const out = new URLSearchParams(u.search);
    if (ACTIVE_WEEK_NAV_PATHS.has(u.pathname)) {
      applyActiveWorkWeekToParams(out, u.pathname, sp);
      out.set("country", resolveGlobalCountry(sp.get("country")));
    } else {
      for (const [k, v] of globals.entries()) out.set(k, v);
      if (u.pathname === "/admin/orders" || u.pathname.startsWith("/admin/orders/")) {
        for (const key of ORDERS_LIST_KEYS) {
          const v = sp.get(key);
          if (v) out.set(key, v);
        }
      }
    }
    const qs = out.toString();
    return qs ? `${resolvedPath}?${qs}` : resolvedPath;
  }

  return item.href;
}

function linkActive(pathname: string, item: NavItemDef, resolvedHref: string, sp: URLSearchParams): boolean {
  if (item.href === "/admin" && !item.openWindow && !item.openFinancialModal) {
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

function NavItemLink({
  item,
  itemKey,
  pathname,
  sp,
  openWindow,
  navBadges,
  onNavigate,
  nested,
}: {
  item: NavItemDef;
  itemKey: string;
  pathname: string;
  sp: URLSearchParams;
  openWindow: (p: AdminWindowPayload) => void;
  navBadges?: { pendingOrderEditRequests?: number; pendingInvoiceCancelRequests?: number };
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const { openFinancialModal } = useAdminFinancialModal();
  const resolved = resolveNavHref(item, sp, pathname);
  const active =
    item.openWindow || item.openFinancialModal ? false : linkActive(pathname, item, resolved, sp);
  const linkClass = nested ? "adm-nav-link adm-nav-link--nested" : "adm-nav-link";

  if (item.openFinancialModal) {
    return (
      <button
        key={itemKey}
        type="button"
        className={`${linkClass} adm-nav-link--action`}
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
        key={itemKey}
        type="button"
        className={`${linkClass} adm-nav-link--action`}
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
    item.href === "/admin/edit-requests"
      ? (navBadges?.pendingOrderEditRequests ?? 0) + (navBadges?.pendingInvoiceCancelRequests ?? 0)
      : item.href === "/admin/order-edit-requests" && navBadges?.pendingOrderEditRequests
        ? navBadges.pendingOrderEditRequests
        : item.href === "/admin/invoice-cancel-requests" && navBadges?.pendingInvoiceCancelRequests
          ? navBadges.pendingInvoiceCancelRequests
          : 0;
  const disablePrefetch = item.href === "/admin" || item.href === "/admin/";

  return (
    <Link
      key={itemKey}
      href={resolved}
      prefetch={disablePrefetch ? false : undefined}
      className={linkClass}
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
}

function NavAccordionGroup({
  group,
  expanded,
  onToggle,
  pathname,
  sp,
  openWindow,
  navBadges,
  onNavigate,
}: {
  group: NavGroupDef;
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
  sp: URLSearchParams;
  openWindow: (p: AdminWindowPayload) => void;
  navBadges?: { pendingOrderEditRequests?: number; pendingInvoiceCancelRequests?: number };
  onNavigate?: () => void;
}) {
  const activeGroupId = navGroupIdForPathname(pathname);
  const groupActive = activeGroupId === group.id;

  return (
    <div
      className="adm-nav-group"
      data-expanded={expanded ? "true" : "false"}
      data-active-group={groupActive ? "true" : "false"}
    >
      <button
        type="button"
        className="adm-nav-group__header"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <NavIcon id={group.groupIcon} />
        <span className="adm-nav-group__label">{group.label}</span>
        <ChevronDown size={16} className="adm-nav-group__chevron" aria-hidden />
      </button>
      <div className="adm-nav-group__items" hidden={!expanded}>
        {group.items.map((item) => (
          <NavItemLink
            key={`${group.id}-${item.label}-${item.openWindow?.type ?? item.openFinancialModal ? "action" : item.href}`}
            item={item}
            itemKey={`${group.id}-${item.label}`}
            pathname={pathname}
            sp={sp}
            openWindow={openWindow}
            navBadges={navBadges}
            onNavigate={onNavigate}
            nested
          />
        ))}
      </div>
    </div>
  );
}

export function AdminSidebar({
  groups,
  homeItem,
  navBadges,
}: {
  groups: NavGroupDef[];
  homeItem?: NavItemDef | null;
  navBadges?: { pendingOrderEditRequests?: number; pendingInvoiceCancelRequests?: number };
}) {
  const pathname = usePathname();
  const sp = useHydratedSearchParams();
  const { openWindow } = useAdminWindows();
  const closeNav = useAdminNavLayout()?.closeNav;

  const routeGroupId = useMemo(() => navGroupIdForPathname(pathname), [pathname]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(routeGroupId ? [routeGroupId] : []));

  useEffect(() => {
    if (!routeGroupId) return;
    setExpanded((prev) => {
      if (prev.has(routeGroupId)) return prev;
      const next = new Set(prev);
      next.add(routeGroupId);
      return next;
    });
  }, [routeGroupId]);

  const toggleGroup = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <aside className="adm-sidebar">
      <div className="adm-brand">
        <WegoBrandLogo />
        <p className="adm-brand-title">וויגו פרו — מערכת לוגיסטיקה</p>
      </div>
      <nav className="adm-nav">
        {homeItem ? (
          <div className="adm-nav-home">
            <NavItemLink
              item={homeItem}
              itemKey="home"
              pathname={pathname}
              sp={sp}
              openWindow={openWindow}
              navBadges={navBadges}
              onNavigate={closeNav ?? undefined}
            />
          </div>
        ) : null}
        {groups.map((group) => (
          <NavAccordionGroup
            key={group.id}
            group={group}
            expanded={expanded.has(group.id)}
            onToggle={() => toggleGroup(group.id)}
            pathname={pathname}
            sp={sp}
            openWindow={openWindow}
            navBadges={navBadges}
            onNavigate={closeNav ?? undefined}
          />
        ))}
      </nav>
      <div className="adm-sidebar-foot">
        <form action="/admin/logout" method="post">
          <button
            type="submit"
            className="adm-nav-link adm-nav-link--action"
            onClick={() => closeNav?.()}
          >
            <LogOut size={18} strokeWidth={2} />
            <span className="adm-nav-link__label">יציאה</span>
          </button>
        </form>
      </div>
    </aside>
  );
}

/** @deprecated — תאימות; העברו groups + homeItem */
export function AdminSidebarLegacy({
  sections,
  navBadges,
}: {
  sections: { title: string; items: NavItemDef[] }[];
  navBadges?: { pendingOrderEditRequests?: number; pendingInvoiceCancelRequests?: number };
}) {
  const homeSection = sections.find((s) => s.title === "ראשי");
  const homeItem = homeSection?.items[0] ?? null;
  const groups: NavGroupDef[] = sections
    .filter((s) => s.title !== "ראשי")
    .map((s, i) => ({
      id: `legacy-${i}`,
      label: s.title,
      groupIcon: "settings" as NavIconId,
      items: s.items,
    }));
  return <AdminSidebar groups={groups} homeItem={homeItem} navBadges={navBadges} />;
}
