import { canVerifyLocally } from "../app/verify/verificationCapability.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("../app/verify/VerifierWorkspace.tsx", import.meta.url), "utf8");

test("separate-tab intake never derives trusted expectations from PEB contents or triggers analysis", () => {
  const intake = source.slice(source.indexOf("const receive ="), source.indexOf("async function analyze()"));
  assert.match(intake, /receivePebFromSite/);
  assert.match(intake, /stopSite\(\); stopDemo\(\); generation\.current \+= 1/, "unmount invalidates asynchronous file reads and both bridges");
  assert.match(intake, /return receive\(\[selected\]\)/);
  assert.doesNotMatch(intake, /JSON\.parse|analyzeInsertedD006Peb|insertD006PebForAnalysis|reportAnalyze\.current\?\.\(/);
  assert.match(intake, /setMission\(parcel\.expected\.missionId\)/);
  assert.match(intake, /setRun\(parcel\.expected\.runId\)/);
  assert.match(intake, /setDigest\(parcel\.expected\.transferredContentDigest\)/);
  assert.match(intake, /fatal: true, ignoreBOM: true/, "file intake preserves exact UTF-8 text including BOM");
  for (const [key, setter] of [["mission", "setMission"], ["run", "setRun"], ["digest", "setDigest"]]) assert.ok(source.includes(`const [${key}, ${setter}] = useState("");`));
  assert.match(source, /onClick=\{\(\) => void analyze\(\)\}/);
  assert.match(source, /if \(!ready \|\| !file\) return;/, "analysis remains gated on independent trusted input and received bytes");
  assert.match(source, /insertD006PebForAnalysis\(\{ pebText: file\.text, expectedIdentity: \{ missionId: mission\.trim\(\), runId: run\.trim\(\) \}, expectedTransferredContentDigest: digest\.trim\(\) \}\)/);
  assert.match(source, /const localSnapshot = await analyzeInsertedD006Peb\(inserted\)/);
  assert.match(source, /if \(current === generation\.current\) setSnapshot\(localSnapshot\)/, "late analyses cannot replace a newer received package");
});

test("the primary flow reveals expectations after receipt and leads with the actual analysis result", () => {
  assert.match(source, /useState<VerifierTab>\("peb"\)/);
  assert.match(source, /\{\(file \|\| held\) && <section className="verifier-expectations"/, "the empty entry has no expected-input form or Analyze control");
  assert.match(source, /demoContext \? <details className="verifier-expected-details"/);
  assert.match(source, /: <><p>\{c\.expectationNote\}<\/p>\{expectationInputs\}<\/>/, "independent expectations remain usable once bytes arrive");

  const rendered = source.slice(source.indexOf("return <main"));
  const resultStart = rendered.indexOf('className="verifier-result verifier-primary-result"');
  const intakeStart = rendered.indexOf('className="verifier-receipt-details"');
  assert.ok(resultStart >= 0 && intakeStart > resultStart, "verdict and the next reading action precede received-package details");
  assert.match(rendered, /\{result && \(activeTab === "overview" \|\| activeTab === "peb"\)/);
  assert.match(rendered, /\{activeTab === "peb" && \(result \? <details className="verifier-receipt-details"><summary>\{v\.receiptDetails\}<\/summary>\{intake\}<\/details> : intake\)\}/, "completed analysis collapses intake, while pre-analysis intake remains directly available");
  const result = rendered.slice(resultStart, intakeStart);
  assert.match(result, /data-verdict=\{result\.verdict\}/);
  assert.match(result, /id="verdict-title">\{result\.verdict\}</);
  assert.match(result, /\{c\.limits\}/, "the prominent result retains the verification limits");
  assert.match(result, /<a className="verifier-action" href=\{modularLinks\.path\}/, "the primary next action has a real Path destination for native and new-tab navigation");
  assert.match(result, /openModularRoute\(event, "path"\)/);
  assert.match(result, /"Lire les faits" : "Read the facts"/, "the destination is announced in human language");
});

test("received evidence opens dedicated reading views with retained bytes, compact context and explicit return", () => {
  const reader = readFileSync(new URL("../app/verify/VerifierRouteClient.tsx", import.meta.url), "utf8");
  assert.match(source, /const isInspection = activeTab === "graph" && !!file/);
  assert.match(source, /data-workspace=\{isInspection \? "inspection" : "entry"\}/);
  assert.match(source, /\{!file && <header className="verifier-entry-heading"/, "the landing hero unmounts when evidence arrives");
  assert.match(source, /\{file && <header className="verifier-workspace-context"/, "the investigation retains compact package and verdict context");
  assert.match(source, /activeTab !== "peb" && activeTab !== "graph" && <header className="verifier-surface-title"/, "Inspection has no competing dashboard title");
  assert.match(source, /const modularNavigation = file && received &&/, "principal reading views are visible once a package is received");
  const navigation = source.slice(source.indexOf("const modularNavigation ="), source.indexOf("const intake ="));
  assert.match(navigation, /<a key=\{view\} href=\{modularLinks\[view\]\}/, "every view exposes a usable canonical link");
  assert.doesNotMatch(navigation, /<details|role="tablist"/);
  assert.match(source, /store\.put\(\{ digest: received\.transferDigest, text: file\.text \}\)/, "views share the exact cached bytes");
  assert.match(source, /await verifierStoreWrite\.current/);
  assert.match(source, /window\.history\.pushState\(createVerifierNavigationHistoryState\(window\.history\.state, "\/verify", path\)/, "opening a reading view records an intake parent for browser Back");
  assert.match(source, /<VerifierRouteClient requestedView=\{embeddedView\} onReturnToIntake=\{returnToIntake\}/);
  assert.match(reader, /className="verifier-context-return" href=\{returnPath\}/);
  assert.match(source, /\{file && <details className="verifier-package-details"/);
  assert.match(source, /\{packageOpen && <section id="received-peb-inspection"/, "raw package structure mounts only after explicit disclosure");
  assert.match(reader, /route\.view === "graph" && <ReceivedPebInspection text=\{loaded\.entry\.text\}/, "the received graph is reconstructed from cached received bytes");
  assert.match(reader, /route\.view === "forensic" && <ForensicView/, "technical depth remains an explicit dedicated destination");
});

test("inspection results remain bound to the exact received bytes", () => {
  assert.match(source, /const inspectionSnapshot = snapshot\?\.transferredContentDigest === received\?\.transferDigest \? snapshot : null/);
  assert.match(source, /snapshot=\{inspectionSnapshot\}/);
  const inspection = readFileSync(new URL("../app/verify/ReceivedPebInspection.tsx", import.meta.url), "utf8");
  assert.match(inspection, /const associatedSnapshot = snapshot\?\.transferredContentDigest === peb\.transferDigest \? snapshot : null/);
  assert.match(inspection, /snapshot=\{associatedSnapshot\}/);
});


test("analysis capability requires browser key import and verification without attempting either", () => {
  let calls = 0;
  const importKey: SubtleCrypto["importKey"] = async () => { calls += 1; return {} as CryptoKey; };
  const verify: SubtleCrypto["verify"] = async () => { calls += 1; return true; };
  for (const provider of [null, {}, { subtle: {} }, { subtle: { importKey } }, { subtle: { verify } }]) assert.equal(canVerifyLocally(provider), false);
  assert.equal(canVerifyLocally({ subtle: { importKey, verify } }), true);
  assert.equal(canVerifyLocally(globalThis.crypto), true, "the supported Node/desktop verification path stays available");
  assert.equal(calls, 0, "capability detection does not perform a cryptographic operation or inspect evidence");
});

test("missing Web Crypto is an operational UI error before any verifier call or Demo intent", () => {
  const analysis = source.slice(source.indexOf("async function analyze()"), source.indexOf("const inspectionSnapshot ="));
  const guard = analysis.indexOf('if (!canVerifyLocally()) { setError("cryptoUnavailable"); return; }');
  assert.ok(guard > analysis.indexOf("if (!ready || !file) return;"));
  assert.ok(guard > analysis.indexOf("resetResult();"), "a failed new attempt cannot keep an old verdict on screen");
  for (const operation of ["busyRef.current = true", "insertD006PebForAnalysis(", "reportAnalyze.current?.()", "analyzeInsertedD006Peb("]) assert.ok(analysis.indexOf(operation) > guard, `${operation} happens only after capability preflight`);
  assert.doesNotMatch(analysis.slice(0, guard), /setFile|setMission|setRun|setDigest|setPackageOpen/, "the received bytes, expectations and inspection remain available");
  assert.match(source, /data-operational-error=\{error === "cryptoUnavailable" \? "crypto-unavailable" : undefined\}/);
  assert.match(source, /error === "cryptoUnavailable" \? v\.cryptoUnavailable : c\[error\]/);
});

test("Demo orchestration cancels unavailable analysis intent without leaving a pending verification", () => {
  const hook = readFileSync(new URL("../app/nx/adapter/useMissionEngine.ts", import.meta.url), "utf8");
  assert.match(hook, /const effectiveAnalysisRequested = effectiveTransferStage === "TRANSFERRED" && analysisRequested;/);
  const request = hook.slice(hook.indexOf("const analyze = useCallback"), hook.indexOf("// The analysis, once requested"));
  assert.ok(request.indexOf("if (!canVerifyLocally())") < request.indexOf("setAnalysisRequested(true)"));
  const effect = hook.slice(hook.indexOf("// The analysis, once requested"), hook.indexOf("// --- the physical link:"));
  const guard = effect.indexOf("if (analysisRequested && !canVerifyLocally()) {");
  assert.ok(guard >= 0 && guard < effect.indexOf("insertD006PebForAnalysis("));
  assert.match(effect, /queueMicrotask\(\(\) => \{ if \(run === analysisRun\.current\) setAnalysisRequested\(false\); \}\);/, "unsupported deep-link intent is cancelled after hydration, guarded against reset");
  assert.match(effect, /if \(run !== analysisRun\.current\) return;/, "existing cancellation epoch still rejects stale results");
  assert.match(effect, /return \(\) => \{ analysisRun\.current \+= 1; \};/);
});
