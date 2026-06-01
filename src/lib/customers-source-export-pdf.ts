export function buildCustomersExportHtml(headers: string[], rows: string[][], stamp: string): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((c) => `<td>${escapeHtml(c || "—")}</td>`).join("")}</tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>לקוחות ${escapeHtml(stamp)}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; }
    th { background: #e2e8f0; }
    tr:nth-child(even) { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>טבלת לקוחות · ${escapeHtml(stamp)}</h1>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
