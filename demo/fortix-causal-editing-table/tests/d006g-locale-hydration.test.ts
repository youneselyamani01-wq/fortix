import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_LOCALE,
  resolveLocaleFromAcceptLanguage,
  storedLocale,
} from "../app/locale.ts";

/**
 * D-006G — the French hydration defect.
 *
 * The provider decided the language during render: it returned "en" when
 * `window` was undefined and read `navigator.language` otherwise. So the
 * server always rendered English and a French browser hydrated French over
 * it, and React discarded the tree with a hydration mismatch — a full-screen
 * error overlay in dev on any FR machine.
 *
 * The language is now resolved from `Accept-Language` on the server and
 * passed down, so both first renders agree by construction. A stored choice
 * still wins, applied after mount as an ordinary state update.
 */

test("D-006G: a French browser resolves to French on the server", () => {
  assert.equal(resolveLocaleFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8"), "fr");
  assert.equal(resolveLocaleFromAcceptLanguage("fr"), "fr");
  // Regional variants match on the primary subtag.
  assert.equal(resolveLocaleFromAcceptLanguage("fr-CA"), "fr");
});

test("D-006G: an English or unknown browser resolves to English", () => {
  assert.equal(resolveLocaleFromAcceptLanguage("en-GB,en;q=0.9"), "en");
  assert.equal(resolveLocaleFromAcceptLanguage("de-DE,de;q=0.9"), "en");
  assert.equal(resolveLocaleFromAcceptLanguage("*"), "en");
});

test("D-006G: q-weights decide, not header order", () => {
  // English listed first but weighted lower must not win.
  assert.equal(resolveLocaleFromAcceptLanguage("en;q=0.5,fr;q=0.9"), "fr");
  assert.equal(resolveLocaleFromAcceptLanguage("fr;q=0.3,en;q=0.7"), "en");
  // Equal weights keep the client's own order, which is what it means.
  assert.equal(resolveLocaleFromAcceptLanguage("fr,en"), "fr");
  assert.equal(resolveLocaleFromAcceptLanguage("en,fr"), "en");
});

test("D-006G: q=0 means not acceptable", () => {
  assert.equal(resolveLocaleFromAcceptLanguage("fr;q=0,en;q=0.5"), "en");
  // Everything refused falls back to the default rather than to a language
  // the client explicitly rejected.
  assert.equal(resolveLocaleFromAcceptLanguage("fr;q=0,en;q=0"), DEFAULT_LOCALE);
});

test("D-006G: a missing or malformed header never throws and never guesses", () => {
  for (const header of [null, undefined, "", "   ", ";;;", "q=", "fr;q=nonsense"]) {
    const resolved = resolveLocaleFromAcceptLanguage(header);
    assert.ok(resolved === "en" || resolved === "fr", `bad resolution for ${JSON.stringify(header)}`);
  }
  assert.equal(resolveLocaleFromAcceptLanguage(null), DEFAULT_LOCALE);
  // A malformed q must not promote a language the client did not ask for.
  assert.equal(resolveLocaleFromAcceptLanguage("fr;q=nonsense"), DEFAULT_LOCALE);
});

test("D-006G: only a supported stored value is honoured", () => {
  assert.equal(storedLocale("fr"), "fr");
  assert.equal(storedLocale("en"), "en");
  assert.equal(storedLocale(null), null);
  assert.equal(storedLocale("de"), null);
  assert.equal(storedLocale(""), null);
});

// --- the shape that makes hydration safe ---------------------------------

test("D-006G: nothing reads the browser during render", () => {
  const provider = readFileSync(new URL("../app/I18nProvider.tsx", import.meta.url), "utf8");
  // The mismatch came from render-time browser access. Every remaining
  // reference must sit inside an effect, which runs only on the client and
  // only after the first render has already matched the server.
  const beforeFirstEffect = provider.slice(0, provider.indexOf("useEffect("));
  assert.doesNotMatch(beforeFirstEffect, /window\.|navigator\.|typeof window/,
    "the provider must not read the browser before its first effect");
  assert.doesNotMatch(provider, /navigator\.language/,
    "language now comes from the request header, not from the client during render");
  assert.match(provider, /initialLocale = DEFAULT_LOCALE/);
});

test("D-006G: the server resolves the locale and the document declares it", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /resolveLocaleFromAcceptLanguage\(requestHeaders\.get\("accept-language"\)\)/);
  assert.match(layout, /<html lang=\{locale\}>/, "the document language must follow the resolved locale");
  assert.match(layout, /<I18nProvider initialLocale=\{locale\}>/);
  // It must be hard-coded nowhere any more.
  assert.doesNotMatch(layout, /<html lang="en">/);
});

test("D-006G: locale resolution is pure", () => {
  const source = readFileSync(new URL("../app/locale.ts", import.meta.url), "utf8");
  // Comments stripped first: the invariant is that this module never CALLS a
  // browser API, not that it never names one. Explaining why `navigator.language`
  // was abandoned is exactly the kind of note that belongs in the file, and a
  // guard that forbids the explanation pushes the reasoning out of the code.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(code, /window\.|document\.|navigator\.|fetch\(|localStorage|Date\.now|Math\.random/);
});
