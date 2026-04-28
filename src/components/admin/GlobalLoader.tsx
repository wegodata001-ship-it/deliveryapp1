"use client";

export function GlobalLoader({
  show,
  text = "מעבד נתונים...",
}: {
  show: boolean;
  text?: string;
}) {
  if (!show) return null;
  return (
    <div className="adm-global-loading" role="status" aria-live="polite" aria-label="טעינה">
      <div className="adm-global-loading-card">
        <div className="adm-global-loading-spinner" aria-hidden />
        <div className="adm-global-loading-text">{text}</div>
      </div>
    </div>
  );
}

