import { resolveSurfaceUrl } from "./resolveSurfaceUrl";

/** Deployment destinations are configurable; local previews use the current host's NX server. */
const currentHref = typeof window === "undefined" ? undefined : window.location.href;
export const DEMO_URL = resolveSurfaceUrl("/nx", {
  configured: import.meta.env.VITE_DEMO_URL, development: import.meta.env.DEV, currentHref,
});
export const VERIFIER_URL = resolveSurfaceUrl("/verify", {
  configured: import.meta.env.VITE_VERIFIER_URL, development: import.meta.env.DEV, currentHref,
});
export const DOCS_URL: string | null = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? null;
export const GITHUB_URL: string | null = (import.meta.env.VITE_GITHUB_URL as string | undefined) ?? null;
