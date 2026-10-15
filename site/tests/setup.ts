import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// Each test renders its own ThemeProvider/LanguageProvider from scratch and
// expects the default (system) preference unless the test itself sets one —
// without this, a language/theme toggle in one test would leak into the
// next via the real jsdom localStorage.
afterEach(() => {
  window.localStorage.clear();
});

// jsdom does not implement matchMedia; the theme, language, and
// reduced-motion hooks all read it, so tests need a minimal stub.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// jsdom's canvas has no WebGL context — this is intentional. Tests that
// render the app exercise the real "no WebGL" fallback path rather than
// mocking a context, giving actual coverage of that requirement. jsdom
// logs a noisy "Not implemented" warning every time getContext() is
// probed; stub it to return null quietly instead — the app already
// treats a null/thrown getContext identically (see useWebglSupport).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
