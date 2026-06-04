import { normalizeYmdRangePair } from "@/lib/work-week";

function normalizeFromToPatch(
  patch: Record<string, string | null | undefined>,
): Record<string, string | null | undefined> {
  const fromRaw = patch.from;
  const toRaw = patch.to;
  if (fromRaw == null || toRaw == null || fromRaw === "" || toRaw === "") return patch;
  const { from, to, swapped } = normalizeYmdRangePair(String(fromRaw), String(toRaw));
  if (!swapped) return patch;
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    console.warn("[admin-url] from>to — swap", { before: { from: fromRaw, to: toRaw }, after: { from, to } });
  }
  return { ...patch, from, to };
}

function normalizeFromToSearchParams(sp: URLSearchParams): void {
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to) return;
  const { from: f, to: t, swapped } = normalizeYmdRangePair(from, to);
  if (!swapped) return;
  sp.set("from", f);
  sp.set("to", t);
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    console.warn("[admin-url] from>to in URL — swap", { before: { from, to }, after: { from: f, to: t } });
  }
}

export function withQuery(
  pathname: string,
  current: URLSearchParams,
  patch: Record<string, string | null | undefined>,
): string {
  const sp = new URLSearchParams(current.toString());
  const patchNorm = normalizeFromToPatch(patch);
  for (const [k, v] of Object.entries(patchNorm)) {
    if (v === null || v === undefined || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  normalizeFromToSearchParams(sp);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function withoutKeys(pathname: string, current: URLSearchParams, keys: string[]): string {
  const sp = new URLSearchParams(current.toString());
  for (const k of keys) sp.delete(k);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
