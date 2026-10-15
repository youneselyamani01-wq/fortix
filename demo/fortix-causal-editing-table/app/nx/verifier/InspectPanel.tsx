"use client";

import { useMemo, useState } from "react";
import { useI18n } from "../../I18nProvider";
import { inspectionLabel } from "./inspectionLabels.ts";

import type { PublicVerification } from "../adapter/publicExperienceAdapter.ts";
import { compareForReading } from "../adapter/readingOrder.ts";
import { canonicalGraph, type CanonicalGraph, type CanonicalReceipt } from "../gate2/canonicalGraph.ts";
import { VariantCanvas } from "../gate2/VariantCanvas.tsx";
import { buildVariantB2 } from "../gate2/variantB.ts";
import { buildVariantC } from "../gate2/variantC.ts";
import { buildVariantD4 } from "../gate2/variantD34.ts";
import { zoneById } from "../gate2/zones.ts";
import type { VariantLayout } from "../gate2/variantTypes.ts";
import { categoriesOf, type CheckCategory } from "./choreography.ts";
import { INSPECT_SECTIONS, type InspectSection } from "./inspectSections.ts";

/**
 * D-006/NX3 — INSPECT: the verdict's supporting material, opened after the
 * verdict and never before it.
 *
 * WHAT THIS IS. Six read-only sections beneath the verdict: the evidence path
 * of one receipt, the causal graph, the structural projection, the evidence
 * flow, the receipt register and the verifier's trust record. The three
 * drawings are the Gate 2 layouts, rendered by the Gate 2 renderer — reused,
 * not reimplemented, so this surface cannot draw a relation the canonical
 * graph does not declare. The path and the register read the same canonical
 * graph. The trust record reads `model.verification` and nothing else.
 *
 * WHAT THIS IS NOT. Not an input to the verdict. Nothing here can call an
 * engine act, and nothing here is read by the verifier: the verdict was
 * produced before this panel could exist, and inspecting it changes nothing.
 *
 * THE ORDINAL IS A LABEL. `NR 33` is printed beside every identifier because a
 * person needs a handle to speak with; no ordering, position or relation in
 * this panel derives from it. Lists are ordered by the canonical reading rule
 * (evidence time, then admission order), which is the rule the ordinal itself
 * was derived from — so the two agree without one reading the other.
 */

export type { CheckCategory } from "./choreography.ts";

export type InspectCopy = Readonly<{
  aria: string;
  sections: Readonly<Record<InspectSection, string>>;
  categories: Readonly<Record<CheckCategory, string>>;
  similarityNotCausality: string;
  flowNotAuthority: string;
  /** `{ancestors} before, {descendants} after` — the path's summary line. */
  chain: string;
  readingNumber: string;
  identifier: string;
  notRetained: string;
  identity: string;
  profile: string;
  key: string;
  trustAnchor: string;
  scope: string;
  transport: string;
  noNetworkRequired: string;
  verdict: string;
  checks: string;
  reasons: string;
  transferred: string;
  checkLabels: Readonly<Record<string, string>>;
  none: string;
}>;

/** The drawings share one frame so the three views are comparable at a glance. */
const CANVAS_WIDTH = 1120;
const CANVAS_HEIGHT = 500;

type EvidencePath = Readonly<{ ancestors: readonly CanonicalReceipt[]; descendants: readonly CanonicalReceipt[] }>;

/**
 * Ancestors and descendants of one receipt, by the graph's declared edges
 * only, each side in canonical reading order. The same walk the Gate 2
 * renderer performs to light a chain, restated over receipts rather than ids.
 */
function evidencePath(graph: CanonicalGraph, selected: string): EvidencePath {
  const byId = new Map(graph.receipts.map((entry) => [entry.evidenceId, entry] as const));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const edge of graph.edges) {
    childrenOf.set(edge.parent, [...(childrenOf.get(edge.parent) ?? []), edge.child]);
    parentsOf.set(edge.child, [...(parentsOf.get(edge.child) ?? []), edge.parent]);
  }
  const walk = (step: ReadonlyMap<string, readonly string[]>): readonly CanonicalReceipt[] => {
    const seen = new Set<string>([selected]);
    const queue = [selected];
    const out: CanonicalReceipt[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of step.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
        const receipt = byId.get(next);
        if (receipt !== undefined) out.push(receipt);
      }
    }
    return out.sort(compareForReading);
  };
  return { ancestors: walk(parentsOf), descendants: walk(childrenOf) };
}

function ReceiptRow({ receipt, part, current, notRetained, onSelect }: {
  receipt: CanonicalReceipt;
  /** The row's part in its list — a data attribute for the reading, never an ARIA role. */
  part: "ancestor" | "selected" | "descendant" | "register";
  current: boolean;
  notRetained: string;
  onSelect: (evidenceId: string) => void;
}) {
  const quarantined = receipt.assurance === "QUARANTINED";
  return (
    <li>
      <button
        type="button"
        className="nx-vs-row"
        data-receipt={receipt.evidenceId}
        data-role={part}
        data-assurance={receipt.assurance}
        aria-current={current ? "true" : undefined}
        onClick={() => onSelect(receipt.evidenceId)}
      >
        <b className="nx-ordinal">{receipt.ordinal.label}</b>
        <code>{receipt.evidenceId}</code>
        {quarantined && <small>{notRetained}</small>}
      </button>
    </li>
  );
}

