import { useI18n } from "../../i18n/context";
import { evidenceObjectCopy } from "./evidenceObjectModel";
import { PebArtwork } from "./PebArtwork";
import "./evidence-artifact.css";

/** One site illustration, shared by the hero, narrative and closing panel. */
export function EvidenceArtifact({ loading = "lazy" }: { loading?: "eager" | "lazy" }) {
  const { locale } = useI18n();
  const copy = evidenceObjectCopy(locale);
  return <figure className="evidence-artifact" aria-label={copy.illustration}>
    <div className="evidence-artifact__object">
      <PebArtwork loading={loading} />
    </div>
    <figcaption>{copy.illustration}</figcaption>
  </figure>;
}
