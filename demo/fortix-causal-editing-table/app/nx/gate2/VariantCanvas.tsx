import type { CanonicalGraph } from "./canonicalGraph.ts";
import type { ComparisonZone } from "./zones.ts";
import type { VariantLayout } from "./variantTypes.ts";
import type { ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";

/**
 * D-006/NX GATE 2 — ONE RENDERER FOR EVERY VARIANT.
 *
 * A, B, C and D are drawn by this component and only this one. If each variant
 * brought its own renderer, a difference in the comparison could come from the
 * drawing rather than from the layout, and the experiment would measure the
 * wrong thing.
 *
 * WHAT THE INK MEANS (§15 — colour encodes information, never decorates):
 *
 *   fill        provenance lane. Seven hues, chosen for contrast on porcelain.
 *   dash        relation kind. A `cause` thread is solid; an `observed` thread
 *               is dashed. These are different claims and they look different.
 *   weight      boundary crossing. A thread that leaves its lane is drawn
 *               heavier, because crossing a trust boundary is the event the
 *               mandate most wants a reader to notice.
 *   opacity     zone focus. Receipts outside the zone under examination stay
 *               visible — never removed, §2 — but recede.
 *
 * ORNAMENTS ARE DRAWN FIRST, BENEATH THE EVIDENCE, AND NEVER IN AN EVIDENCE
 * COLOUR. A lane guide, a density wash or a streamline is scenery: it must not
 * be mistakable for a relation between two receipts (§8). Keeping the two in
 * separate layers with separate palettes is how that rule is enforced in the
 * drawing rather than merely asserted in prose.
 */

const LANE_INK: Readonly<Record<string, string>> = Object.freeze({
  city: "#0e9aa6",
  vehicle: "#2f4bff",
  mission: "#7a4dff",
  route: "#1f8b84",
  service: "#ff7a1a",
  authority: "#ff5a4e",
  bank: "#c1962e",
  network: "#6c7d8c",
  safety: "#d0342c",
  unresolved: "#b8b3a7",
});

export const laneInk = (lane: ProvenanceLane): string => LANE_INK[lane] ?? LANE_INK.unresolved!;

export type VariantCanvasProps = Readonly<{
  layout: VariantLayout;
  graph: CanonicalGraph;
  zone: ComparisonZone;
  /** A receipt the reviewer asked to look at; its chain is lit. */
  selected?: string | null;
  /** Draw the reading number beside each bead. Off for dense analytic views. */
  showOrdinals?: boolean;
  labelOf?: (label: string | undefined) => string | undefined;
  ariaLabel?: string;
}>;

export function VariantCanvas({ layout, graph, zone, selected = null, showOrdinals = true, labelOf = (label) => label, ariaLabel }: VariantCanvasProps) {
  const byId = new Map(graph.receipts.map((entry) => [entry.evidenceId, entry] as const));
  const inZone = new Set(graph.receipts.filter((entry) => zone.focus(entry, graph)).map((entry) => entry.evidenceId));
  const finalInputs = new Set(graph.finalReceipt.causalInputEvidenceIds);

  // The lit chain: ancestors and descendants of the selected receipt, by
  // declared relations only. Nothing here invents a path.
  const lit = new Set<string>();
  if (selected !== null) {
    const parentsOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    for (const edge of graph.edges) {
      childrenOf.set(edge.parent, [...(childrenOf.get(edge.parent) ?? []), edge.child]);
      parentsOf.set(edge.child, [...(parentsOf.get(edge.child) ?? []), edge.parent]);
    }
    lit.add(selected);
    const walk = (step: ReadonlyMap<string, readonly string[]>) => {
      const queue = [selected];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const next of step.get(id) ?? []) if (!lit.has(next)) { lit.add(next); queue.push(next); }
      }
    };
    walk(parentsOf);
    walk(childrenOf);
  }

  return (
    <svg
      className="g2-canvas"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel ?? `${layout.title} — ${zone.title}`}
      data-variant={layout.id}
      data-zone={zone.id}
    >
      <rect x={0} y={0} width={layout.width} height={layout.height} fill="var(--nx-porcelain, #f6f3ec)" />

      {/* SCENERY. Never an evidence colour, never a relation. */}
      <g className="g2-ornaments" aria-hidden="true">
        {layout.ornaments.map((ornament, index) => {
          const key = `${ornament.kind}-${index}`;
          if (ornament.kind === "laneGuide") {
            return (
              <rect
                key={key}
                x={ornament.x ?? 0}
                y={ornament.y ?? 0}
                width={ornament.width ?? 0}
                height={ornament.height ?? 0}
                fill={laneInk(ornament.lane ?? "unresolved")}
                opacity={0.05}
              />
            );
          }
          if (ornament.kind === "laneLabel" || ornament.kind === "axisLabel") {
            return (
              <text
                key={key}
                x={ornament.x ?? 0}
                y={ornament.y ?? 0}
                className={ornament.kind === "laneLabel" ? "g2-lane-label" : "g2-axis-label"}
                fill={ornament.kind === "laneLabel" ? laneInk(ornament.lane ?? "unresolved") : "var(--nx-ink-2, #5b5c62)"}
              >
                {labelOf(ornament.label)}
              </text>
            );
          }
          if (ornament.kind === "gridline") {
            return <path key={key} d={ornament.d ?? ""} stroke="var(--nx-rule, rgba(22,23,27,0.14))" strokeWidth={0.5} fill="none" />;
          }
          if (ornament.kind === "densityField") {
            return (
              <rect
                key={key}
                x={ornament.x ?? 0}
                y={ornament.y ?? 0}
                width={ornament.width ?? 0}
                height={ornament.height ?? 0}
                fill="var(--nx-ink-2, #5b5c62)"
                opacity={Math.min(0.16, (ornament.weight ?? 0) * 0.16)}
              />
            );
          }
          // Streamlines and hulls: graphite, dotted, never a lane hue — so a
          // flow line cannot be read as a thread between two receipts.
          return (
            <path
              key={key}
              d={ornament.d ?? ""}
              fill="none"
              stroke="var(--nx-ink-2, #5b5c62)"
              strokeWidth={0.7}
              strokeDasharray="1 3"
              opacity={Math.min(0.34, 0.12 + (ornament.weight ?? 0) * 0.22)}
            />
          );
        })}
      </g>

      {/* THE EVIDENCE. One path per declared relation, nothing else. */}
      <g className="g2-threads">
        {layout.edges.map((edge) => {
          const focused = inZone.has(edge.parent) || inZone.has(edge.child);
          const isLit = selected !== null && lit.has(edge.parent) && lit.has(edge.child);
          const ink = laneInk(byId.get(edge.child)?.lane ?? "unresolved");
          const dim = selected !== null ? (isLit ? 1 : 0.12) : (focused ? 1 : 0.16);
          return (
            <path
              key={`${edge.kind}:${edge.parent}->${edge.child}`}
              d={edge.d}
              fill="none"
              stroke={ink}
              strokeWidth={edge.crossLane ? 1.15 : 0.8}
              strokeDasharray={edge.kind === "observed" ? "3 2.5" : undefined}
              opacity={dim * (edge.crossLane ? 0.62 : 0.44)}
              data-kind={edge.kind}
              data-cross-lane={edge.crossLane ? "true" : "false"}
            />
          );
        })}
      </g>

      <g className="g2-beads">
        {layout.nodes.map((node) => {
          const receipt = byId.get(node.evidenceId);
          const focused = inZone.has(node.evidenceId);
          const isLit = selected !== null && lit.has(node.evidenceId);
          const isSelected = node.evidenceId === selected;
          const dim = selected !== null ? (isLit ? 1 : 0.16) : (focused ? 1 : 0.22);
          const ink = laneInk(node.lane);
          const radius = isSelected ? 6.2 : focused ? 4.6 : 3.6;
          return (
            <g key={node.evidenceId} opacity={dim} data-receipt={node.evidenceId} data-ordinal={receipt?.ordinal.compact}>
              {isSelected ? <circle cx={node.x} cy={node.y} r={radius + 4} fill="none" stroke={ink} strokeWidth={1.1} opacity={0.5} /> : null}
              {zone.highlightFinal && !finalInputs.has(node.evidenceId)
                // A sealed receipt the Final Receipt does not name as an input:
                // hollow, so the exception is visible rather than asserted.
                ? <circle cx={node.x} cy={node.y} r={radius} fill="var(--nx-paper, #fffdf9)" stroke={ink} strokeWidth={1.6} />
                : <circle cx={node.x} cy={node.y} r={radius} fill={ink} />}
              {showOrdinals && (focused || isSelected) ? (
                <text x={node.x + radius + 2.5} y={node.y + 2.6} className="g2-ordinal" fill="var(--nx-ink-2, #5b5c62)">
                  {receipt?.ordinal.compact}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
