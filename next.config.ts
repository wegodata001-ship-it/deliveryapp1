import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["pdfmake"],
  /**
   * מנוע ה-PDF (playwright-core + @sparticuz/chromium) חייב להישאר חיצוני ל-bundle כדי
   * ש-Next יעקוב אחריו נכון לתוך הפונקציה (כולל הבינארי הדחוס של Chromium) ולא ינסה לארוז אותו.
   */
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
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
