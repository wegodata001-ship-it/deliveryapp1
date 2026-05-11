"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** פס עליון קצר במעבר דף (pathname) — בלי חסימת UI */
export function NavigationProgress() {
  const pathname = usePathname();
  const [on, setOn] = useState(false);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (prev.current === null) {
      prev.current = pathname;
      return;
    }
    if (prev.current === pathname) return;
    prev.current = pathname;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), 480);
    return () => window.clearTimeout(t);
  }, [pathname]);

  if (!on) return null;
  return (
    <div className="ui-nav-progress" aria-hidden>
      <div className="ui-nav-progress__bar" />
    </div>
  );
}
