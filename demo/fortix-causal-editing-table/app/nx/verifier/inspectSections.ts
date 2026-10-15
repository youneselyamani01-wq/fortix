/**
 * D-006/NX3 — the sections of the verifier's INSPECT view, as a plain module.
 *
 * WHY THIS FILE EXISTS. The section list is read in two places that cannot
 * share a client module: the surface itself (a client component) and the
 * server-rendered page, which parses `?inspect=<section>` into the initial
 * workspace state. A "use client" module turns every export into a client
 * reference, so a parser exported from the component could not run on the
 * server — the same trap `journalAt` fell into. Kept here, with no directive,
 * both sides read one list.
 */

export type InspectSection = "path" | "graph" | "structure" | "flow" | "receipts" | "trust";

/** Document order of the sections: the path first, the trust record last. */
export const INSPECT_SECTIONS: readonly InspectSection[] = Object.freeze(["path", "graph", "structure", "flow", "receipts", "trust"]);

/** `?inspect=<section>` → a section, or null for anything else. Never a default: a link that names no section opens none. */
export function inspectSectionFrom(value: string | undefined): InspectSection | null {
  return value !== undefined && (INSPECT_SECTIONS as readonly string[]).includes(value) ? value as InspectSection : null;
}
