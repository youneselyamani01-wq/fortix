import type { Metadata } from "next";

import "../nx.css";
import "./gate2.css";
import { canonicalGraph } from "./canonicalGraph.ts";
import { VariantCanvas, laneInk } from "./VariantCanvas.tsx";
import { COMPARISON_ZONES, type ZoneId } from "./zones.ts";
import { buildVariantA } from "./variantA.ts";
import { buildVariantB1, buildVariantB2 } from "./variantB.ts";
import { buildVariantC } from "./variantC.ts";
import { buildVariantD1, buildVariantD2 } from "./variantD12.ts";
import { buildVariantD3, buildVariantD4 } from "./variantD34.ts";
import type { VariantBuilder, VariantId } from "./variantTypes.ts";

/**
 * D-006/NX GATE 2 — THE COMPARISON BENCH, at /nx/gate2.
 *
 * This route is EXPLORATORY. It exists so a human can look at the same evidence
 * drawn eight ways and say which one they can read. It does not touch the
 * production experience at /nx, and Gate 2 grants no authority to replace it
 * (§20): nothing here is wired into the demo or the verifier.
 *
 * Everything is server-rendered from search parameters, with no client state,
 * for one specific reason: a capture must be reproducible. `?variant=B2&zone=1`
 * is the whole truth about what a screenshot shows, so a reviewer can regenerate
 * any image in this study from its filename.
 */

export const metadata: Metadata = {
  title: { absolute: "FortiX · D-006/NX Gate 2 — representation bench" },
  description: "Eight representations of one canonical evidence graph, for comparison. Exploratory; not the production experience.",
};

const BUILDERS: readonly (readonly [VariantId, VariantBuilder])[] = Object.freeze([
  ["A", buildVariantA],
  ["B1", buildVariantB1],
  ["B2", buildVariantB2],
  ["C", buildVariantC],
  ["D1", buildVariantD1],
  ["D2", buildVariantD2],
  ["D3", buildVariantD3],
  ["D4", buildVariantD4],
]);

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
const one = (params: SearchParams | undefined, key: string) => {
  const raw = params?.[key];
  return Array.isArray(raw) ? raw[0] : raw;
};

const ZONE_BY_NUMBER: Readonly<Record<string, ZoneId>> = Object.freeze({
  "1": "zone1-parallelism",
  "2": "zone2-boundaries",
  "3": "zone3-convergence",
});

export default async function Gate2Page({ searchParams }: { searchParams?: Promise<SearchParams> | SearchParams }) {
  const params = searchParams === undefined ? undefined : await searchParams;
  const graph = canonicalGraph();

  const zoneKey = one(params, "zone") ?? "1";
  const zone = COMPARISON_ZONES.find((entry) => entry.id === (ZONE_BY_NUMBER[zoneKey] ?? zoneKey)) ?? COMPARISON_ZONES[0]!;
  const wanted = one(params, "variant");
  const selected = one(params, "select") ?? null;
  const french = one(params, "lang") === "fr";
  const solo = wanted !== undefined && wanted !== "all" ? BUILDERS.filter(([id]) => id === wanted) : BUILDERS;
  const wide = solo.length === 1;

  const width = wide ? 1280 : 620;
  const height = wide ? 620 : 340;

  const laneLegend = graph.lanes.map((lane) => ({ lane, ink: laneInk(lane) }));

  return (
    <main className="nx g2">
      <header className="g2-head">
        <div>
          <p className="g2-kicker">D-006/NX · GATE 2 · {french ? "banc de comparaison" : "representation bench"}</p>
          <h1>{french ? zone.titleFr : zone.title}</h1>
          <p className="g2-question">{french ? zone.questionFr : zone.question}</p>
        </div>
        <dl className="g2-invariant">
          <div><dt>{french ? "reçus" : "receipts"}</dt><dd>{graph.receipts.length}</dd></div>
          <div><dt>{french ? "relations" : "relations"}</dt><dd>{graph.edges.length}</dd></div>
          <div><dt>{french ? "empreinte" : "digest"}</dt><dd><code>{graph.digest.slice(0, 12)}…</code></dd></div>
        </dl>
      </header>

      <nav className="g2-nav" aria-label={french ? "vues" : "views"}>
        <span className="g2-nav-label">{french ? "zone" : "zone"}</span>
        {Object.entries(ZONE_BY_NUMBER).map(([number, id]) => (
          <a key={id} href={`?zone=${number}${wanted === undefined ? "" : `&variant=${wanted}`}${french ? "&lang=fr" : ""}`} aria-current={zone.id === id ? "page" : undefined}>{number}</a>
        ))}
        <i />
        <span className="g2-nav-label">{french ? "variante" : "variant"}</span>
        <a href={`?zone=${zoneKey}&variant=all${french ? "&lang=fr" : ""}`} aria-current={wide ? undefined : "page"}>{french ? "toutes" : "all"}</a>
        {BUILDERS.map(([id]) => (
          <a key={id} href={`?zone=${zoneKey}&variant=${id}${french ? "&lang=fr" : ""}`} aria-current={wide && solo[0]![0] === id ? "page" : undefined}>{id}</a>
        ))}
      </nav>

      <ul className="g2-legend" aria-label={french ? "provenance" : "provenance"}>
        {laneLegend.map(({ lane, ink }) => (
          <li key={lane}><span style={{ background: ink }} aria-hidden="true" />{lane}</li>
        ))}
        <li className="g2-legend-rule"><svg width="26" height="8" aria-hidden="true"><path d="M 1 4 L 25 4" stroke="var(--nx-ink-2)" strokeWidth="1.2" fill="none" /></svg>{french ? "cause" : "cause"}</li>
        <li className="g2-legend-rule"><svg width="26" height="8" aria-hidden="true"><path d="M 1 4 L 25 4" stroke="var(--nx-ink-2)" strokeWidth="1.2" strokeDasharray="3 2.5" fill="none" /></svg>{french ? "observé" : "observed"}</li>
      </ul>

      <div className={wide ? "g2-grid g2-grid-solo" : "g2-grid"}>
        {solo.map(([id, build]) => {
          const layout = build({ graph, width, height });
          return (
            <figure key={id} className="g2-cell" data-variant={id}>
              <figcaption>
                <strong>{id}</strong> {layout.title}
                <span>x — {layout.axes.x} · y — {layout.axes.y}</span>
              </figcaption>
              <VariantCanvas layout={layout} graph={graph} zone={zone} selected={selected} showOrdinals={wide} />
              {wide ? (
                <div className="g2-detail">
                  <section>
                    <h2>{french ? "diagnostics" : "diagnostics"}</h2>
                    <dl>
                      {Object.entries(layout.diagnostics).map(([key, value]) => (
                        <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.map((v) => (typeof v === "number" ? v.toFixed(4) : String(v))).join(", ") : String(value)}</dd></div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h2>{french ? "limites d'interprétation" : "interpretation limits"}</h2>
                    <ul>{layout.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
                  </section>
                </div>
              ) : null}
            </figure>
          );
        })}
      </div>

      <footer className="g2-foot">
        <p>
          {french
            ? "Banc exploratoire. Toutes les variantes lisent le même graphe canonique gelé ; aucune ne peut ajouter, retirer ou fusionner une relation. La proximité n'est pas une causalité."
            : "Exploratory bench. Every variant reads the same frozen canonical graph; none can add, drop or merge a relation. Proximity is not causality."}
        </p>
      </footer>
    </main>
  );
}
