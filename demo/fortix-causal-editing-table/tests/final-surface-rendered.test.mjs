import assert from "node:assert/strict";
import test from "node:test";
import { surfaceCopy } from "../../../site/src/i18n/surface.ts";
import { verifierCopy } from "../app/verify/verifierCopy.ts";

for (const locale of ["en", "fr"]) {
  test(`dedicated verifier ${locale}: empty landing leads with intake and defers investigation`, async () => {
    const { default: worker } = await import(`../dist/server/index.js?surface=${locale}`);
    const response = await worker.fetch(new Request("http://localhost/verify", { headers: { accept: "text/html", "accept-language": locale } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const html = await response.text();
    const copy = surfaceCopy[locale];
    const verifier = verifierCopy[locale];
    assert.ok(html.includes(copy.title));
    assert.match(html, /data-peb-state="AWAITING"/);
    assert.match(html, /data-stage="empty"/);
    assert.match(html, /data-workspace="entry"/);
    assert.match(html, /class="verifier-entry-heading"/);
    assert.match(html, /class="verifier-drop"/);
    assert.match(html, /id="evidence-file"[^>]*type="file"/);
    assert.ok(html.includes(copy.select) && html.includes(verifier.awaiting), "receiving a package is the available primary act");
    assert.ok(html.includes(verifier.entryNote) && html.includes(verifier.fileHint), "the entry explains its purpose and accepted input");
    const steps = html.match(/<ol class="verifier-entry-steps"[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";
    let previous = -1;
    for (const step of [copy.receive, copy.analyze, copy.verdict, copy.inspect]) {
      const index = steps.indexOf(step);
      assert.ok(index > previous, `entry reading order: ${step}`);
      previous = index;
    }
    assert.ok(html.includes(copy.waiting), "the empty state explicitly establishes no analysis or verdict");
    assert.doesNotMatch(html, /role="tab(?:list|panel)?"|id="verifier-tab-/, "technical categories do not mount before evidence arrives");
    assert.doesNotMatch(html, /class="verifier-technical-menu"|class="verifier-analysis"/, "neither technical navigation nor a premature Analyze control competes with intake");
    assert.doesNotMatch(html, /class="verifier-expectations"|<fieldset|id="expected-title"/, "trusted expectations are not an empty-screen form");
    for (const label of [copy.mission, copy.run, copy.digest]) assert.ok(!html.includes(label), `no premature expected input: ${label}`);
    assert.doesNotMatch(html, /class="received-graph-node"|class="verifier-artifact"|class="verifier-raw"|<pre[ >]/);
    assert.doesNotMatch(html, /data-inspection-level=|class="inspection-workspace"/, "inspection opens only after evidence is available and explicitly requested");
    assert.doesNotMatch(html, /class="verifier-result"|data-analyzed-digest=|data-verdict="(?:VALID|INVALID|INDETERMINATE|REVOKED)"/, "SSR cannot issue or imply a verdict");
  });
}
