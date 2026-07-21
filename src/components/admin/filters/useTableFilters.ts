"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TableFilterValues } from "@/components/admin/filters/table-filters-types";
import {
  clearTableFiltersStorage,
  mergeTableFilters,
  readTableFilters,
  writeTableFilters,
} from "@/components/admin/filters/table-filters-persist";

type Options = {
  /** מפתח ייחודי למסך — לשמירה ב־localStorage */
  storageKey: string;
  defaults: TableFilterValues;
  /** האם לטעון שמירה בטעינה ראשונה (ברירת מחדל: true) */
  restore?: boolean;
};

/**
 * מצב מסננים אחיד עם שמירה אוטומטית למסך.
 * כל שינוי מעדכן מיד (הטבלה מגיבה ל־values).
 */
export function useTableFilters({ storageKey, defaults, restore = true }: Options) {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [values, setValues] = useState<TableFilterValues>(() => {
    if (!restore || typeof window === "undefined") return { ...defaults };
    return mergeTableFilters(defaults, readTableFilters(storageKey));
  });

  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (!restore) return;
    const saved = readTableFilters(storageKey);
    if (saved) setValues(mergeTableFilters(defaultsRef.current, saved));
  }, [storageKey, restore]);

  useEffect(() => {
    writeTableFilters(storageKey, values);
  }, [storageKey, values]);

  const setField = useCallback((id: string, value: string) => {
    setValues((prev) => {
      if ((prev[id] ?? "") === value) return prev;
      return { ...prev, [id]: value };
    });
  }, []);

  const patch = useCallback((partial: TableFilterValues) => {
    setValues((prev) => ({ ...prev, ...partial }));
  }, []);

  const clear = useCallback(() => {
    const next = { ...defaultsRef.current };
    setValues(next);
    clearTableFiltersStorage(storageKey);
  }, [storageKey]);

  const activeCount = useMemo(() => {
    let n = 0;
    for (const [k, v] of Object.entries(values)) {
      const d = defaultsRef.current[k] ?? "";
      if ((v ?? "").trim() !== "" && (v ?? "") !== d) n += 1;
    }
    return n;
  }, [values]);

  return {
    values,
    setValues,
    setField,
    patch,
    clear,
    activeCount,
  };
}
