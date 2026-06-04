/** לוגו ATLAS — SVG לשימוש ב-PDF (pdfmake / HTML) */

const ATLAS_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="72" viewBox="0 0 280 72">
  <defs>
    <linearGradient id="atlasGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a5f"/>
      <stop offset="100%" style="stop-color:#0f2744"/>
    </linearGradient>
  </defs>
  <rect x="4" y="10" width="52" height="52" rx="12" fill="url(#atlasGrad)"/>
  <text x="30" y="44" text-anchor="middle" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700">A</text>
  <text x="72" y="32" fill="#1e3a5f" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700">ATLAS</text>
  <text x="72" y="50" fill="#64748b" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="600">IMPORT &amp; EXPORT</text>
</svg>`;

function svgToDataUri(svg: string): string {
  const encoded =
    typeof btoa !== "undefined"
      ? btoa(unescape(encodeURIComponent(svg)))
      : Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

export const ATLAS_PDF_LOGO_DATA_URI = svgToDataUri(ATLAS_LOGO_SVG);

export const ATLAS_BRAND_TITLE = "ATLAS IMPORT & EXPORT";
