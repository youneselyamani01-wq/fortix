import { EvidenceObject } from "../../../../../site/src/components/evidence-artifact/EvidenceObject";
/** Compact representation of the same evidence container, never a corporate mark. */
export function PebGlyph() {
  return <span className="nx-peb-glyph" aria-hidden="true"><EvidenceObject locale="en" variant="compact" /></span>;
}
