"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Settings, X } from "lucide-react";
import { ShipmentMultiSelectFilter } from "@/components/admin/shipments/ShipmentMultiSelectFilter";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { CurrentWorkWeekButton } from "@/components/admin/CurrentWorkWeekButton";
import { OS } from "@/lib/order-status-slugs";
import { AdvancedOrdersFilters } from "./AdvancedOrdersFilters";
import { ActiveFilterChips } from "./ActiveFilterChips";
import type { UseOrdersListFiltersReturn } from "./useOrdersListFilters";

type Props = UseOrdersListFiltersReturn & {
  leadingActions?: ReactNode;
  exportActions?: ReactNode;
};

export function OrdersFilterBar(props: Props) {
  const {
    searchDraft,
    setSearchDraft,
    orderNumDraft,
    setOrderNumDraft,
    schedulePush,
    pushFilters,
    countryValues,
    setCountryValues,
    paymentTypeValues,
    setPaymentTypeValues,
    statusValues,
    setStatusValues,
    openOnly,
    setOpenOnly,
    completedOnly,
    setCompletedOnly,
    week,
    setWeek,
    onWeekCommitted,
    shiftWeekNav,
    goToActiveWeek,
    advancedOpen,
    setAdvancedOpen,
    advancedFilterCount,
    clearAllFilters,
    hasClearableFilters,
    mobileOpen,
    setMobileOpen,
    mobileFilterCount,
    statusOptions,
    paymentFilterOptions,
    countryOptions,
    msStrings,
    msDir,
    activeFilterChips,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    minAmount,
    setMinAmount,
    maxAmount,
    setMaxAmount,
    phoneDraft,
    setPhoneDraft,
    payLoc,
    setPayLoc,
    createdByValues,
    setCreatedByValues,
    createdByFilterOptions,
    paymentLocationOptions,
    getAhWeekCodeFromDateRange,
    leadingActions,
    exportActions,
  } = props;

  const advancedBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; insetInlineEnd: number } | null>(null);

  const updatePopoverPos = useCallback(() => {
    const btn = advancedBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPopoverPos({
      top: r.bottom + 6,
      insetInlineEnd: window.innerWidth - r.right,
    });
  }, []);

  useEffect(() => {
    if (!advancedOpen) {
      setPopoverPos(null);
      return;
    }
    updatePopoverPos();
    const onResize = () => updatePopoverPos();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [advancedOpen, updatePopoverPos]);

  useEffect(() => {
    if (!advancedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdvancedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advancedOpen, setAdvancedOpen]);

  const closeAdvanced = () => setAdvancedOpen(false);
  const toggleAdvanced = () => {
    setAdvancedOpen((v) => !v);
    setMobileOpen(false);
  };

  const advancedPanel = (
    <AdvancedOrdersFilters
      dateFrom={dateFrom}
      setDateFrom={setDateFrom}
      dateTo={dateTo}
      setDateTo={setDateTo}
      minAmount={minAmount}
      setMinAmount={setMinAmount}
      maxAmount={maxAmount}
      setMaxAmount={setMaxAmount}
      orderNumDraft={orderNumDraft}
      setOrderNumDraft={setOrderNumDraft}
      phoneDraft={phoneDraft}
      setPhoneDraft={setPhoneDraft}
      payLoc={payLoc}
      setPayLoc={setPayLoc}
      createdByValues={createdByValues}
      setCreatedByValues={setCreatedByValues}
      openOnly={openOnly}
      setOpenOnly={setOpenOnly}
      completedOnly={completedOnly}
      setCompletedOnly={setCompletedOnly}
      setStatusValues={setStatusValues}
      setWeek={setWeek}
      pushFilters={pushFilters}
      schedulePush={schedulePush}
      clearAllFilters={clearAllFilters}
      hasClearableFilters={hasClearableFilters}
      setAdvancedOpen={setAdvancedOpen}
      getAhWeekCodeFromDateRange={getAhWeekCodeFromDateRange}
      createdByFilterOptions={createdByFilterOptions}
      paymentLocationOptions={paymentLocationOptions}
      msStrings={msStrings}
      msDir={msDir}
    />
  );

  const popover =
    advancedOpen && popoverPos && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              className="ofb-popover-backdrop"
              aria-label="סגור סינון מתקדם"
              onClick={closeAdvanced}
            />
            <div
              ref={popoverRef}
              className="ofb-popover"
              role="dialog"
              aria-modal="true"
              aria-label="סינון מתקדם"
              dir="rtl"
              style={{ top: popoverPos.top, insetInlineEnd: popoverPos.insetInlineEnd }}
            >
              {advancedPanel}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="ofb">
      <div className="ofb__row" dir="rtl">
        <label className="ofb__search">
          <Search size={15} strokeWidth={2} aria-hidden className="ofb__search-icon" />
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => {
              const v = e.target.value;
              setSearchDraft(v);
              if (orderNumDraft.trim()) {
                setOrderNumDraft("");
                schedulePush({ search: v, orderNumber: "" });
              } else {
                schedulePush({ search: v });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushFilters({ search: searchDraft, orderNumber: "" });
            }}
            className="ofb__input ofb__input--search"
            placeholder="חיפוש לקוח / קוד לקוח / מספר הזמנה / טלפון"
            aria-label="חיפוש"
            autoComplete="off"
          />
        </label>

        <div className="ofb__select ofb__select--country">
          <ShipmentMultiSelectFilter
            label="מדינה"
            options={countryOptions}
            values={countryValues}
            onChange={(next) => {
              setCountryValues(next);
              pushFilters({ country: next });
            }}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <div className="ofb__select ofb__select--payment">
          <ShipmentMultiSelectFilter
            label="צורת תשלום"
            options={paymentFilterOptions}
            values={paymentTypeValues}
            onChange={(next) => {
              setPaymentTypeValues(next);
              pushFilters({ paymentMethod: next });
            }}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <div className="ofb__select ofb__select--status">
          <ShipmentMultiSelectFilter
            label="סטטוס"
            options={statusOptions.map((s) => ({ value: s.value, label: s.label }))}
            values={openOnly ? [OS.OPEN] : completedOnly ? [OS.COMPLETED] : statusValues}
            onChange={(next) => {
              setOpenOnly(false);
              setCompletedOnly(false);
              setStatusValues(next);
              pushFilters({ status: next, openOnly: false, completedOnly: false });
            }}
            disabled={openOnly || completedOnly}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <div className="ofb__week" dir="ltr">
          <AhWeekNavPrevButton className="ofb__week-btn" onClick={() => shiftWeekNav(-1)} aria-label="שבוע קודם" />
          <input
            type="text"
            inputMode="text"
            value={week}
            dir="ltr"
            aria-label="שבוע עבודה"
            onChange={(e) => setWeek(e.target.value.toUpperCase())}
            onBlur={(e) => onWeekCommitted(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onWeekCommitted((e.target as HTMLInputElement).value);
            }}
            className="ofb__week-inp"
            placeholder="AH-136"
            spellCheck={false}
            autoComplete="off"
          />
          <AhWeekNavNextButton className="ofb__week-btn" onClick={() => shiftWeekNav(1)} aria-label="שבוע הבא" />
        </div>

        <CurrentWorkWeekButton className="ofb__week-current" weekCode={week} onClick={goToActiveWeek} />

        {leadingActions}
        {exportActions}

        <button
          ref={advancedBtnRef}
          type="button"
          className="ofb__btn"
          aria-expanded={advancedOpen}
          onClick={toggleAdvanced}
        >
          <Settings size={14} strokeWidth={2} aria-hidden />
          סינון מתקדם{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}
        </button>

        {hasClearableFilters ? (
          <button type="button" className="ofb__btn ofb__btn--ghost" onClick={clearAllFilters}>
            נקה
          </button>
        ) : null}

        <button
          type="button"
          className="ofb__btn ofb__btn--mobile"
          aria-expanded={mobileOpen}
          onClick={() => {
            setMobileOpen((v) => !v);
            setAdvancedOpen(false);
          }}
        >
          <Settings size={14} strokeWidth={2} aria-hidden />
          מסננים{mobileFilterCount > 0 ? ` (${mobileFilterCount})` : ""}
        </button>
      </div>

      <ActiveFilterChips
        activeFilterChips={activeFilterChips}
        clearAllFilters={clearAllFilters}
        hasClearableFilters={hasClearableFilters}
      />

      {popover}

      {mobileOpen ? (
        <>
          <button
            type="button"
            className="ofb-drawer-backdrop"
            aria-label="סגור סינון"
            onClick={() => setMobileOpen(false)}
          />
          <div className="ofb-drawer" dir="rtl" role="dialog" aria-modal="true">
            <div className="ofb-drawer__head">
              <strong>סינון הזמנות</strong>
              <button type="button" className="ofb__btn ofb__btn--ghost" onClick={() => setMobileOpen(false)} aria-label="סגור">
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="ofb-drawer__body">
              <div className="ofb__select ofb__select--country">
                <ShipmentMultiSelectFilter
                  label="מדינה"
                  options={countryOptions}
                  values={countryValues}
                  onChange={(next) => {
                    setCountryValues(next);
                    pushFilters({ country: next });
                  }}
                  strings={msStrings}
                  dir={msDir}
                />
              </div>
              <div className="ofb__select ofb__select--payment">
                <ShipmentMultiSelectFilter
                  label="צורת תשלום"
                  options={paymentFilterOptions}
                  values={paymentTypeValues}
                  onChange={(next) => {
                    setPaymentTypeValues(next);
                    pushFilters({ paymentMethod: next });
                  }}
                  strings={msStrings}
                  dir={msDir}
                />
              </div>
              <div className="ofb__select ofb__select--status">
                <ShipmentMultiSelectFilter
                  label="סטטוס"
                  options={statusOptions.map((s) => ({ value: s.value, label: s.label }))}
                  values={openOnly ? [OS.OPEN] : completedOnly ? [OS.COMPLETED] : statusValues}
                  onChange={(next) => {
                    setOpenOnly(false);
                    setCompletedOnly(false);
                    setStatusValues(next);
                    pushFilters({ status: next, openOnly: false, completedOnly: false });
                  }}
                  disabled={openOnly || completedOnly}
                  strings={msStrings}
                  dir={msDir}
                />
              </div>
              {advancedPanel}
            </div>
            <div className="ofb-drawer__foot">
              {hasClearableFilters ? (
                <button type="button" className="ofb__btn ofb__btn--ghost" onClick={clearAllFilters}>
                  נקה הכל
                </button>
              ) : null}
              <button type="button" className="ofb__btn ofb__btn--primary" onClick={() => setMobileOpen(false)}>
                סגור
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
