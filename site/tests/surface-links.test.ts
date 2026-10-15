import { describe, expect, it } from "vitest";
import { resolveSurfaceUrl } from "../src/content/resolveSurfaceUrl";

describe("surface destinations", () => {
  it.each([
    ["http://localhost:5174/", "http://localhost:3000"],
    ["http://127.0.0.1:5174/", "http://127.0.0.1:3000"],
    ["http://192.168.1.42:5174/?lang=fr#proof", "http://192.168.1.42:3000"],
    ["http://[::1]:5174/", "http://[::1]:3000"],
    ["http://[2001:db8::42]:5174/", "http://[2001:db8::42]:3000"],
    ["https://fortix-review.local:5174/", "https://fortix-review.local:3000"],
  ])("keeps the current development host for %s", (currentHref, origin) => {
    for (const path of ["/nx", "/verify"] as const) {
      expect(resolveSurfaceUrl(path, { development: true, currentHref })).toBe(origin + path);
    }
  });

  it("preserves explicit deployments in development and production", () => {
    for (const development of [true, false]) {
      expect(resolveSurfaceUrl("/nx", { configured: "https://demo.example/mission?lang=fr", development, currentHref: "http://192.168.1.42:5174/" })).toBe("https://demo.example/mission?lang=fr");
      expect(resolveSurfaceUrl("/verify", { configured: "/evidence/verify", development })).toBe("/evidence/verify");
    }
  });

  it("keeps production same-origin paths without baking in a development host", () => {
    for (const path of ["/nx", "/verify"] as const) {
      expect(resolveSurfaceUrl(path, { development: false, currentHref: "https://fortix.example/" })).toBe(path);
      expect(resolveSurfaceUrl(path, { development: true })).toBe(path);
    }
  });

  it("treats blank example environment values as unset", () => {
    for (const configured of [undefined, "", "   "]) {
      expect(resolveSurfaceUrl("/verify", { configured, development: true, currentHref: "http://192.168.1.42:5174/" })).toBe("http://192.168.1.42:3000/verify");
    }
  });
});
