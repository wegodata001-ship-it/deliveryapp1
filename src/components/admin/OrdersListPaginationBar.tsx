"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { OrdersListPagination } from "@/components/admin/OrdersListShell";

type Props = {
  pagination: OrdersListPagination;
  label: string;
};

function pageHref(sp: URLSearchParams, page: number): string {
  const n = new URLSearchParams(sp.toString());
  if (page <= 1) n.delete("page");
  else n.set("page", String(page));
  const qs = n.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

export function OrdersListPaginationBar({ pagination, label }: Props) {
  const searchParams = useSearchParams();
  const { page, totalPages } = pagination;

  const links = useMemo(() => {
    const sp = new URLSearchParams(searchParams.toString());
    return {
      prev: page > 1 ? pageHref(sp, page - 1) : null,
      next: page < totalPages ? pageHref(sp, page + 1) : null,
    };
  }, [page, totalPages, searchParams]);

  if (pagination.totalCount === 0) {
    return (
      <p className="adm-orders-pagination" dir="rtl">
        {label}
      </p>
    );
  }

  return (
    <nav className="adm-orders-pagination" dir="rtl" aria-label="עימוד רשימת הזמנות">
      <span className="adm-orders-pagination__label">{label}</span>
      <span className="adm-orders-pagination__actions">
        {links.prev ? (
          <Link href={links.prev} className="adm-btn adm-btn--ghost adm-btn--dense">
            הקודם
          </Link>
        ) : (
          <span className="adm-btn adm-btn--ghost adm-btn--dense" aria-disabled="true">
            הקודם
          </span>
        )}
        <span className="adm-orders-pagination__page" aria-current="page">
          עמוד {page.toLocaleString("he-IL")} / {totalPages.toLocaleString("he-IL")}
        </span>
        {links.next ? (
          <Link href={links.next} className="adm-btn adm-btn--ghost adm-btn--dense">
            הבא
          </Link>
        ) : (
          <span className="adm-btn adm-btn--ghost adm-btn--dense" aria-disabled="true">
            הבא
          </span>
        )}
      </span>
    </nav>
  );
}
