import { surfaceCopy } from "../i18n/surface";
import "../styles/boundary-key.css";
export function BoundaryKey({ locale }: { locale: "en" | "fr" }) {
  const c = surfaceCopy[locale];
  return <details className="boundary-key"><summary>{c.grammar}</summary>
    <ul><li><i className="boundary-key__zone" aria-hidden="true" />{c.boundary}</li>
      <li><i className="boundary-key__edge" aria-hidden="true" />{c.edge}</li>
      <li><i className="boundary-key__bead" aria-hidden="true" />{c.bead}</li></ul><p>{c.grammarNote}</p>
  </details>;
}
