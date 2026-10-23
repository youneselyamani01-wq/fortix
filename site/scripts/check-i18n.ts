/**
 * Belt-and-braces i18n completeness check, run with:
 *   node --experimental-strip-types scripts/check-i18n.ts
 *
 * TypeScript already guarantees structural completeness — both `en` and
 * `fr` in src/i18n/locales are typed as `Dictionary`, so a missing key in
 * either locale is a compile error (see `npm run typecheck`). This script
 * is a second, independent check that runs against the actual runtime
 * objects: it asserts deep key-set equality between locales, flags any
 * value left empty, and enforces the two rules the dictionary type alone
 * cannot express — that each localized signature is never present inside a
 * translated dictionary (it is only ever imported from `i18n/protocol.ts`
 * directly) and that no locale accidentally translates one of the four
 * normative verdict words.
 */
import { en } from "../src/i18n/locales/en.ts";
import { fr } from "../src/i18n/locales/fr.ts";
import { BRAND_SIGNATURE, VERDICTS } from "../src/i18n/protocol.ts";

type AnyRecord = Record<string, unknown>;

const errors: string[] = [];

function isPlainObject(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectStrings(value: unknown, path: string, sink: Map<string, string>): void {
  if (typeof value === "string") {
    sink.set(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, sink));
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      collectStrings(value[key], path ? `${path}.${key}` : key, sink);
    }
  }
}

function compareKeySets(a: AnyRecord, b: AnyRecord, path: string): void {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));

  for (const key of aKeys) {
    if (!bKeys.has(key)) {
      errors.push(`fr is missing key present in en: ${path}${path ? "." : ""}${key}`);
    }
  }
  for (const key of bKeys) {
    if (!aKeys.has(key)) {
      errors.push(`en is missing key present in fr: ${path}${path ? "." : ""}${key}`);
    }
  }

  for (const key of aKeys) {
    if (!bKeys.has(key)) continue;
    const aValue = a[key];
    const bValue = b[key];
    const nextPath = path ? `${path}.${key}` : key;

    if (isPlainObject(aValue) && isPlainObject(bValue)) {
      compareKeySets(aValue, bValue, nextPath);
    } else if (Array.isArray(aValue) && Array.isArray(bValue)) {
      if (aValue.length !== bValue.length) {
        errors.push(
          `Array length mismatch at ${nextPath}: en has ${aValue.length}, fr has ${bValue.length}`,
        );
      }
      const shorter = Math.min(aValue.length, bValue.length);
      for (let i = 0; i < shorter; i += 1) {
        const itemA = aValue[i];
        const itemB = bValue[i];
        if (isPlainObject(itemA) && isPlainObject(itemB)) {
          compareKeySets(itemA, itemB, `${nextPath}[${i}]`);
        }
      }
    }
  }
}

compareKeySets(en as unknown as AnyRecord, fr as unknown as AnyRecord, "");

const enStrings = new Map<string, string>();
const frStrings = new Map<string, string>();
collectStrings(en, "", enStrings);
collectStrings(fr, "", frStrings);

for (const [path, value] of [...enStrings, ...frStrings]) {
  if (value.trim().length === 0) {
    errors.push(`Empty string value at ${path}`);
  }
}

for (const [path, value] of enStrings) {
  if (value.includes(BRAND_SIGNATURE.en)) {
    errors.push(
      `Canonical signature must not be duplicated inside the EN dictionary (found at ${path}); import it from i18n/protocol.ts instead.`,
    );
  }
}
for (const [path, value] of frStrings) {
  if (value.includes(BRAND_SIGNATURE.fr)) {
    errors.push(
      `Canonical signature must not be duplicated inside the FR dictionary (found at ${path}); import it from i18n/protocol.ts instead.`,
    );
  }
}

const disallowedFrTranslations: Record<string, string> = {
  VALID: "VALIDE",
  INVALID: "INVALIDE",
  INDETERMINATE: "INDÉTERMINÉ",
  REVOKED: "RÉVOQUÉ",
};
for (const verdict of VERDICTS) {
  const forbidden = disallowedFrTranslations[verdict];
  if (!forbidden) continue;
  for (const [path, value] of frStrings) {
    if (value.includes(forbidden)) {
      errors.push(`FR dictionary appears to translate the protocol verdict ${verdict} at ${path} ("${forbidden}").`);
    }
  }
}

if (errors.length > 0) {
  console.error(`i18n check failed with ${errors.length} issue(s):\n`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(`i18n check passed: en/fr dictionaries have matching key sets (${enStrings.size} EN strings, ${frStrings.size} FR strings), no empty values, no duplicated signature, no translated verdicts.`);
