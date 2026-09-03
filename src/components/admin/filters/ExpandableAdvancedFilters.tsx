"use client";

import type { ReactNode } from "react";
import "./expandable-advanced-filters.css";

export type ExpandableAdvancedFiltersProps = {
  open: boolean;
  children: ReactNode;
  title?: string;
};

export function ExpandableAdvancedFilters({
  open,
  children,
  title = "סינון מתקדם",
}: ExpandableAdvancedFiltersProps) {
  return (
    <section
      className={`adm-expand-adv${open ? " is-open" : ""}`}
      aria-hidden={!open}
      aria-label={title}
      inert={!open || undefined}
    >
      <div className="adm-expand-adv__clip">
        <div className="adm-expand-adv__inner">
          {title ? <h3 className="adm-expand-adv__title">{title}</h3> : null}
          {children}
        </div>
      </div>
    </section>
  );
}
