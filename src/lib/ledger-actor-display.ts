const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isTechnicalLedgerId(value: string | null | undefined): boolean {
  const t = (value ?? "").trim();
  return UUID_RE.test(t);
}

export function formatLedgerActorDisplay(
  raw: string | null | undefined,
  nameById?: Map<string, string>,
): string {
  const t = (raw ?? "").trim();
  if (!t || t === "—") return "—";
  const mapped = nameById?.get(t)?.trim();
  if (mapped) return mapped;
  if (isTechnicalLedgerId(t)) return "מערכת";
  return t;
}

export function collectLedgerActorIds(values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const t = (value ?? "").trim();
    if (isTechnicalLedgerId(t)) out.add(t);
  }
  return [...out];
}
