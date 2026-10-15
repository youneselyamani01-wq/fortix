import assert from "node:assert/strict";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";


const LOCALES = Object.freeze({ en, fr });

async function render(locale = "en", path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${locale}-${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: {
        accept: "text/html",
        "accept-language": locale === "fr"
          ? "fr-FR,fr;q=0.9,en;q=0.5"
          : "en-GB,en;q=0.9,fr;q=0.5",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function rendered(locale, path = "/") {
  const response = await render(locale, path);
  assert.equal(response.status, 200, `${locale} SSR status`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

function assertIncludes(html, values, locale) {
  for (const value of values) {
    assert.ok(html.includes(value), `${locale} SSR is missing localized copy: ${value}`);
  }
}

function primaryBands(html) {
  return html.match(/data-band="(?:reality|system|proof)"/g) ?? [];
}

test("server-renders the C2 public experience in English", async () => {
  const html = await rendered("en");
  const copy = LOCALES.en.d006c2;

  assert.match(html, /<html[^>]*lang="en"/i);
  assert.ok(html.includes(`<title>FortiX · ${copy.brandSubtitle}</title>`));
  assert.match(
    html,
    /property="og:image" content="http:\/\/localhost\/og(?:-bud)?\.png"/i,
  );
  assertIncludes(html, [
    copy.brandSubtitle,
    copy.heroQuestion,
    copy.heroAnswer,
    copy.heroIntro,
    copy.callTaxi,
    ...copy.journey,
    copy.bands.happened,
    copy.bands.evidence,
    copy.verifier.title,
    copy.verifier.heading,
    copy.verifier.identitySummary,
    copy.verifier.insert,
    copy.proof.flowerAria,
  ], "EN");

  // C3-R1: dark mode is removed; the only segmented control is EN | FR.
  assert.doesNotMatch(html, /data-verifier-theme|verifier-theme-control|>DARK<|>SOMBRE</);
  assert.match(html, /aria-pressed="true"[^>]*>EN<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>FR<\/button>/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|EUDI/i);
  assert.doesNotMatch(html, /Que s’est-il passé|Appeler un taxi|VÉRIFICATEUR INDÉPENDANT/);
});

test("server-renders the complete active C2 experience in French", async () => {
  const html = await rendered("fr");
  const copy = LOCALES.fr.d006c2;

  assert.match(html, /<html[^>]*lang="fr"/i);
  assert.ok(html.includes(`<title>FortiX · ${copy.brandSubtitle}</title>`));
  assertIncludes(html, [
    copy.brandSubtitle,
    copy.heroQuestion,
    copy.heroAnswer,
    copy.heroIntro,
    copy.callTaxi,
    ...copy.journey,
    copy.bands.happened,
    copy.bands.evidence,
    copy.verifier.title,
    copy.verifier.heading,
    copy.verifier.identitySummary,
    copy.verifier.insert,
    copy.proof.flowerAria,
  ], "FR");

  // C3-R1: dark mode is removed; the language mode reflects the active locale.
  assert.doesNotMatch(html, /data-verifier-theme|verifier-theme-control|>DARK<|>SOMBRE</);
  assert.match(html, /aria-pressed="false"[^>]*>EN<\/button>/);
  assert.match(html, /aria-pressed="true"[^>]*>FR<\/button>/);
  assert.doesNotMatch(html, /What happened\?|Call a taxi|INDEPENDENT VERIFIER|INSERT EVIDENCE/);
});

test("EN and FR SSR preserve exactly the same two C1 truth bands", async () => {
  for (const locale of ["en", "fr"]) {
    const html = await rendered(locale);
    assert.deepEqual(primaryBands(html), [
      'data-band="reality"',
      'data-band="proof"',
    ], `${locale} must preserve Reality then Proof without a synthetic system band`);
    assert.doesNotMatch(html, /data-band="system"/);

    const copy = LOCALES[locale].d006c2;
    const realityIndex = html.indexOf('data-band="reality"');
    const proofIndex = html.indexOf('data-band="proof"');
    assert.ok(realityIndex >= 0 && proofIndex > realityIndex, `${locale} causal band order changed`);
    assert.ok(
      html.indexOf(copy.bands.happened, realityIndex) < proofIndex,
      `${locale} Reality band lost its public HAPPENED/FAITS label`,
    );
    assert.ok(
      html.indexOf(copy.bands.evidence, proofIndex) > proofIndex,
      `${locale} Proof band lost its public EVIDENCE/PREUVES label`,
    );
  }
});

// ---------------------------------------------------------------------------
// D-006 NX1 — the blank-slate public experience at /nx (Checkpoint A)
// ---------------------------------------------------------------------------

test("NX1: /nx server-renders the public hierarchy — world, fact, evidence, then technical depth", async () => {
  for (const locale of ["en", "fr"]) {
    const html = await rendered(locale, "/nx");
    const copy = LOCALES[locale].nx;
    assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`, "i"));
    assert.ok(html.includes(`<title>FortiX · ${copy.title}</title>`), `${locale} title`);
    assertIncludes(html, [copy.start, copy.missionTime, "0 NanoReceipts (NR)", copy.ready, copy.kicker], locale.toUpperCase());

    const world = html.indexOf('class="nx-world"');
    const fact = html.indexOf('class="nx-fact');
    const evidence = html.indexOf('class="nx-mission-evidence"');
    const controls = html.indexOf('class="nx-controls"');
    assert.ok(world >= 0 && fact > world && evidence > fact && controls > evidence);
    assert.equal((html.slice(world).match(/<h1[\s>]/g) ?? []).length, 1);
    assert.doesNotMatch(html, /class="nx-panel nx-dossier"|nx-dossier-body|class="nx-workspace"|class="nx-proof"|nx-demo-inspection|class="nx-verifier-surface"/);
    assert.doesNotMatch(html, /class="nx-peb-chip|class="nx-compact-handoff"/);
    assert.match(html, /data-handoff="NOT_READY"/);
    assert.match(html, /data-workspace="compact"/);
    // The server has no sentinel: the chip shows that, and nothing pretends to
    // be connected or lost. The state is drawn, not written.
    const linkChip = html.match(/<span class="nx-link-chip"[^>]*>[\s\S]*?<\/span>/)?.[0];
    assert.ok(linkChip, `${locale}: the observed-link indicator exists`);
    assert.match(linkChip, /class="nx-link-chip" data-link="UNKNOWN"/, `${locale}: the link is unknown until observed`);
    assert.match(linkChip, /class="nx-link-chip"[^>]*aria-label="[^"]*"[^>]*><i aria-hidden="true"><b><\/b><b><\/b><b><\/b><b><\/b><\/i><\/span>/, `${locale}: four bars and no visible words`);
    assert.ok(
      linkChip.includes(`${copy.link.title} · ${copy.link.unobserved}`),
      `${locale}: the accessible name still states the observed link state`,
    );
    assert.doesNotMatch(linkChip, /Ethernet|RJ45|Wi-Fi/i, `${locale}: the indicator names no transport`);
    assert.match(html, /data-network-state="UNKNOWN"/);
    assert.match(html, /data-evidence-locality="LOCAL"/);
    assert.match(html, /data-network-receipts="0 0 0"/, `${locale}: no physical receipt was minted by rendering`);
    assert.doesNotMatch(html, /data-network-state="(LOST|CONNECTED|RESTORED)"/);
    assert.doesNotMatch(html, /proof-tree-canvas|data-verifier-theme|verifier-theme-control|>DARK<|>SOMBRE</);
    assert.equal((html.match(/data-band="/g) ?? []).length, 0, `${locale}: no legacy dashboard bands`);
    assert.match(html, new RegExp(`aria-pressed="${locale === "en" ? "true" : "false"}"[^>]*>EN</button>`));
    assert.match(html, new RegExp(`aria-pressed="${locale === "fr" ? "true" : "false"}"[^>]*>FR</button>`));
    assert.match(html, /data-evidence-count="0"/, `${locale}: nothing has happened at time 0`);
    assert.match(html, /data-nx-checkpoint="B-R2"/);
  }
  const en = await rendered("en", "/nx");
  const fr = await rendered("fr", "/nx");
  assert.doesNotMatch(en, /Démarrer la mission|Preuves créées/);
  assert.doesNotMatch(fr, /Start the mission|Evidence created/);
});

test("NX1: a review deep link opens the Physical-AI moment with the world leading and the evidence following", async () => {
  // 12.0 s: the taxi has just applied its brakes on its own decision — the
  // canonical instant of the brake receipt itself.
  const braking = await rendered("en", "/nx?t=12000");
  assert.match(braking, /data-current-fact="fact.road.braked"/);
  assert.match(braking, /data-brake-lights="on"/);
  assert.match(braking, /data-taxi-motion="BRAKING_ON_OWN_DECISION"/);
  // C-R1: at its own instant the brake receipt has been RECORDED — the world
  // shows the braking and the sentence says so — but the receipt in front of it
  // has only just finished being read, so it is waiting its turn in the
  // presentation queue. The world leads and the evidence follows, now literally.
  assert.match(braking, /data-receipts-queued="1"/, "the brake receipt is admitted and waiting");
  assert.match(braking, /data-receipts-arriving="0"/, "nothing is crossing the screen");
  assert.match(braking, /data-owning-receipt="NR-DECISION:stop"/, "the decision that caused it is the one being read");
  assert.doesNotMatch(braking, /data-evidence-id="NR-ACTION:brake"/, "nothing half-arrived is drawn for it");
  assert.ok(braking.includes(LOCALES.en.d006c3.facts.statements["fact.road.braked"]));
  const worldIndex = braking.indexOf('class="nx-world"');
  const factIndex = braking.indexOf(LOCALES.en.d006c3.facts.statements["fact.road.braked"]);
  assert.ok(worldIndex >= 0 && factIndex > worldIndex, "the world precedes the sentence about it");

  // 12.75 s: a receipt is crossing to the band, and it is the only thing
  // crossing. One receipt travels at a time.
  const departing = await rendered("en", "/nx?t=12750");
  assert.match(departing, /data-receipts-arriving="1"/, "exactly one receipt is in flight");
  assert.match(departing, /data-latest-evidence-phase="IN_FLIGHT"/, "it has left the taxi and not yet landed");

  // 12.5 s: the brake receipt has landed and is the one — the only one — the
  // viewer is being asked to read, named by its stable human handle.
  const reading = await rendered("en", "/nx?t=12500");
  assert.match(reading, /data-owning-receipt="NR-ACTION:brake"/);
  assert.match(reading, /data-owning-ordinal="NR 11"/, "with its stable human handle");
  assert.match(reading, /data-receipts-arriving="0"/, "and nothing else crossing the screen at the same time");

  // 14.3 s: the taxi stands still before the line; its stop receipt has
  // landed (13 s + the 1.2 s flight) and is materialising as a tile.
  const stopped = await rendered("fr", "/nx?t=14300");
  assert.match(stopped, /data-current-fact="fact.road.stopped"/);
  assert.match(stopped, /data-taxi-motion="STOPPED_AT_LINE"/);
  assert.ok(stopped.includes(LOCALES.fr.d006c3.facts.statements["fact.road.stopped"]));
  assert.match(stopped, /class="nx-evidence-progress" data-nr-count="\d+"/);
  assert.match(stopped, /data-provenance-branches="city vehicle mission route"/, "four provenance branches are fed by 14.3 s: the city, the taxi, the mission and the pickup route");
  assert.doesNotMatch(stopped.slice(stopped.indexOf('class="nx-proof"'), stopped.indexOf('class="nx-controls"')), /NR-RESULT:at-rest<|00:1\d\.\d{3}/, "no identifier or timestamp on the public proof");

  // B R2 §22: a selected receipt lights its chain at full band height; no panel opens by itself.
  const selectedOnly = await rendered("fr", "/nx?t=14300&select=NR-ACTION:brake");
  assert.match(selectedOnly, /data-workspace="compact"/, "selecting opens nothing");
  assert.match(selectedOnly, /data-selection=""/);
  assert.doesNotMatch(selectedOnly, /class="nx-proof"|class="nx-bead|nx-dossier-body/);

  // 48.5 s: emergency braking short of the queue — the NX0 closure, on stage.
  const hazard = await rendered("en", "/nx?t=48500");
  assert.match(hazard, /data-brake-lights="on"/);
  assert.match(hazard, /data-current-fact="fact.route.congestion"/);
  assert.doesNotMatch(hazard, /class="nx-proof"|nx-dossier-body/);

  // C-R1 §7 — THE SAME-INSTANT PAIR, on stage. Two nano-receipts of this run
  // are recorded at the very same canonical instant, 48.000 s: the ETA result
  // and the hazard braking action. Checkpoint C put both on screen in one
  // frame. Followed through four deep links, they now arrive one at a time,
  // and the mission clock still reads the one instant for both.
  const bothQueued = await rendered("en", "/nx?t=48000");
  assert.match(bothQueued, /data-receipts-queued="2"/, "at the instant itself both are recorded and both are waiting");
  assert.match(bothQueued, /data-owning-receipt="NR-DECISION:hazard-stop"/, "the receipt before them is still being read");
  assert.doesNotMatch(bothQueued, /data-evidence-id="NR-ACTION:hazard-brake"/);
  assert.match(hazard, /data-receipts-arriving="1"/, "half a second later the FIRST of the pair is crossing, alone");
  assert.match(hazard, /data-receipts-queued="1"/, "and the second is still waiting its turn");
  // C-R2-F07 — THE TRADE, on stage. A quarter second earlier the first of the
  // pair is ALREADY crossing while NR 26 is still the one being read. C-R1
  // forbade that and spent 30 seconds of the run on the prohibition; what it
  // was protecting — never two receipts asking to be read at once — is intact.
  const overlap = await rendered("en", "/nx?t=48250");
  assert.match(overlap, /data-owning-ordinal="NR 26"/, "one receipt is being read");
  assert.match(overlap, /data-receipts-arriving="1"/, "while the next is already crossing");
  assert.match(overlap, /data-receipts-queued="1"/);
  const firstRead = await rendered("en", "/nx?t=49000");
  assert.match(firstRead, /data-owning-ordinal="NR 27"/, "the first of the pair owns the screen by itself");
  assert.match(firstRead, /data-receipts-queued="1"/);
  assert.doesNotMatch(firstRead, /data-evidence-id="NR-ACTION:hazard-brake"/, "the second is drawn nowhere while the first is read");
  const secondFlying = await rendered("en", "/nx?t=49500");
  assert.match(secondFlying, /data-latest-evidence="NR-ACTION:hazard-brake"/, "only then does the second one leave");
  assert.match(secondFlying, /data-latest-evidence-phase="IN_FLIGHT"/);
  assert.match(secondFlying, /data-receipts-arriving="1"/, "and it crosses alone too");
  assert.match(secondFlying, /data-receipts-queued="0"/);
  const landed = await rendered("en", "/nx?t=50000");
  assert.match(landed, /data-owning-receipt="NR-ACTION:hazard-brake"/, "the engine retains its original progression");
  assert.match(landed, /data-owning-ordinal="NR 28"/, "and is read by itself");

  // The authority boundary: a deep link cannot pass it without a decision,
  // and the decision is offered to the person, as ALLOW / DENY.
  const boundary = await rendered("en", "/nx?t=100000");
  assert.match(boundary, /data-mission-phase="HOLDING_FOR_AUTHORITY"/);
  assert.match(boundary, /data-master-time="84250"/);
  assert.match(boundary, /class="nx-controls" data-authority="required"/);
  assert.ok(boundary.includes(LOCALES.en.d006c2.authority.allow) && boundary.includes(LOCALES.en.d006c2.authority.deny));
});

test("NX1: every moment of the timeline server-renders without error", async () => {
  for (let at = 0; at <= 84_250; at += 3_000) {
    const html = await rendered(at % 6_000 === 0 ? "en" : "fr", `/nx?t=${at}`);
    assert.match(html, /data-nx-checkpoint="B-R2"/, `t=${at}`);
    assert.doesNotMatch(html, /Application error|Internal Server Error/i, `t=${at}`);
  }
  // With the reviewer's decision declared, the post-authority timeline renders too.
  for (let at = 87_000; at <= 126_000; at += 3_000) {
    const html = await rendered(at % 6_000 === 0 ? "en" : "fr", `/nx?t=${at}&decision=approved`);
    assert.match(html, /data-nx-checkpoint="B-R2"/, `t=${at}`);
    assert.doesNotMatch(html, /Application error|Internal Server Error/i, `t=${at}`);
  }
});

test("FS-R2: legacy drawer and graph deep links cannot remount retired Demo inspection", async () => {
  for (const query of ["dossier=open", "episode=signalStop", "receipt=NR-ACTION:brake", "branch=city", "inspect=graph", "object=peb"]) {
    for (const locale of ["en", "fr"]) {
      const html = await rendered(locale, `/nx?t=14300&${query}`);
      assert.match(html, /data-workspace="compact"/);
      assert.match(html, /class="nx-mission-evidence"/);
      assert.doesNotMatch(html, /nx-dossier-body|class="nx-panel nx-dossier"|class="nx-demo-inspection"|class="nx-proof"/);
    }
  }
});

test("FS-R2: 58 admitted receipts and one distinct Final Receipt remain behind a compact PEB control", async () => {
  for (const locale of ["en", "fr"]) {
    const html = await rendered(locale, "/nx?t=126000&decision=approved&dossier=open&object=peb");
    assert.match(html, /data-mission-phase="COMPLETE"/);
    assert.match(html, /data-evidence-count="58"/);
    assert.match(html, /data-final-receipt="fortix:receipt:blake3:[0-9a-f]{64}"/);
    assert.match(html, /data-provenance-branches="city vehicle mission route service authority bank"/);
    assert.match(html, /data-unresolved-provenance="0"/);
    assert.match(html, /data-sealed-count="58"/);
    assert.match(html, /data-journal-count="0"/);
    assert.match(html, /data-handoff="READY"/);
    assert.match(html, /data-verification-state="NOT_APPLICABLE"/);
    assert.match(html, /class="nx-peb-chip is-takeable"[^>]*data-peb-state="READY"/);
    assert.doesNotMatch(html, /nx-dossier-body|nx-peb-record|nx-final-record|class="nx-proof"/);
  }
});

test("NX1 R3: the handoff and the analysis are two separate acts, and the verifier's result is never rendered by the server", async () => {
  const handed = await rendered("fr", "/nx?t=126000&handoff=done&verifier=open");
  assert.match(handed, /data-workspace="compact"/);
  assert.match(handed, /data-handoff="HANDED_OVER"/);
  assert.match(handed, /data-verification-state="AWAITING_HUMAN"/, "received, not analyzed: the second act is the reviewer's");
  // NX3: the open verifier is the dedicated surface, not a panel.
  assert.match(handed, /class="nx-compact-handoff"/);
  assert.doesNotMatch(handed, /class="nx-verifier-surface"|class="verifier-result"/);
  assert.match(handed, /href="\/verify" target="_blank" rel="noopener noreferrer"/, "verifier navigation opens separately");
  assert.doesNotMatch(handed, /class="nx-vs-analyze-act"/, "the Demo does not embed the independent Analyze surface");
  assert.match(handed, /data-peb="RECEIVED"/);
  assert.match(handed, /class="nx-peb-delivered"/, "a compact received status remains");
  assert.doesNotMatch(handed, /nx-dossier-body|class="verifier-drop"/, "the Demo has no receiving or inspection drawer");
  assert.doesNotMatch(handed, /data-analyzed-digest=/, "no independent analysis is implied by a review-state handoff");

  const analyzing = await rendered("en", "/nx?t=126000&analysis=requested&verifier=open");
  assert.match(analyzing, /data-verification-state="ANALYZING"/);
  assert.doesNotMatch(analyzing, /data-verdict="(VALID|INVALID|INDETERMINATE|REVOKED)"/, "the verdict is the engine verifier's asynchronous result; the server has none");
  assert.doesNotMatch(analyzing, /class="nx-verifier-surface"/, "review acts do not mount a modal verifier");
});

// Include dedicated intake SSR coverage in the existing rendered gate.
import './final-surface-rendered.test.mjs';

// A graph deep link is not evidence: mission review stays in the Demo, and the
// empty independent verifier still starts with receiving the exact package.
test("FS-R2: graph deep links preserve mission-only Demo and evidence-first verifier entry", async () => {
  const demo = await rendered("en", "/nx?t=126000&decision=approved&inspect=graph");
  assert.doesNotMatch(demo, /class="nx-demo-inspection"|data-variant="B2"|class="nx-proof"/);
  assert.match(demo, /href="\/verify" target="_blank"/);
  for (const path of ["/verify", "/verify?inspect=graph"]) {
    const verifier = await rendered("en", path);
    assert.match(verifier, /data-peb-state="AWAITING"/);
    assert.match(verifier, /data-workspace="entry"/);
    assert.match(verifier, /class="verifier-drop"/);
    assert.match(verifier, /id="evidence-file"[^>]*type="file"/);
    assert.doesNotMatch(verifier, /id="verifier-tab-|role="tab(?:list|panel)?"|data-inspection-level=/, "a requested graph cannot mount without received evidence");
    assert.doesNotMatch(verifier, /data-verdict="(?:VALID|INVALID|INDETERMINATE|REVOKED)"/, "navigation grants no verification result");
  }
});


test("Demo: NanoReceipt identities are progressively disclosed from the current admitted set, independently of final receipt and PEB", async () => {
  for (const locale of ["en", "fr"]) {
    const empty = await rendered(locale, "/nx");
    assert.match(empty.replaceAll("<!-- -->", ""), /0 NanoReceipts \(NR\) · (?:available|disponibles)/);
    assert.doesNotMatch(empty, /class="nx-network-receipt-count"/, "no network receipt is invented by SSR");
    assert.match(empty, /data-reset-mission/, "reset is accessible before starting");
    assert.match(empty, /data-network-baseline-ready="false"/, "SSR has not observed a physical baseline");
    assert.doesNotMatch(empty, /class="nx-nr-summary"|class="nx-final-summary"|class="boundary-key"/);
    const waiting = await rendered(locale, "/nx?t=12000");
    const waitingDetails = waiting.match(/<details class="nx-nr-summary"[^]*?<\/details>/)?.[0];
    assert.ok(waitingDetails);
    assert.doesNotMatch(waitingDetails, /value="NR-ACTION:brake"/, "queued receipt is not available for identity inspection");
    const reading = await rendered(locale, "/nx?t=12500");
    const details = reading.match(/<details class="nx-nr-summary"[^]*?<\/details>/)?.[0];
    assert.ok(details);
    assert.doesNotMatch(details, /<details[^>]*\bopen(?:=|[ >])/, "receipt details are closed by default");
    assert.match(details, /<summary title="[^"]*NR-ACTION:brake"/, "hover exposes the declared identity");
    assert.match(details, /data-selected-nr="NR-ACTION:brake"/);
    assert.match(details, /<code>NR-ACTION:brake<\/code>/, "one full identity is inspectable without a presentation alias");
    const count = Number(reading.match(/data-nr-count="(\d+)"/)?.[1]);
    assert.ok(count > 0);
    assert.equal((details.match(/<option /g) ?? []).length, count, "all and only admitted NanoReceipts can be selected");
    assert.doesNotMatch(reading, /class="boundary-key"/);
    const completed = await rendered(locale, "/nx?t=126000&decision=approved");
    assert.match(completed, /data-nr-count="58"/);
    assert.match(completed, /<details class="nx-final-summary"><summary>/, "final receipt is a separate collapsed object");
    const finalId = completed.match(/data-final-receipt="([^"]+)"/)?.[1];
    assert.ok(finalId);
    const completedDetails = completed.match(/<details class="nx-nr-summary"[^]*?<\/details>/)?.[0];
    assert.ok(completedDetails);
    assert.ok(!completedDetails.includes(finalId), "final receipt is never a selectable NanoReceipt");
    assert.equal((completedDetails.match(/<option /g) ?? []).length, 58);
  }
});
