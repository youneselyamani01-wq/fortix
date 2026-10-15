"use client";

import { VERIFIER_PRIMARY_VIEWS, type VerifierView } from "./verifierRoutes";

export type { VerifierView } from "./verifierRoutes";

const viewOrder: readonly VerifierView[] = VERIFIER_PRIMARY_VIEWS;

const labels: Readonly<Record<VerifierView, readonly [string, string]>> = {
  verdict: ["Verdict", "Verdict"],
  path: ["Path", "Chemin"],
  timeline: ["Timeline", "Timeline"],
  domains: ["Domains", "Domaines"],
  network: ["Network", "Réseau"],
  graph: ["Causal graph", "Graphe causal"],
  event: ["Selected event", "Événement sélectionné"],
  nanoreceipts: ["NanoReceipts", "NanoReceipts"],
  forensic: ["Forensic", "Forensic"],
};

export type VerifierViewActionsProps = Readonly<{
  locale: "en" | "fr";
  currentView: VerifierView;
  links: Partial<Record<VerifierView, string>>;
  onSelect?: (view: VerifierView) => void;
  compact?: boolean;
}>;

/** Canonical URLs are supplied by the route shell; this component never reconstructs them. */
export function VerifierViewActions({ locale, currentView, links, onSelect, compact = false }: VerifierViewActionsProps) {
  const fr = locale === "fr";
  const available = viewOrder.filter((view) => links[view]);
  const currentHref = links[currentView];
  return <nav className="modular-view-actions" data-compact={compact} aria-label={fr ? "Vues du Vérificateur" : "Verifier views"}>
    <div className="modular-view-actions__links">
      {available.map((view) => <a
        key={view}
        href={links[view]}
        aria-current={view === currentView ? "page" : undefined}
        data-verifier-view={view}
        onClick={() => onSelect?.(view)}
      >{labels[view][fr ? 1 : 0]}</a>)}
    </div>
    {currentHref && <a
      className="modular-view-actions__new-tab"
      href={currentHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onSelect?.(currentView)}
    >{fr ? "Ouvrir cette vue dans un nouvel onglet" : "Open this view in a new tab"}<span aria-hidden="true">↗</span></a>}
  </nav>;
}
