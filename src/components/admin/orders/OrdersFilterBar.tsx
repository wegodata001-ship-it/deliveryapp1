"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { Search, Settings, X } from "lucide-react";
import { ExpandableAdvancedFilters } from "@/components/admin/filters/ExpandableAdvancedFilters";
import { ShipmentMultiSelectFilter } from "@/components/admin/shipments/ShipmentMultiSelectFilter";
import { CurrentWorkWeekButton } from "@/components/admin/CurrentWorkWeekButton";
import { OS } from "@/lib/order-status-slugs";
import { AdvancedOrdersFilters } from "./AdvancedOrdersFilters";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { OrdersWeekPicker } from "./OrdersWeekPicker";
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
    paymentStatusValues,
    setPaymentStatusValues,
    paymentStatusOptions,
    statusValues,
    setStatusValues,
    openOnly,
    setOpenOnly,
    completedOnly,
    setCompletedOnly,
    week,
    onWeekCommitted,
    shiftWeekNav,
    goToActiveWeek,
    weekSwitching,
    advancedOpen,
    setAdvancedOpen,
    advancedFilterCount,
    applyAdvancedFilters,
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
    leadingActions,
    exportActions,
  } = props;

  useEffect(() => {
    if (!advancedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdvancedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advancedOpen, setAdvancedOpen]);

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
      applyAdvancedFilters={applyAdvancedFilters}
      clearAllFilters={clearAllFilters}
      hasClearableFilters={hasClearableFilters}
      createdByFilterOptions={createdByFilterOptions}
      paymentLocationOptions={paymentLocationOptions}
      msStrings={msStrings}
      msDir={msDir}
      countryValues={countryValues}
      setCountryValues={setCountryValues}
      countryOptions={countryOptions}
    />
  );

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

        <div className="ofb__select ofb__select--status">
          <ShipmentMultiSelectFilter
            label="סטטוס הזמנה"
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

        <div className="ofb__select ofb__select--pay-status">
          <ShipmentMultiSelectFilter
            label="סטטוס תשלום"
            options={paymentStatusOptions.map((o) => ({ value: o.value, label: o.label }))}
            values={paymentStatusValues}
            onChange={(next) => {
              setPaymentStatusValues(next);
              pushFilters({ paymentStatus: next }, { refresh: true });
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

        <OrdersWeekPicker
          weekCode={week}
          loading={weekSwitching}
          onWeekChange={onWeekCommitted}
          onShift={shiftWeekNav}
        />

        <CurrentWorkWeekButton className="ofb__week-current" weekCode={week} onClick={goToActiveWeek} />

        {leadingActions}
        {exportActions}

        <button
          type="button"
          className={`ofb__btn ofb__btn--advanced${advancedOpen ? " is-open" : ""}`}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <Settings size={14} strokeWidth={2} aria-hidden />
          סינון מתקדם
          {advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}
          <span className="ofb__chevron" aria-hidden>
            {advancedOpen ? "▲" : "▼"}
          </span>
        </button>

        {hasClearableFilters ? (
          <button type="button" className="ofb__btn ofb__btn--ghost" onClick={clearAllFilters}>
            איפוס
          </button>
        ) : null}

        <button
          type="button"
          className="ofb__btn ofb__btn--mobile"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <Settings size={14} strokeWidth={2} aria-hidden />
          מסננים{mobileFilterCount > 0 ? ` (${mobileFilterCount})` : ""}
        </button>
      </div>

      <ExpandableAdvancedFilters open={advancedOpen}>{advancedPanel}</ExpandableAdvancedFilters>

      <ActiveFilterChips
        activeFilterChips={activeFilterChips}
        clearAllFilters={clearAllFilters}
        hasClearableFilters={hasClearableFilters}
      />

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
              <div className="ofb__select ofb__select--status">
                <ShipmentMultiSelectFilter
                  label="סטטוס הזמנה"
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
              <div className="ofb__select ofb__select--pay-status">
                <ShipmentMultiSelectFilter
                  label="סטטוס תשלום"
                  options={paymentStatusOptions.map((o) => ({ value: o.value, label: o.label }))}
                  values={paymentStatusValues}
                  onChange={(next) => {
                    setPaymentStatusValues(next);
                    pushFilters({ paymentStatus: next }, { refresh: true });
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
              <OrdersWeekPicker
                weekCode={week}
                loading={weekSwitching}
                onWeekChange={onWeekCommitted}
                onShift={shiftWeekNav}
              />
            </div>
            <div className="ofb-drawer__foot">
              {hasClearableFilters ? (
                <button type="button" className="ofb__btn ofb__btn--ghost" onClick={clearAllFilters}>
                  איפוס הכל
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
