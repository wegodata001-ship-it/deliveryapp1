"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listCustomersModuleAction } from "@/app/admin/customers/actions";
import type { CustomersModuleListRow } from "@/lib/customers-module-types";
import { formatFromInternalSigned } from "@/lib/customer-balance";
import { parseMoneyStringOrZero } from "@/lib/money-format";

const LIMIT = 25;

function balanceClass(balanceUsd: string): string {
  const n = parseMoneyStringOrZero(balanceUsd);
  const view = formatFromInternalSigned(n, "USD");
  if (view.kind === "debt") return "adm-cust-module-amt adm-cust-module-amt--debt";
  if (view.kind === "credit") return "adm-cust-module-amt adm-cust-module-amt--credit";
  return "adm-cust-module-amt adm-cust-module-amt--even";
}

function balanceText(balanceUsd: string): string {
  return formatFromInternalSigned(parseMoneyStringOrZero(balanceUsd), "USD").amountFormatted;
}

export function CustomersListClient() {
  const [rows, setRows] = useState<CustomersModuleListRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true);
    setError(null);
    const res = await listCustomersModuleAction({ page: p, limit: LIMIT, search: q });
    if (res && "ok" in res && res.ok === false) {
      setError(res.error);
      setRows([]);
      setHasMore(false);
    } else if (res && "rows" in res) {
      setRows(res.rows);
      setHasMore(res.hasMore);
      setPage(res.page);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(1, search);
  }, [load, search]);

  return (
    <section className="adm-cust-module-list">
      <header className="adm-cust-module-list-head">
        <div>
          <h2 className="adm-cust-module-list-title">לקוחות</h2>
          <p className="adm-cust-module-list-sub">תיק לקוח · סיכום הזמנות, תשלומים ויתרה</p>
        </div>
        <form
          className="adm-cust-module-list-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchDraft.trim());
            setPage(1);
          }}
        >
          <input
            className="adm-filter-input"
            placeholder="חיפוש לפי קוד, שם או טלפון"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <button type="submit" className="adm-btn adm-btn--primary adm-btn--sm">
            חפש
          </button>
          {search ? (
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--sm"
              onClick={() => {
                setSearchDraft("");
                setSearch("");
              }}
            >
              נקה
            </button>
          ) : null}
        </form>
      </header>

      {error ? <div className="adm-error adm-error--compact">{error}</div> : null}

      <div className="adm-cust-module-table-wrap" aria-busy={loading}>
        <table className="adm-table adm-table--dense adm-cust-module-table">
          <thead>
            <tr>
              <th>קוד</th>
              <th>שם לקוח</th>
              <th>טלפון</th>
              <th>מדינה</th>
              <th>סה״כ הזמנות</th>
              <th>סה״כ תשלומים</th>
              <th>יתרה</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}>טוען…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>לא נמצאו לקוחות</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td dir="ltr">{r.code}</td>
                  <td>{r.name}</td>
                  <td dir="ltr">{r.phone}</td>
                  <td>{r.country}</td>
                  <td dir="ltr" className="adm-cust-module-amt">
                    $ {r.ordersTotalUsd}
                  </td>
                  <td dir="ltr" className="adm-cust-module-amt">
                    $ {r.paymentsTotalUsd}
                  </td>
                  <td dir="ltr" className={balanceClass(r.balanceUsd)}>
                    {balanceText(r.balanceUsd)}
                  </td>
                  <td>
                    <Link href={`/admin/customers/${r.id}`} className="adm-btn adm-btn--ghost adm-btn--xs">
                      צפייה
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="adm-cust-module-pager">
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          disabled={page <= 1 || loading}
          onClick={() => void load(page - 1, search)}
        >
          קודם
        </button>
        <span>עמוד {page}</span>
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          disabled={!hasMore || loading}
          onClick={() => void load(page + 1, search)}
        >
          הבא
        </button>
      </div>
    </section>
  );
}
