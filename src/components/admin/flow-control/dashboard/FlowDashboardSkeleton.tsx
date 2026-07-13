"use client";

export function FlowDashboardSkeleton() {
  return (
    <div className="fd-skeleton" aria-busy="true" aria-label="טוען דשבורד">
      <div className="fd-skeleton__banner" />
      <div className="fd-skeleton__kpi-row">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="fd-skeleton__kpi" />
        ))}
      </div>
      <div className="fd-skeleton__grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="fd-skeleton__tile" />
        ))}
      </div>
      <div className="fd-skeleton__charts" />
    </div>
  );
}

export default FlowDashboardSkeleton;
