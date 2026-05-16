import fs from "fs";

const p = "src/components/admin/CustomerBalancesClient.tsx";
let s = fs.readFileSync(p, "utf8");

// 1) imports
if (!s.includes("AhWeekNavBar")) {
  s = s.replace(
    'import { useCallback, useEffect, useMemo, useState } from "react";',
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
  );
  s = s.replace(
    'import { TableSkeleton } from "@/components/ui/loading";',
    `import { AhWeekNavBar } from "@/components/admin/AhWeekNavButtons";
import { TableSkeleton } from "@/components/ui/loading";
import { goToNextWeek, goToPrevWeek } from "@/lib/weeks/ah-week-nav";`,
  );
}

// 2) loading state
s = s.replace(
  "  const { runWithLoading, isLoading } = useAdminLoading();\n\n  const [urlReady",
  `  const { runWithLoading } = useAdminLoading();
  const [tableLoading, setTableLoading] = useState(false);
  const fetchGenRef = useRef(0);

  const [urlReady`,
);

// 3) debounce 300
s = s.replace("    }, 400);", "    }, 300);");

// 4) fetch effect
const oldFetch = `  useEffect(() => {
    if (!urlReady) return;
    let cancelled = false;
    setErr(null);
    void runWithLoading(
      () =>
        listCustomerBalancesAction({
          page,
          limit: LIMIT,
          fromYmd: balancesFilters.fromYmd,
          toYmd: balancesFilters.toYmd,
          weekCode: weekCodeForQuery,
          uptoWeekCode: balancesFilters.uptoWeekCode.trim() || undefined,
          sourceCountry: balancesFilters.sourceCountry,
          filters: {
            smart: debouncedSearch.smart.trim() || undefined,
            minBalanceIls: debouncedSearch.minBalanceIls,
            maxBalanceIls: debouncedSearch.maxBalanceIls,
            balanceDebtStatus: balancesFilters.balanceDebtStatus,
            sort: balancesFilters.sort,
            currencyView: balancesFilters.currencyView || undefined,
          },
        }),
      { message: "טוען יתרות...", mode: "bar" },
    ).then((next) => {
      if (cancelled) return;
      setPayload(next);
    });
    return () => {
      cancelled = true;
    };
  }, [urlReady, page, balancesFilters, debouncedSearch, weekCodeForQuery, runWithLoading]);`;

const newFetch = `  useEffect(() => {
    if (!urlReady) return;
    const gen = ++fetchGenRef.current;
    setTableLoading(true);
    setErr(null);
    void listCustomerBalancesAction({
      page,
      limit: LIMIT,
      fromYmd: balancesFilters.fromYmd,
      toYmd: balancesFilters.toYmd,
      weekCode: weekCodeForQuery,
      uptoWeekCode: balancesFilters.uptoWeekCode.trim() || undefined,
      sourceCountry: balancesFilters.sourceCountry,
      filters: {
        smart: debouncedSearch.smart.trim() || undefined,
        minBalanceIls: debouncedSearch.minBalanceIls,
        maxBalanceIls: debouncedSearch.maxBalanceIls,
        balanceDebtStatus: balancesFilters.balanceDebtStatus,
        sort: balancesFilters.sort,
        currencyView: balancesFilters.currencyView || undefined,
      },
    })
      .then((next) => {
        if (gen !== fetchGenRef.current) return;
        setPayload(next);
      })
      .catch(() => {
        if (gen !== fetchGenRef.current) return;
        setErr("טעינת יתרות נכשלה");
      })
      .finally(() => {
        if (gen !== fetchGenRef.current) return;
        setTableLoading(false);
      });
  }, [
    urlReady,
    page,
    balancesFilters.fromYmd,
    balancesFilters.toYmd,
    balancesFilters.uptoWeekCode,
    balancesFilters.sourceCountry,
    balancesFilters.balanceDebtStatus,
    balancesFilters.sort,
    balancesFilters.currencyView,
    debouncedSearch.smart,
    debouncedSearch.minBalanceIls,
    debouncedSearch.maxBalanceIls,
    weekCodeForQuery,
  ]);`;

if (!s.includes("fetchGenRef")) {
  s = s.replace(oldFetch, newFetch);
}

