import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Stylist — Shaxsiy garderobingizdagi kelajak",
    template: "%s — AI Stilist",
  },
  description:
    "Garderobingizdagi kiyimlardan avtomatik outfit tavsiya qiluvchi AI stilist. Faqat sizniki — xarid yo'q.",
  keywords: ["AI stylist", "fashion", "wardrobe", "outfit", "O'zbek"],
  authors: [{ name: "AI Fashion Stylist" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "AI Stylist",
    description: "Shaxsiy AI stilistingiz — garderobingizdan outfit",
    siteName: "AI Stylist",
    type: "website",
  },
};

// Pinch-zoom intentionally allowed (no maximumScale / userScalable) — a11y.
export const viewport: Viewport = {
  themeColor: "#F8F8F6",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* Messages/locale/timeZone are inherited from src/i18n/request.ts */}
        <NextIntlClientProvider>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
