import type { Metadata } from "next";
import "./globals.css";
import "@/styles/design-system.css";
import "@/styles/wego-pro-responsive.css";

/** לא משתמשים ב־next/font/google כדי למנוע תלות ברשת/TLS בזמן build (סביבות עם בעיית אישורים). */

export const metadata: Metadata = {
  title: {
    default: "וויגו פרו — מערכת לוגיסטיקה",
    template: "%s — וויגו פרו",
  },
  description: "מערכת לוגיסטיקה — וויגו פרו",
  icons: {
    icon: "/icon.png",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
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
