/** Development surfaces share the browser's host; deployment overrides stay explicit. */
export function resolveSurfaceUrl(path: "/nx" | "/verify", options: {
  configured?: string;
  development: boolean;
  currentHref?: string;
}): string {
  const configured = options.configured?.trim();
  if (configured) return configured;
  if (!options.development || !options.currentHref) return path;
  const current = new URL(options.currentHref);
  if (current.protocol !== "http:" && current.protocol !== "https:") return path;
  const destination = new URL(path, current.origin);
  destination.port = "3000";
  return destination.href;
}
