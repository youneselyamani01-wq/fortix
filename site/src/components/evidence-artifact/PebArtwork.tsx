import type { ImgHTMLAttributes } from "react";
import { useI18n } from "../../i18n/context";
import { evidenceObjectCopy } from "./evidenceObjectModel";

type PebArtworkProps = Pick<ImgHTMLAttributes<HTMLImageElement>,
  "className" | "loading" | "onLoad" | "onError"
>;

/** Canonical rounded studio PEB, localized without changing its silhouette.
 * Every site illustration uses this source; never an issued package or verdict. */
export function PebArtwork({ loading = "lazy", ...imageProps }: PebArtworkProps) {
  const { locale } = useI18n();
  const copy = evidenceObjectCopy(locale);

  return <img
    {...imageProps}
    key={locale}
    data-peb-artwork="canonical"
    src={`/images/peb-studio-${locale}-v2.png`}
    alt={`${copy.title} : ${copy.receipt}, ${copy.records}, ${copy.context}.`}
    width="1448"
    height="1086"
    loading={loading}
    decoding="async"
  />;
}