// 5) tableBusy + helpers
s = s.replace(
  "  const tableBusy = !urlReady || isLoading;\n\n  const syncUrl",
  `  const tableBusy = !urlReady || (tableLoading && !payload);

  const applySearchNow = useCallback(() => {
    setDebouncedSearch(searchDraft);
    setPage(1);
  }, [searchDraft]);

  const navAhWeek = useCallback(
    (delta: -1 | 1) => {
      const base =
        balancesFilters.weekCode === "—" || !balancesFilters.weekCode.trim()
          ? DEFAULT_WEEK_CODE
          : balancesFilters.weekCode;
      const code = delta === -1 ? goToPrevWeek(base) : goToNextWeek(base);
      if (!code) return;
      const r = getAhWeekRange(code);
      if (!r) return;
      setBalancesFilters((f) => ({ ...f, weekCode: code, fromYmd: r.from, toYmd: r.to }));
      setWeekInput(code);
      setPage(1);
    },
    [balancesFilters.weekCode],
  );

  const syncUrl`,
);

// 6) changeStatus
s = s.replace("    if (isLoading) return;", "    if (tableLoading) return;");

// 7) Remove disabled={isLoading} from filters
s = s.replace(/\n\s*disabled=\{isLoading\}/g, "");

// 8) Week nav in primary row
const oldWeekBlock = `          <label className="adm-balances-field">
            <span className="adm-balances-field-label">שבוע AH</span>
            <motion.div className="adm-balances-week-wrap">
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={weekInput}
                placeholder={DEFAULT_WEEK_CODE}
                onChange={(e) => setWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurWeekInput}
              />
              <datalist id="adm-balances-week-options">
                {weekOptions.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </motion.div>
          </label>`;

const newWeekBlock = `          <label className="adm-balances-field adm-balances-field--week-nav">
            <span className="adm-balances-field-label">שבוע AH</span>
            <AhWeekNavBar
              className="adm-balances-week-control"
              buttonClassName="adm-balances-week-step"
              variant="angle"
              onPrev={() => navAhWeek(-1)}
              onNext={() => navAhWeek(1)}
            >
              <input
                className="adm-balances-input adm-balances-input--week"
                type="text"
                list="adm-balances-week-options"
                value={weekInput}
                placeholder={DEFAULT_WEEK_CODE}
                dir="ltr"
                onChange={(e) => setWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurWeekInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <datalist id="adm-balances-week-options">
                {weekOptions.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </AhWeekNavBar>
          </label>`;

s = s.replace(
  oldWeekBlock.replaceAll("motion.div", "motion.div"),
  newWeekBlock,
);
s = s.replace(
  `          <label className="adm-balances-field">
            <span className="adm-balances-field-label">שבוע AH</span>
            <motion.div className="adm-balances-week-wrap">
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={weekInput}
                placeholder={DEFAULT_WEEK_CODE}
                onChange={(e) => setWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurWeekInput}
              />
              <datalist id="adm-balances-week-options">
                {weekOptions.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </motion.div>
          </label>`,
  newWeekBlock.replaceAll("motion.div", "motion.div"),
);

// try div version
if (!s.includes("AhWeekNavBar")) {
  s = s.replace(
    `          <label className="adm-balances-field">
            <span className="adm-balances-field-label">שבוע AH</span>
            <motion.div className="adm-balances-week-wrap">
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={weekInput}
                placeholder={DEFAULT_WEEK_CODE}
                onChange={(e) => setWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurWeekInput}
              />
              <datalist id="adm-balances-week-options">
                {weekOptions.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </motion.div>
          </label>`,
    newWeekBlock,
  );
}

if (!s.includes("adm-balances-field--week-nav")) {
  s = s.replace(
    `          <label className="adm-balances-field">
            <span className="adm-balances-field-label">שבוע AH</span>
            <motion.div className="adm-balances-week-wrap">
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={weekInput}
                placeholder={DEFAULT_WEEK_CODE}
                onChange={(e) => setWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurWeekInput}
              />
              <datalist id="adm-balances-week-options">
                {weekOptions.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </motion.div>
          </label>`,
    newWeekBlock,
  );
}

// actual div in file
if (!s.includes("adm-balances-field--week-nav")) {
  s = s.replace(
    `          <label className="adm-balances-field">
            <span className="adm-balances-field-label">שבוע AH</span>
            <motion.div className="adm-balances-week-wrap">
`,
    `          <label className="adm-balances-field adm-balances-field--week-nav">
            <span className="adm-balances-field-label">שבוע AH</span>
            <AhWeekNavBar
              className="adm-balances-week-control"
              buttonClassName="adm-balances-week-step"
              variant="angle"
              onPrev={() => navAhWeek(-1)}
              onNext={() => navAhWeek(1)}
            >
`,
  );
}

fs.writeFileSync(p, s);
console.log("partial patch, week nav:", s.includes("adm-balances-field--week-nav"));
