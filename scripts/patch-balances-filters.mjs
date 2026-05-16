import fs from "fs";

const p = "src/components/admin/CustomerBalancesClient.tsx";
const s = fs.readFileSync(p, "utf8");

const anchor = "עד שבוע AH (צבירה)";
const spanIdx = s.indexOf(`<span className="adm-balances-field-label">${anchor}</span>`);
const labelStart = s.lastIndexOf('<label className="adm-balances-field">', spanIdx);
const panelClose = s.lastIndexOf("      </motion.div>", s.indexOf("{balancesScopeSubtitle", spanIdx));

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

        <motion.div className="adm-balances-filters-row adm-balances-filters-row--tertiary">
          <motion.div className="adm-balances-filters-actions">
            <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={applySearchNow}>
              חפש
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={clearPageFilters}>
              נקה פילטרים
            </button>
          </motion.div>
          <motion.div className="adm-balances-filters-tertiary-fields">
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
                placeholder="מקסימום"
                dir="ltr"
              />
            </label>
            <label className="adm-balances-field adm-balances-field--upto">
              <span className="adm-balances-field-label">עד שבוע (צבירה)</span>
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={uptoWeekInput}
                placeholder="AH-118"
                dir="ltr"
                onChange={(e) => setUptoWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurUptoWeekInput}
              />
            </label>
          </motion.div>
        </motion.div>
      </motion.div>

`;

const fixed = replacement.replaceAll("motion.div", "div");
const out = s.slice(0, labelStart) + fixed + s.slice(panelClose);
fs.writeFileSync(p, out);
console.log("ok", labelStart, panelClose);