export function InspectPanel({ section, verification, transferredContentDigest, copy, onSection }: {
  section: InspectSection;
  verification: PublicVerification;
  transferredContentDigest: string | null;
  copy: InspectCopy;
  onSection: (section: InspectSection) => void;
}) {
  const { locale } = useI18n();
  const graph = useMemo(() => canonicalGraph(), []);
  // The register, in canonical reading order — by the rule, never by the label.
  const register = useMemo(() => [...graph.receipts].sort(compareForReading), [graph]);
  const [selected, setSelected] = useState<string>(() => graph.finalReceipt.causalInputEvidenceIds[0] ?? graph.receipts[0]!.evidenceId);
  const selectedReceipt = graph.receipts.find((entry) => entry.evidenceId === selected) ?? null;
  const path = useMemo(() => evidencePath(graph, selected), [graph, selected]);
  const layout = useMemo<VariantLayout | null>(() => {
    const input = { graph, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
    if (section === "graph") return buildVariantB2(input);
    if (section === "structure") return buildVariantC(input);
    if (section === "flow") return buildVariantD4(input);
    return null;
  }, [graph, section]);
  const zone = zoneById("zone3-convergence");
  // The same grouping the surface reveals in cadence — one table, read twice.
  const checksByCategory: readonly Readonly<{ category: CheckCategory; checks: readonly string[] }>[] = categoriesOf(verification.completedChecks);
  const chainLine = copy.chain.replace("{ancestors}", String(path.ancestors.length)).replace("{descendants}", String(path.descendants.length));

  return (
    <div className="nx-vs-inspect" id="nx-vs-inspect" data-section={section} aria-label={copy.aria}>
      <div className="nx-vs-tabs" role="tablist" aria-label={copy.aria}>
        {INSPECT_SECTIONS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`nx-vs-tab-${entry}`}
            aria-selected={entry === section}
            aria-controls="nx-vs-section"
            data-section={entry}
            onClick={() => onSection(entry)}
          >
            {copy.sections[entry]}
          </button>
        ))}
      </div>

      <div className="nx-vs-section" id="nx-vs-section" role="tabpanel" aria-labelledby={`nx-vs-tab-${section}`} data-section={section}>
        {section === "path" && selectedReceipt !== null && (
          <div className="nx-vs-path">
            <p className="nx-vs-path-line">
              <b className="nx-ordinal">{selectedReceipt.ordinal.label}</b>
              <code>{selectedReceipt.evidenceId}</code>
              <span>{chainLine}</span>
            </p>
            {/* One ordered list: what came before, the receipt itself, what followed —
                each side in reading order, from declared edges alone. */}
            <ol>
              {path.ancestors.map((entry) => <ReceiptRow key={entry.evidenceId} receipt={entry} part="ancestor" current={false} notRetained={copy.notRetained} onSelect={setSelected} />)}
              <ReceiptRow receipt={selectedReceipt} part="selected" current notRetained={copy.notRetained} onSelect={setSelected} />
              {path.descendants.map((entry) => <ReceiptRow key={entry.evidenceId} receipt={entry} part="descendant" current={false} notRetained={copy.notRetained} onSelect={setSelected} />)}
            </ol>
          </div>
        )}

        {layout !== null && (
          <div className="nx-vs-drawing" data-variant={layout.id}>
            {section === "structure" && <p className="nx-vs-caveat">{copy.similarityNotCausality}</p>}
            {section === "flow" && <p className="nx-vs-caveat">{copy.flowNotAuthority}</p>}
            <div className="nx-vs-canvas">
              <VariantCanvas layout={layout} graph={graph} zone={zone} selected={selected} showOrdinals labelOf={(label) => inspectionLabel(label, locale)} ariaLabel={copy.sections[section]} />
            </div>
          </div>
        )}

        {section === "receipts" && (
          <div className="nx-vs-receipts">
            <p className="nx-vs-receipts-head" aria-hidden="true"><span>{copy.readingNumber}</span><span>{copy.identifier}</span></p>
            <ol>
              {register.map((entry) => <ReceiptRow key={entry.evidenceId} receipt={entry} part="register" current={entry.evidenceId === selected} notRetained={copy.notRetained} onSelect={setSelected} />)}
            </ol>
          </div>
        )}

        {section === "trust" && (
          <div className="nx-vs-trust nx-technical">
            <h4>{copy.identity}</h4>
            <dl>
              <div><dt>{copy.profile}</dt><dd><code>{verification.identity.profile}</code></dd></div>
              <div><dt>{copy.key}</dt><dd><code>{verification.identity.pinnedKeyId ?? copy.none}</code></dd></div>
              <div><dt>{copy.trustAnchor}</dt><dd><code>{verification.identity.trustAnchorId ?? copy.none}</code></dd></div>
              <div><dt>{copy.scope}</dt><dd><code>{verification.identity.scopeMissionId}{verification.identity.scopeRunId === null ? "" : ` · ${verification.identity.scopeRunId}`}</code></dd></div>
              <div><dt>{copy.transport}</dt><dd>{copy.noNetworkRequired}</dd></div>
              <div><dt>{copy.verdict}</dt><dd><code data-verdict={verification.verdict ?? ""}>{verification.verdict ?? copy.none}</code></dd></div>
              <div><dt>{copy.transferred}</dt><dd><code>{transferredContentDigest ?? copy.none}</code></dd></div>
              <div>
                <dt>{copy.reasons}</dt>
                <dd>{verification.reasonCodes.length === 0 ? copy.none : (
                  <ul>{verification.reasonCodes.map((code) => <li key={code} data-reason-code={code}><code>{code}</code></li>)}</ul>
                )}</dd>
              </div>
            </dl>
            <h4>{copy.checks}</h4>
            {checksByCategory.length === 0 ? <p className="nx-panel-note">{copy.none}</p> : (
              <dl>
                {checksByCategory.map((group) => (
                  <div key={group.category} data-category={group.category}>
                    <dt>{copy.categories[group.category]}</dt>
                    <dd>
                      <ul>{group.checks.map((check) => <li key={check} data-check-id={check}>{copy.checkLabels[check] ?? check}</li>)}</ul>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
