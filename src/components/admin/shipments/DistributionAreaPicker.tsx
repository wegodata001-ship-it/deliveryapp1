"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ShipmentZoneDto } from "@/app/admin/shipments/types";
import { distributionAreaNameMatchesQuery } from "@/lib/distribution-area-name";

type Props = {
  zones: ShipmentZoneDto[];
  value: string;
  onChange: (zoneId: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
};

export function DistributionAreaPicker({
  zones,
  value,
  onChange,
  disabled = false,
  emptyLabel = "ללא אזור חלוקה",
  searchPlaceholder = "חיפוש אזור — עברית, ערבית, אנגלית",
}: Props) {
  const [query, setQuery] = useState("");

  const activeZones = useMemo(
    () =>
      zones
        .filter((z) => z.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [zones],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return activeZones;
    return activeZones.filter((z) => distributionAreaNameMatchesQuery(z.name, q));
  }, [activeZones, query]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <Search
          size={14}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            pointerEvents: "none",
          }}
        />
        <input
          value={query}
          disabled={disabled}
          placeholder={searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingInlineStart: 12, paddingInlineEnd: 32, width: "100%" }}
        />
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        size={Math.min(8, Math.max(4, filtered.length + 1))}
        style={{ width: "100%" }}
      >
        <option value="">{emptyLabel}</option>
        {filtered.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      {query.trim() && filtered.length === 0 ? (
        <div style={{ fontSize: 12, color: "#94a3b8" }}>לא נמצאו אזורים תואמים</div>
      ) : null}
    </div>
  );
}
