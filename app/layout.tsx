import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font instead of fetched from Google at
// page load: one less external request on the stadium's wifi, and no flash of
// unstyled numbers on the timer screens. Thai text has no glyphs in either
// face, so it falls through to the device's own sans — which is what it
// already did with the old <link> tags.
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "จับเวลาวิ่ง",
  description: "ระบบจับเวลาวิ่งสองจุด สำหรับกีฬาสี",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={`${oswald.variable} ${inter.variable}`}>
      <body className="font-body antialiased selection:bg-amber/30">{children}</body>
    </html>
  );
}
