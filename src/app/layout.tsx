import type { Metadata } from "next";
import "./globals.css";
import "@/styles/design-system.css";

/** לא משתמשים ב־next/font/google כדי למנוע תלות ברשת/TLS בזמן build (סביבות עם בעיית אישורים). */

export const metadata: Metadata = {
  title: "וויגו פרו",
  description: "מערכת ניהול משלוחים, תשלומים ולקוחות",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he">
      <body>{children}</body>
    </html>
  );
}
