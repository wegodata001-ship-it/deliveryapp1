"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const EMPTY = new URLSearchParams();

/**
 * URL search params that match SSR on first paint — avoids hydration mismatch
 * when query string is merged into nav links after mount.
 */
export function useHydratedSearchParams(): URLSearchParams {
  const sp = useSearchParams();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return EMPTY;
  }
  return sp;
}
