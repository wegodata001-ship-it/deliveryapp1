"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Horizontal dual scrollbar (top + bottom) synced via DOM only — no React state on scroll.
 * Sticky thead inside the main pane continues to work with vertical scroll.
 */
export function SyncedTableScroll({ children, className }: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    const top = topRef.current;
    const main = mainRef.current;
    const spacer = spacerRef.current;
    if (!top || !main || !spacer) return;

    const syncWidth = () => {
      const table = main.querySelector("table");
      const width = Math.max(table?.scrollWidth ?? 0, main.scrollWidth, main.clientWidth);
      spacer.style.width = `${width}px`;
    };

    const onTopScroll = () => {
      if (syncing.current) return;
      syncing.current = true;
      main.scrollLeft = top.scrollLeft;
      syncing.current = false;
    };

    const onMainScroll = () => {
      if (syncing.current) return;
      syncing.current = true;
      top.scrollLeft = main.scrollLeft;
      syncing.current = false;
    };

    syncWidth();

    top.addEventListener("scroll", onTopScroll, { passive: true });
    main.addEventListener("scroll", onMainScroll, { passive: true });

    const ro = new ResizeObserver(syncWidth);
    ro.observe(main);
    const table = main.querySelector("table");
    if (table) ro.observe(table);

    window.addEventListener("resize", syncWidth);

    return () => {
      top.removeEventListener("scroll", onTopScroll);
      main.removeEventListener("scroll", onMainScroll);
      ro.disconnect();
      window.removeEventListener("resize", syncWidth);
    };
  }, []);

  return (
    <div className={`shp-synced-scroll ${className ?? ""}`}>
      <div
        ref={topRef}
        className="shp-synced-scroll__top"
        aria-hidden="true"
        tabIndex={-1}
      >
        <div ref={spacerRef} className="shp-synced-scroll__spacer" />
      </div>
      <div ref={mainRef} className="shp-synced-scroll__main shp-table-wrap">
        {children}
      </div>
    </div>
  );
}
