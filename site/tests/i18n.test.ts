import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/locales/en";
import { fr } from "../src/i18n/locales/fr";

type AnyRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyPaths(value: unknown, path = ""): string[] {
  if (isPlainObject(value)) {
    return Object.keys(value).flatMap((key) => keyPaths(value[key], path ? `${path}.${key}` : key));
  }
  if (Array.isArray(value)) {
    return [path];
  }
  return [path];
}

describe("i18n dictionary completeness", () => {
  it("has an identical key structure between en and fr", () => {
    const enPaths = keyPaths(en).sort();
    const frPaths = keyPaths(fr).sort();
    expect(frPaths).toEqual(enPaths);
  });

  it("has no empty string values in either locale", () => {
    const check = (value: unknown, path: string, locale: string) => {
      if (typeof value === "string") {
        expect(value.trim().length, `${locale}:${path} should not be empty`).toBeGreaterThan(0);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => check(item, `${path}[${index}]`, locale));
      } else if (isPlainObject(value)) {
        for (const key of Object.keys(value)) {
          check(value[key], path ? `${path}.${key}` : key, locale);
        }
      }
    };
    check(en, "", "en");
    check(fr, "", "fr");
  });

  it("uses distinct EN and FR strings for the hero title", () => {
    expect(en.hero.title).not.toBe(fr.hero.title);
  });
});
