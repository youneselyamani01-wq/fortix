import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGraph } from "../app/nx/gate2/canonicalGraph.ts";
import { buildVariantB2 } from "../app/nx/gate2/variantB.ts";
import { buildVariantC } from "../app/nx/gate2/variantC.ts";
import { buildVariantD4 } from "../app/nx/gate2/variantD34.ts";
import { inspectionLabel } from "../app/nx/verifier/inspectionLabels.ts";

test("inspection translations preserve numeric axes, IDs and immutable graph layouts", () => {
  assert.equal(inspectionLabel("authority", "fr"), "Autorité");
  assert.equal(inspectionLabel("bank", "fr"), "Banque");
  assert.equal(inspectionLabel("NR 48", "fr"), "NR 48");
  assert.equal(inspectionLabel("provenance lane", "fr"), "Contexte de provenance");
  const graph = canonicalGraph();
  for (const build of [buildVariantB2, buildVariantC, buildVariantD4]) {
    const layout = build({ graph, width: 1120, height: 500 });
    const before = JSON.stringify(layout);
    for (const ornament of layout.ornaments) {
      const original = ornament.label;
      assert.equal(inspectionLabel(original, "en"), original);
      const translated = inspectionLabel(original, "fr");
      if (original) assert.deepEqual(translated?.match(/\d+(?:\.\d+)?/g), original.match(/\d+(?:\.\d+)?/g));
    }
    assert.equal(JSON.stringify(layout), before);
  }
});
