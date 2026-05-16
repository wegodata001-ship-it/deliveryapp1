/** סימן W משותף — לוגו, favicon, מסכי כניסה */
export function WegoWMarkSvg({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="wego-bg" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0B1F4A" />
          <stop offset="0.45" stopColor="#1D4ED8" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
        <linearGradient id="wego-glow" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" stopOpacity="0.45" />
          <stop offset="1" stopColor="#60A5FA" stopOpacity="0" />
        </linearGradient>
        <filter id="wego-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#1E3A8A" floodOpacity="0.35" />
        </filter>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#wego-bg)" filter="url(#wego-shadow)" />
      <rect width="64" height="64" rx="14" fill="url(#wego-glow)" />
      <path
        fill="#FFFFFF"
        d="M14.5 44.2 21.2 22.5h4.1l4.8 12.1 4.8-12.1h4.1L46.5 44.2h-4.6l-3.4-10.2-5.1 12.4h-3.6l-5.1-12.4-3.4 10.2h-4.6Z"
      />
    </svg>
  );
}
