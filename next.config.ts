import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** מפחית שגיאות SegmentViewNode / manifest של כלי הפיתוח בפיתוח מקומי */
  devIndicators: false,
  webpack: (config, { dev }) => {
    if (dev) {
      /** מניעת מטמון webpack פגום אחרי HMR רב (נפוץ ב-Windows/OneDrive) → POST 500 על Server Actions */
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
