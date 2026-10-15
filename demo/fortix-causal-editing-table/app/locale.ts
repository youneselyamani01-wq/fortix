import type { Locale } from "../../../site/src/i18n/dictionary";

/**
 * D-006G — server-side locale resolution.
 *
 * The demonstration used to decide its language on the client, during render:
 * the provider returned "en" when `window` was undefined and read
 * `navigator.language` otherwise. The server therefore always rendered
 * English while a French browser hydrated French, and React tore the tree
 * down with a hydration mismatch — a full-screen error overlay in dev on any
 * FR machine, and a silent client re-render in production.
 *
 * The fix is to decide the language where the request is: `Accept-Language`
 * is the server-visible form of the same preference `navigator.language`
 * reports, so resolving it here lets the first server render and the first
 * client render agree by construction. A stored choice still wins, but it is
 * applied after mount, where changing it is a state update rather than a
 * contradiction.
 *
 * This is pure and framework-free so it can be tested directly.
 */

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export const DEFAULT_LOCALE: Locale = "en";

function isSupported(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Honours q-weights and matches on the primary subtag, so `fr-CA` selects
 * French. Ties keep the order the client sent, which is what the header
 * means. Anything unparseable yields the default rather than throwing: a
 * malformed header must not decide what language a demonstration renders in,
 * and must never take the page down.
 */
export function resolveLocaleFromAcceptLanguage(header: string | null | undefined): Locale {
  if (typeof header !== "string" || header.trim().length === 0) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tagPart, ...parameters] = part.trim().split(";");
      const tag = tagPart.trim().toLowerCase();
      if (tag.length === 0) return null;
      const qParameter = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      const quality = qParameter === undefined ? 1 : Number.parseFloat(qParameter.slice(2));
      // "q=0" means explicitly not acceptable, and a malformed q is not a
      // reason to promote a language the client did not ask for.
      if (!Number.isFinite(quality) || quality <= 0) return null;
      return { primary: tag.split("-")[0], quality, index };
    })
    .filter((entry): entry is { primary: string; quality: number; index: number } => entry !== null)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const entry of ranked) {
    if (entry.primary === "*") return DEFAULT_LOCALE;
    if (isSupported(entry.primary)) return entry.primary;
  }
  return DEFAULT_LOCALE;
}

/** A stored choice is deliberate and outranks the request header. */
export function storedLocale(value: string | null): Locale | null {
  return value !== null && isSupported(value) ? value : null;
}
