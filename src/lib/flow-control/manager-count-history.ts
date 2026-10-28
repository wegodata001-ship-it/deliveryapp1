export type ManagerCountHistoryEntry = {
  id: string;
  savedAt: string;
  savedById: string;
  savedByName?: string | null;
  /** @deprecated — השתמשו ב-formAfter */
  form?: Record<string, string>;
  formBefore: Record<string, string>;
  formAfter: Record<string, string>;
  status: "SAVED";
};

export function parseManagerCountHistory(raw: unknown): ManagerCountHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ManagerCountHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.savedAt !== "string" || typeof r.savedById !== "string") continue;
    const legacyForm = (r.form as Record<string, string>) ?? {};
    const formAfter = (r.formAfter as Record<string, string>) ?? legacyForm;
    const formBefore = (r.formBefore as Record<string, string>) ?? {};
    out.push({
      id: String(r.id ?? r.savedAt),
      savedAt: r.savedAt,
      savedById: r.savedById,
      savedByName: r.savedByName != null ? String(r.savedByName) : null,
      form: formAfter,
      formBefore,
      formAfter,
      status: "SAVED",
    });
  }
  return out;
}

export function appendManagerCountHistory(
  existing: unknown,
  entry: Omit<ManagerCountHistoryEntry, "id" | "form"> & { formAfter: Record<string, string> },
): ManagerCountHistoryEntry[] {
  const prev = parseManagerCountHistory(existing);
  const next: ManagerCountHistoryEntry = {
    ...entry,
    form: entry.formAfter,
    id: `${entry.savedAt}:${entry.savedById}:${prev.length}`,
  };
  return [...prev, next];
}

export function managerCountFormFromFlowRow(row: {
  countedCashUsd?: { toString(): string } | null;
  countedCashIls?: { toString(): string } | null;
  countedChecksIls?: { toString(): string } | null;
  countedCreditIls?: { toString(): string } | null;
  countedTransferIls?: { toString(): string } | null;
  commissionUsd?: { toString(): string } | null;
  commissionIls?: { toString(): string } | null;
  turkeyTransferUsd?: { toString(): string } | null;
  turkeyTransferIls?: { toString(): string } | null;
} | null): Record<string, string> {
  const s = (v: { toString(): string } | null | undefined) =>
    v != null ? v.toString() : "";
  return {
    countedCashUsd: s(row?.countedCashUsd),
    countedCashIls: s(row?.countedCashIls),
    countedChecksIls: s(row?.countedChecksIls),
    countedCreditIls: s(row?.countedCreditIls),
    countedTransferIls: s(row?.countedTransferIls),
    commissionUsd: s(row?.commissionUsd),
    commissionIls: s(row?.commissionIls),
    turkeyTransferUsd: s(row?.turkeyTransferUsd),
    turkeyTransferIls: s(row?.turkeyTransferIls),
  };
}
