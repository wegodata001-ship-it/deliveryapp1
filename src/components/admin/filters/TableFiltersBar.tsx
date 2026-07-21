"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Eraser,
  FileDown,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  DEFAULT_FIELD_LABELS,
  TABLE_FILTER_SORT_OPTIONS,
  type TableFilterFieldConfig,
  type TableFilterValues,
  type TableFiltersActions,
} from "@/components/admin/filters/table-filters-types";
import { TableFilterAutocomplete } from "@/components/admin/filters/TableFilterAutocomplete";
import "@/components/admin/filters/table-filters.css";

export type TableFiltersBarProps = TableFiltersActions & {
  /** מפתח מסך — לתיאור aria בלבד; השמירה ב־useTableFilters */
  storageKey?: string;
  fields: TableFilterFieldConfig[];
  values: TableFilterValues;
  onChange: (id: string, value: string) => void;
  onClear: () => void;
  /** פעולות נוספות בצד שמאל (למשל «הוסף») */
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
  resultCount?: number;
  resultTotal?: number;
  title?: string;
};

function fieldLabel(field: TableFilterFieldConfig): string {
  return field.label || DEFAULT_FIELD_LABELS[field.kind] || field.id;
}

export function TableFiltersBar({
  fields,
  values,
  onChange,
  onClear,
  onRefresh,
  onExcel,
  onPdf,
  onPrint,
  refreshing,
  exporting,
  leadingActions,
  trailingActions,
  resultCount,
  resultTotal,
  title,
}: TableFiltersBarProps) {
  return (
    <section className="atf-bar" dir="rtl" aria-label={title || "מסנני טבלה"}>
      <div className="atf-bar__fields">
        {fields.map((field) => {
          const value = values[field.id] ?? "";
          const label = fieldLabel(field);
          const style =
            field.minWidth != null
              ? ({ ["--atf-min" as string]: `${field.minWidth}px` } as CSSProperties)
              : undefined;

          if (field.kind === "customer" || field.kind === "supplier") {
            return (
              <TableFilterAutocomplete
                key={field.id}
                id={field.id}
                label={label}
                value={value}
                options={field.options ?? []}
                placeholder={field.placeholder}
                onChange={(v) => onChange(field.id, v)}
              />
            );
          }

          if (field.kind === "search") {
            return (
              <label
                key={field.id}
                className={`atf-field atf-field--search${field.grow === false ? "" : " atf-field--grow"}`}
                style={style}
              >
                <span className="atf-field__label">{label}</span>
                <span className="atf-search">
                  <Search size={15} aria-hidden className="atf-search__icon" />
                  <input
                    className="atf-input"
                    type="search"
                    value={value}
                    placeholder={
                      field.placeholder ||
                      "חיפוש לפי מספר, שם, טלפון, לקוח, ספק, הערות…"
                    }
                    onChange={(e) => onChange(field.id, e.target.value)}
                  />
                </span>
              </label>
            );
          }

          if (
            field.kind === "dateFrom" ||
            field.kind === "dateTo" ||
            field.kind === "date"
          ) {
            return (
              <label key={field.id} className="atf-field" style={style}>
                <span className="atf-field__label">{label}</span>
                <input
                  className="atf-input"
                  type="date"
                  dir="ltr"
                  value={value}
                  onChange={(e) => onChange(field.id, e.target.value)}
                />
              </label>
            );
          }

          if (
            field.kind === "week" ||
            field.kind === "weekFrom" ||
            field.kind === "weekTo" ||
            field.kind === "country" ||
            field.kind === "region" ||
            field.kind === "city" ||
            field.kind === "status" ||
            field.kind === "paymentMethod" ||
            field.kind === "courier" ||
            field.kind === "employee" ||
            field.kind === "sort" ||
            field.kind === "select"
          ) {
            const options =
              field.kind === "sort" && !(field.options?.length)
                ? TABLE_FILTER_SORT_OPTIONS
                : (field.options ?? []);
            return (
              <label key={field.id} className="atf-field" style={style}>
                <span className="atf-field__label">{label}</span>
                <select
                  className="atf-input"
                  dir={field.dir || (field.kind.startsWith("week") ? "ltr" : undefined)}
                  value={value}
                  onChange={(e) => onChange(field.id, e.target.value)}
                >
                  {field.hideEmptyOption ? null : (
                    <option value="">{field.placeholder || "הכל"}</option>
                  )}
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }

          return (
            <label
              key={field.id}
              className={`atf-field${field.grow ? " atf-field--grow" : ""}`}
              style={style}
            >
              <span className="atf-field__label">{label}</span>
              <input
                className="atf-input"
                type="text"
                dir={field.dir}
                value={value}
                placeholder={field.placeholder}
                onChange={(e) => onChange(field.id, e.target.value)}
              />
            </label>
          );
        })}
      </div>

      <div className="atf-bar__actions">
        {leadingActions}
        {onRefresh ? (
          <button
            type="button"
            className="atf-btn"
            onClick={onRefresh}
            disabled={refreshing}
            title="רענון"
          >
            <RefreshCw size={15} className={refreshing ? "atf-spin" : undefined} />
            רענון
          </button>
        ) : null}
        <button type="button" className="atf-btn" onClick={onClear} title="ניקוי מסננים">
          <Eraser size={15} />
          ניקוי
        </button>
        {onExcel ? (
          <button
            type="button"
            className="atf-btn"
            onClick={onExcel}
            disabled={exporting}
            title="Excel"
          >
            <FileSpreadsheet size={15} />
            Excel
          </button>
        ) : null}
        {onPdf ? (
          <button
            type="button"
            className="atf-btn"
            onClick={onPdf}
            disabled={exporting}
            title="PDF"
          >
            <FileDown size={15} />
            PDF
          </button>
        ) : null}
        {onPrint ? (
          <button type="button" className="atf-btn" onClick={onPrint} title="הדפסה">
            <Printer size={15} />
            הדפסה
          </button>
        ) : null}
        {trailingActions}
        {resultCount != null ? (
          <span className="atf-count" dir="ltr">
            {resultTotal != null ? `${resultCount}/${resultTotal}` : resultCount}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export default TableFiltersBar;
