import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "../src/components/admin/CustomerBalancesClient.tsx");
let s = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");

const markerStart = '            <span className="adm-balances-field-label">עד שבוע AH (צבירה)</span>';
const markerEnd = "      {balancesScopeSubtitle(balancesFilters)";

let start = s.indexOf(markerStart);
if (start >= 0) {
  start = s.lastIndexOf('<label className="adm-balances-field">', start);
}
const end = s.indexOf(markerEnd, start);
if (start < 0 || end < 0) {
  console.error("markers not found", { start, end });
  process.exit(1);
}

const replacement = `        </motion.div>

        <label className="adm-balances-field adm-balances-field--search-row">
          <span className="adm-balances-field-label">חיפוש לקוח</span>
          <input
            className="adm-balances-input adm-balances-input--search"
            value={searchDraft.smart}
            onChange={(e) => setSearchDraft((s) => ({ ...s, smart: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySearchNow();
              }
            }}
            placeholder="חיפוש לקוח / קוד / טלפון"
            dir="rtl"
            autoComplete="off"
          />
        </label>

        <div className="adm-balances-filters-row adm-balances-filters-row--tertiary">
          <div className="adm-balances-filters-tertiary-fields">
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">סטטוס</span>
              <select
                className="adm-balances-input"
                value={balancesFilters.balanceDebtStatus}
                onChange={(e) => {
                  setBalancesFilters((f) => ({ ...f, balanceDebtStatus: e.target.value as CustomerBalanceDebtFilter }));
                  setPage(1);
                }}
              >
                {(Object.keys(DEBT_STATUS_LABELS) as CustomerBalanceDebtFilter[]).map((k) => (
                  <option key={k} value={k}>
                    {DEBT_STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">מיון</span>
              <select
                className="adm-balances-input"
                value={balancesFilters.sort}
                onChange={(e) => {
                  setBalancesFilters((f) => ({ ...f, sort: e.target.value as CustomerBalanceSort }));
                  setPage(1);
                }}
              >
                {(Object.keys(SORT_LABELS) as CustomerBalanceSort[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">מינ׳ יתרה ₪</span>
              <input
                className="adm-balances-input"
                value={searchDraft.minBalanceIls}
                onChange={(e) => setSearchDraft((s) => ({ ...s, minBalanceIls: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applySearchNow();
                  }
                }}
                placeholder="מינימום"
                dir="ltr"
              />
            </label>
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">מקס׳ יתרה ₪</span>
              <input
                className="adm-balances-input"
                value={searchDraft.maxBalanceIls}
                onChange={(e) => setSearchDraft((s) => ({ ...s, maxBalanceIls: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applySearchNow();
                  }
                }}
                placeholder="מקסימום"
                dir="ltr"
              />
            </label>
            <label className="adm-balances-field adm-balances-field--upto">
              <span className="adm-balances-field-label">עד שבוע AH (צבירה)</span>
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={uptoWeekInput}
                placeholder="למשל AH-118"
                dir="ltr"
                onChange={(e) => setUptoWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurUptoWeekInput}
              />
            </label>
            <label className="adm-balances-field adm-balances-field--currency">
              <span className="adm-balances-field-label">מטבע חוב</span>
              <select
                className="adm-balances-input"
                value={balancesFilters.currencyView}
                onChange={(e) => {
                  setBalancesFilters((f) => ({ ...f, currencyView: e.target.value as "" | "ILS" | "USD" }));
                  setPage(1);
                }}
              >
                <option value="">הכל</option>
                <option value="ILS">חוב בש״ח בלבד</option>
                <option value="USD">חוב בדולר בלבד</option>
              </select>
            </label>
          </div>
          <div className="adm-balances-filters-actions">
            <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={applySearchNow}>
              חפש
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={clearPageFilters}>
              נקה פילטרים
            </button>
          </div>
        </div>
      </div>

`;

// Primary row must close with </div> — remove erroneous motion.div from replacement
const fixed = replacement.replace("        </motion.div>", "        </div>");

s = s.slice(0, start) + fixed + s.slice(end);
fs.writeFileSync(target, s);
console.log("patched filters UI");
