export function withQuery(
  pathname: string,
  current: URLSearchParams,
  patch: Record<string, string | null | undefined>,
): string {
  const sp = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function withoutKeys(pathname: string, current: URLSearchParams, keys: string[]): string {
  const sp = new URLSearchParams(current.toString());
  for (const k of keys) sp.delete(k);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
