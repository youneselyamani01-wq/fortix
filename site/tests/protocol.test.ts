import { describe, expect, it } from "vitest";
import { BRAND_SIGNATURE, VERDICTS, STANDARDS } from "../src/i18n/protocol";
import { en } from "../src/i18n/locales/en";
import { fr } from "../src/i18n/locales/fr";

describe("protocol invariants", () => {
  it("keeps the canonical signature in exactly its specified form", () => {
    expect(BRAND_SIGNATURE).toBe("Don’t trust. Verify.");
  });

  it("exposes exactly the four normative verdicts", () => {
    expect(VERDICTS).toEqual(["VALID", "INVALID", "INDETERMINATE", "REVOKED"]);
  });

  it("never duplicates the signature inside either locale dictionary", () => {
    const enJson = JSON.stringify(en);
    const frJson = JSON.stringify(fr);
    expect(enJson.includes(BRAND_SIGNATURE)).toBe(false);
    expect(frJson.includes(BRAND_SIGNATURE)).toBe(false);
  });

  it("keeps standards names untranslated between locales", () => {
    const enJson = JSON.stringify(en);
    const frJson = JSON.stringify(fr);
    expect(enJson).toContain(STANDARDS.hash);
    expect(frJson).toContain(STANDARDS.hash);
    expect(enJson).toContain(STANDARDS.signature);
    expect(frJson).toContain(STANDARDS.signature);
  });

  it("never presents FortiX as a trust layer or governance platform definition", () => {
    const enJson = JSON.stringify(en).toLowerCase();
    const frJson = JSON.stringify(fr).toLowerCase();
    expect(enJson).not.toContain("trust layer");
    expect(enJson).not.toContain("governance platform");
    expect(frJson).not.toContain("plateforme de gouvernance");
  });

  it("positions FortiX as independent verification infrastructure", () => {
    expect(en.meta.description.toLowerCase()).toContain("independent");
    expect(fr.meta.description.toLowerCase()).toContain("indépend");
  });
});
