import type { Metadata } from "next";
import { headers } from "next/headers";
import { en } from "../../../site/src/i18n/locales/en";
import { fr } from "../../../site/src/i18n/locales/fr";
import { ConvergenceExperience } from "./ConvergenceExperience";
import { resolveLocaleFromAcceptLanguage } from "./locale.ts";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  const copy = (locale === "fr" ? fr : en).d006c2;
  const title = `FortiX · ${copy.brandSubtitle}`;
  const description = `${copy.heroQuestion} ${copy.heroAnswer} ${copy.heroIntro}`;
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const imageUrl = new URL(
    "/og-bud.png",
    `${protocol}://${host}`,
  ).toString();

  return {
    title: {
      absolute: title,
    },
    description,
    openGraph: {
      title,
      description,
      images: [{ url: imageUrl, width: 1672, height: 941 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function Home() {
  return <ConvergenceExperience />;
}
