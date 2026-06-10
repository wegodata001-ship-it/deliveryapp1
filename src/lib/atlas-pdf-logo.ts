/** לוגו WEGO — SVG לשימוש HTML; ב-pdfMake ייכנס רק raster dataURL תקין. */

const ATLAS_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="72" viewBox="0 0 280 72">
  <defs>
    <linearGradient id="atlasGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a5f"/>
      <stop offset="100%" style="stop-color:#0f2744"/>
    </linearGradient>
  </defs>
  <rect x="4" y="10" width="52" height="52" rx="12" fill="url(#atlasGrad)"/>
  <text x="30" y="44" text-anchor="middle" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700">W</text>
  <text x="72" y="34" fill="#1e3a5f" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="700">WEGO ERP</text>
</svg>`;

function svgToDataUri(svg: string): string {
  const encoded =
    typeof btoa !== "undefined"
      ? btoa(unescape(encodeURIComponent(svg)))
      : Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

export const ATLAS_PDF_LOGO_DATA_URI = svgToDataUri(ATLAS_LOGO_SVG);

export const ATLAS_BRAND_TITLE = "WEGO ERP";

const PDFMAKE_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g);base64,[a-z0-9+/=\s]+$/i;
const RAW_BASE64_RE = /^[a-z0-9+/=\s]+$/i;

/** pdfmake image nodes accept raster data URLs/base64; SVG data URLs crash as "Unknown image format". */
export function safePdfMakeImageDataUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (PDFMAKE_IMAGE_DATA_URL_RE.test(raw)) return raw;
  if (RAW_BASE64_RE.test(raw) && raw.length > 120) return `data:image/png;base64,${raw}`;
  return null;
}

export function getSafeAtlasPdfLogoDataUrl(): string | null {
  return safePdfMakeImageDataUrl(ATLAS_PDF_LOGO_DATA_URI);
}
