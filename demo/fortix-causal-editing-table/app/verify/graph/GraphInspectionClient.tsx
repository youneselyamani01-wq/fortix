"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- This legacy handoff requires native anchors with popup-safe behavior. */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../I18nProvider";
import { ReceivedPebInspection } from "../ReceivedPebInspection";
import { receiveGraphInspection, type GraphParcel } from "../graphHandoff.ts";
import "../../nx/nx.css";
import "../verifier.css";
import "../surfaces.css";
import "../visual-hierarchy.css";

/** Inspection only: the source Verifier already owns the explicit Analyze action. */
export function GraphInspectionClient() {
  const { locale, setLocale } = useI18n();
  const [parcel, setParcel] = useState<GraphParcel | null>(null);
  const [failed, setFailed] = useState(false);
  const returnToVerifier = useRef<(() => void) | null>(null);
  useEffect(() => receiveGraphInspection((received, back) => {
    returnToVerifier.current = back; setLocale(received.locale); setParcel(received);
  }, () => setFailed(true)), [setLocale]);
  const fr = locale === "fr";
  return <main className="nx verifier-page verifier-flow verifier-graph-page" data-workspace="inspection" data-dedicated-graph="true" data-graph-digest={parcel?.digest}>
    {parcel ? <>
      <div className="verifier-graph-context"><a href="/verify" onClick={event => { if (returnToVerifier.current) { event.preventDefault(); returnToVerifier.current(); } }}>FortiX · Verifier</a><span>PEB · {parcel.name}</span><span data-verdict={parcel.snapshot?.result.verdict}>{parcel.snapshot?.result.verdict ?? (fr ? "Non analysé" : "Not analyzed")}</span></div>
      <ReceivedPebInspection text={parcel.text} locale={locale} analyzed={!!parcel.snapshot} snapshot={parcel.snapshot} view="graph" dedicated initialContext={parcel.context} onReturnToVerifier={() => returnToVerifier.current?.()} />
    </> : <section className="verifier-graph-entry" aria-live="polite"><p>FortiX · {fr ? "Inspection experte" : "Expert inspection"}</p><h1>{fr ? "Graphe causal" : "Causal graph"}</h1><p>{failed ? (fr ? "Le PEB n’a pas pu être reçu. Ouvrez le graphe à nouveau depuis le Vérificateur." : "The PEB could not be received. Open the graph again from the Verifier.") : (fr ? "Ouvrez le graphe depuis un PEB dans le Vérificateur pour retrouver les preuves et la sélection." : "Open the graph from a PEB in the Verifier to preserve its evidence and selection.")}</p><a className="verifier-action" href="/verify">{fr ? "Ouvrir le Vérificateur" : "Open Verifier"}</a></section>}
  </main>;
}
