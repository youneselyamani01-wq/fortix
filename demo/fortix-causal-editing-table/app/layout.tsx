import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "./I18nProvider";
import { resolveLocaleFromAcceptLanguage } from "./locale.ts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "FortiX · D-006",
    template: "%s · FortiX",
  },
  description:
    "HAPPENED → EVIDENCE → VERIFY · FAITS → PREUVES → VÉRIFIER",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

/**
 * The language is decided here, from the request, so the server and the
 * client's first render agree. `lang` follows it: the document used to be
 * hard-coded `lang="en"` while the tree rendered French, which is both a
 * hydration mismatch and an accessibility defect.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
