import { useState } from "react";
import { useI18n } from "../../i18n/context";
import { downloadReferencePeb } from "../../verification/downloadReferencePeb";
import { SECTION_IDS } from "../../content/sections";
import "./open-verification.css";

export function OpenVerification() {
  const { t, locale } = useI18n();
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "started" | "error">("idle");

  const handleDownload = async () => {
    if (downloadState === "loading") return;
    setDownloadState("loading");
    try {
      await downloadReferencePeb();
      setDownloadState("started");
    } catch {
      setDownloadState("error");
    }
  };

  return (
    <section
      id={SECTION_IDS.openVerification}
      className="section open-verification"
      aria-labelledby="open-verification-title"
    >
      <div className="container">
        <span className="section-kicker">{t.openVerification.kicker}</span>
        <h2 id="open-verification-title" className="section-title">
          {t.openVerification.title}
        </h2>
        <p className="section-lede">{t.openVerification.body}</p>

        <ul className="open-verification__list">
          {t.openVerification.items.map((item) => (
            <li key={item.label}>
              <div className="open-verification__row">
                <span className="status-tag" data-status={item.status}>
                  {t.openVerification.distinguish[item.status]}
                </span>
                <strong>{item.label}</strong>
              </div>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>

        <div className="open-verification__public-proof">
          <p className="section-kicker">{locale === "fr" ? "DOSSIER PUBLIC DE RÉFÉRENCE" : "PUBLIC REFERENCE EVIDENCE"}</p>
          <h3>{locale === "fr" ? "Ne nous croyez pas. Vérifiez." : "Don't trust us. Verify."}</h3>
          <p>{locale === "fr"
            ? "Un PEB D-006 de démonstration est téléchargeable sans lancer la mission. Analysez-le dans le Vérificateur indépendant, puis testez une copie modifiée. Verdict attendu : INDETERMINATE, et non VALID en production."
            : "Download a D-006 demonstration PEB without running the mission. Analyze it in the Independent Verifier, then test an altered copy. Expected verdict: INDETERMINATE, not production VALID."}</p>
          <div className="open-verification__actions">
            <button className="button button--primary" type="button" onClick={() => { void handleDownload(); }} disabled={downloadState === "loading"}>
              {downloadState === "loading"
                ? (locale === "fr" ? "Préparation du fichier…" : "Preparing file…")
                : (locale === "fr" ? "Télécharger le PEB (.json)" : "Download the PEB (.json)")}
            </button>
            <a className="button button--ghost" href="/verify" target="_blank" rel="noopener noreferrer">
              {locale === "fr" ? "Ouvrir le Vérificateur" : "Open the Verifier"}
            </a>
            <a className="button button--ghost" href="https://github.com/youneselyamani01-wq/fortix/issues/2" target="_blank" rel="noopener noreferrer">
              {locale === "fr" ? "Empreinte et identité attendues" : "Expected digest and identity"}
            </a>
            <a className="button button--ghost" href="https://github.com/youneselyamani01-wq/fortix/blob/727dc6844da69938079c37457e63a29f4e7a0e20/docs/evidence/D006-PUBLIC-REFERENCE.md" target="_blank" rel="noopener noreferrer">
              {locale === "fr" ? "Portée et guide de vérification" : "Verification guide and limits"}
            </a>
          </div>
          <p className="open-verification__download-status" role="status" aria-live="polite">
            {downloadState === "started"
              ? (locale === "fr" ? "Téléchargement demandé. Consultez vos téléchargements Edge." : "Download requested. Check your browser downloads.")
              : downloadState === "error"
                ? (locale === "fr" ? "Téléchargement indisponible pour le moment. Aucun fichier n’a été enregistré." : "Download unavailable. No file was saved.")
                : ""}
          </p>
          <p className="open-verification__reference-note">
            {locale === "fr"
              ? "Avant d’analyser : comparer les octets reçus aux valeurs de référence publiées hors du PEB. Journal runtime non signé individuellement ; profil de scénario D-006, pas vérification générique."
              : "Before analysis: compare received bytes against reference values published outside the PEB. Runtime journal not individually signed; D-006 is a scenario-specific profile, not generic verification."}
          </p>
          <p className="open-verification__limits">{locale === "fr"
            ? "Scénario simulé ; confiance de production et temps de confiance non établis. Aucune preuve de règlement bancaire ou d'événement physique réel."
            : "Simulated scenario; production trust and trusted time not established. No proof of bank settlement or real-world physical events."}</p>
        </div>
      </div>
    </section>
  );
}
