"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ReceivedGraph, ReceivedGraphNode } from "./receivedGraph.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import { declaredMissionTime, receivedEventBindings, selectedEventKey, timelineNeighbours, type EvidenceSelection } from "./guidedInspection.ts";
import { readInspectionEvidence } from "./inspectionPresentation.ts";
import { receivedFactProvenance, factProvenanceLabel, factProvenanceDescription } from "./receivedProvenance.ts";
import type { VerifierPresentationProps } from "./verifierPresentation.ts";

export function EvidenceTimeline({ graph, locale, selection, onSelectionChange, compact = false, controlsId = "guided-evidence-inspector", text, readingNodeKey, networkScope = true, uiState, onUIStateChange, restoreToken, navigationIntent }: VerifierPresentationProps & {
  graph: ReceivedGraph;
  locale: "en" | "fr";
  selection: EvidenceSelection;
  onSelectionChange: (selection: EvidenceSelection) => void;
  compact?: boolean;
  controlsId?: string;
  text?: string;
  readingNodeKey?: string | null;
  /** The route shell shows the Network lane instead of this note. */
  networkScope?: boolean;
}) {
  const fr = locale === "fr";
  const entries = useMemo(() => receivedEventBindings(graph, locale), [graph, locale]);
  const finalCount = entries.filter((entry) => entry.node.final).length;
  const declaredEventCount = entries.length - finalCount;
  const finalReceiptCountLabel = fr
    ? `${finalCount} ${finalCount !== 1 ? "Reçus finaux" : "Reçu final"}`
    : `${finalCount} ${finalCount === 1 ? "Final Receipt" : "Final Receipts"}`;
  const eventCountLabel = fr
    ? `${declaredEventCount} ${declaredEventCount !== 1 ? "événements" : "événement"}`
    : `${declaredEventCount} ${declaredEventCount === 1 ? "event" : "events"}`;
  const provenance = useMemo(() => new Map(entries.map((entry) => [entry.nodeKey, receivedFactProvenance(entry.node, text)])), [entries, text]);
  const eventTypes = useMemo(() => entries.map((entry) => {
    if (!text) return null;
    const source = readInspectionEvidence(text, entry.node);
    const raw = source.status === "FOUND" && source.raw !== null && typeof source.raw === "object" && !Array.isArray(source.raw) ? source.raw as Record<string, unknown> : null;
    return raw?.eventType ?? null;
  }), [entries, text]);
  const lostCount = eventTypes.filter((type) => type === "NETWORK_LINK_LOST").length;
  const restoredCount = eventTypes.filter((type) => type === "NETWORK_LINK_RESTORED").length;
  const hasNetworkTransition = lostCount + restoredCount > 0;
  const networkEvents = (count: number) => `${count} ${fr ? (count === 1 ? "événement" : "événements") : (count === 1 ? "event" : "events")}`;
  const hasPresentedReconciliation = eventTypes.some((type) => type === "RECONCILIATION_RECEIPT");
  const auditedNetwork = entries.some((entry, index) => ["NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED"].includes(String(eventTypes[index])) && provenance.get(entry.nodeKey)?.basis === "AUDITED_SCRIPT");
  const boundaryEdge = selection.kind === "boundary" && selection.edgeKey ? graph.edges.find((edge) => edge.key === selection.edgeKey) : null;
  const selectedKey = readingNodeKey !== undefined ? readingNodeKey : selectedEventKey(selection) ?? (boundaryEdge
    ? entries.some((entry) => entry.nodeKey === boundaryEdge.to) ? boundaryEdge.to : entries.some((entry) => entry.nodeKey === boundaryEdge.from) ? boundaryEdge.from : null
    : null);
  const neighbours = timelineNeighbours(entries, selectedKey);
  const listRef = useRef<HTMLOListElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const restoringRef = useRef(false);
  const stateRef = useRef(uiState);
  const controlledTimeline = uiState !== undefined;
  useEffect(() => { stateRef.current = uiState; }, [uiState]);
  useEffect(() => {
    if (!stateRef.current || navigationIntent !== "restore") return;
    restoringRef.current = true;
    const frame = requestAnimationFrame(() => {
      const point = stateRef.current?.timelineScroll;
      if (point) scrollerRef.current?.scrollTo({ left: point.x, top: point.y, behavior: "instant" });
      restoringRef.current = false;
    });
    return () => { cancelAnimationFrame(frame); restoringRef.current = false; };
  }, [restoreToken, navigationIntent]);
  useEffect(() => {
    // A graph click updates identity without moving the user's timeline viewport.
    // Controlled restoration owns that viewport; only standalone timelines center.
    if (controlledTimeline) return;
    if (!selectedKey) return;
    const selected = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-timeline-node-key]") ?? [])]
      .find((item) => item.dataset.timelineNodeKey === selectedKey);
    const scroller = listRef.current?.parentElement;
    if (!selected || !scroller) return;
    const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ left: Math.max(0, selected.offsetLeft - (scroller.clientWidth - selected.offsetWidth) / 2), behavior: reduceMotion ? "auto" : "smooth" });
  }, [selectedKey, controlledTimeline]);
  const label = (node: ReceivedGraphNode) => node.final
    ? (fr ? "Reçu final" : "Final Receipt")
    : receivedEventLabel(node.member?.eventId, locale) ?? node.context.label?.value ?? (fr ? "Événement déclaré" : "Declared event");
  const choose = (nodeKey: string) => onSelectionChange({ kind: "event", nodeKey });
  const sameDeclaredTime = (index: number) => {
    const current = entries[index]?.declaredTimeMs;
    return current !== null && (entries[index - 1]?.declaredTimeMs === current || entries[index + 1]?.declaredTimeMs === current);
  };
  const neighbourButton = (entry: typeof neighbours.previous, direction: "previous" | "next") => entry ? <button type="button" onClick={() => choose(entry.nodeKey)}>
    <small>{direction === "previous" ? (fr ? "← Événement précédent" : "← Previous event") : (fr ? "Événement suivant →" : "Next event →")}</small>
    <strong>{label(entry.node)}</strong><span>{declaredMissionTime(entry.declaredTimeMs, locale)}</span>
  </button> : <span className="evidence-timeline-end"><small>{direction === "previous" ? (fr ? "Début de la timeline" : "Start of timeline") : (fr ? "Fin de la timeline" : "End of timeline")}</small></span>;

  return <section className="evidence-timeline" data-compact={compact} data-has-selection={!!neighbours.current} aria-labelledby="evidence-timeline-title">
    <header><div><h2 id="evidence-timeline-title">{compact ? "Timeline" : fr ? "Quand les faits ont-ils été déclarés ?" : "When were the facts declared?"}</h2>{!compact && <p>{fr ? "Ordre strict du temps déclaré, puis position reçue uniquement pour stabiliser les égalités. Aucun horaire n’est inventé." : "Strict declared-time order, then received position only to stabilize ties. No time is invented."}</p>}</div><strong>{`${entries.length} ${fr ? "éléments" : "items"} · ${eventCountLabel} · ${finalReceiptCountLabel}`}</strong></header>
    {networkScope && hasNetworkTransition && <aside className="evidence-network-scope"><strong>{fr ? "Transitions réseau reçues" : "Received network transitions"}</strong><p>{fr ? `${networkEvents(lostCount)} de perte et ${networkEvents(restoredCount)} de retour sont reçus. Un retour décrit la transition vers CONNECTED. Aucune causalité supplémentaire n’est ajoutée. ${hasPresentedReconciliation ? "Un événement de réconciliation est aussi présenté." : "Aucun événement de réconciliation n’est présenté dans cette Timeline."}` : `${networkEvents(lostCount)} of loss and ${networkEvents(restoredCount)} of restoration were received. Restoration describes a transition to CONNECTED. No extra causality is added. ${hasPresentedReconciliation ? "A reconciliation event is also presented." : "No reconciliation event is presented in this Timeline."}`}</p>{auditedNetwork && <p>{fr ? "Les transitions du PEB d’audit connu ont été ajoutées par un scénario scripté. Elles ne constituent pas une capture de coupure physique." : "The known audit PEB transitions were added by a scripted scenario. They do not establish a captured physical disconnection."}</p>}</aside>}
    {entries.length === 0 && <p role="status">{fr ? "Aucun événement de mission ni reçu final n’est disponible dans ce PEB pour la Timeline." : "No mission event or Final Receipt is available in this PEB for the Timeline."}</p>}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to focus and pan this horizontal timeline. */}
    <div className="evidence-timeline-scroll" ref={scrollerRef} role="region" aria-label={fr ? "Événements dans l’ordre déclaré" : "Events in declared order"} tabIndex={0} onScroll={event => {
      if (!restoringRef.current) onUIStateChange?.({ timelineScroll: { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop } });
    }}>
      <ol ref={listRef}>{entries.map((entry, index) => <li key={entry.nodeKey}>
        <button type="button" data-timeline-node-key={entry.nodeKey} aria-controls={controlsId} aria-pressed={selectedKey === entry.nodeKey} onClick={() => choose(entry.nodeKey)}>
          <time>{declaredMissionTime(entry.declaredTimeMs, locale)}</time><strong>{label(entry.node)}</strong><span>{receivedProducerLabel(entry.producerDomain ?? (fr ? "Non déclaré" : "Not declared"), locale)}</span>
          <span className="evidence-timeline-provenance" data-provenance={provenance.get(entry.nodeKey)!.category} title={factProvenanceDescription(provenance.get(entry.nodeKey)!, locale)}>{factProvenanceLabel(provenance.get(entry.nodeKey)!, locale)}</span>
          {sameDeclaredTime(index) && <em>{fr ? "Même temps déclaré" : "Same declared time"}</em>}<small>{fr ? "Voir cet événement et ses preuves" : "View this event and its evidence"}</small>
        </button>
      </li>)}</ol>
    </div>
    {!compact && <nav className="evidence-timeline-position" aria-label={fr ? "Position dans la timeline" : "Timeline position"}>
      {neighbourButton(neighbours.previous, "previous")}
      {neighbours.current ? <div><small>{fr ? `Position ${neighbours.index + 1} sur ${entries.length} éléments dans la Timeline` : `Position ${neighbours.index + 1} of ${entries.length} Timeline items`}</small><strong>{label(neighbours.current.node)}</strong><span>{declaredMissionTime(neighbours.current.declaredTimeMs, locale)}</span></div> : <div><small>{fr ? `Aucune sélection parmi ${entries.length} éléments dans la Timeline` : `No selection among ${entries.length} Timeline items`}</small><strong>{fr ? "Sélectionnez un événement" : "Select an event"}</strong><span>{fr ? "La timeline conserve votre position." : "The timeline keeps your position."}</span></div>}
      {neighbourButton(neighbours.current ? neighbours.next : entries[0] ?? null, "next")}
    </nav>}
  </section>;
}
