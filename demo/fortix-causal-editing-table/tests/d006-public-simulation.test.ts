import assert from "node:assert/strict";
import test from "node:test";

import { HUMAN_AUTHORITY_GATE_MS } from "../app/reviewFlow.ts";
import { EXPERIENCE_DURATION_MS } from "../app/storyTimeline.ts";
import { mountEngine, until } from "./support/missionEngineHarness.ts";

/** No spoofed sentinel and no forged physical baseline are permitted on the public route. */
test("public visitor without sentinel can run D-006 simulation and receive a truthful PEB", async () => {
  let sentinelReads = 0;
  const mounted = mountEngine(0, {
    experienceMode: "PUBLIC_SIMULATION",
    readSentinel: async () => {
      sentinelReads += 1;
      throw new Error("public simulation must never poll a local sentinel");
    },
  });
  const engine = mounted.engine;
  try {
    await until(() => engine().snapshot.session.runId !== "fortix.d006e.run.unresolved", "run identity");
    assert.equal(engine().experienceMode, "PUBLIC_SIMULATION");
    assert.equal(engine().networkBaselineReady, false);
    assert.equal(engine().snapshot.networkState, "UNKNOWN");
    engine().play();
    await until(() => engine().snapshot.playing, "simulated playback starts");
    engine().pause();
    // Wait for React to commit the pause and dispose of its outstanding
    // requestAnimationFrame before seeking, otherwise a queued frame may reset
    // the clock after the seek in the headless harness.
    await until(() => !engine().snapshot.playing, "paused public playback");
    engine().seek(HUMAN_AUTHORITY_GATE_MS);
    await until(() => engine().snapshot.masterTimeMs === HUMAN_AUTHORITY_GATE_MS, "authority decision gate: " +
      JSON.stringify({ time: engine().snapshot.masterTimeMs, mode: engine().experienceMode, ready: engine().networkBaselineReady }), 10_000);
    engine().decide("APPROVED");
    await until(() => engine().snapshot.humanDecision === "APPROVED", "human approval");
    engine().pause();
    engine().seek(EXPERIENCE_DURATION_MS);
    await until(() => engine().snapshot.handoffArtifact !== null, "signed source + simulated runtime PEB", 60_000);
    const snap = engine().snapshot;
    const events = snap.session.records.filter(r => r.eventType === "NETWORK_LINK_LOST" || r.eventType === "NETWORK_LINK_RESTORED");
    assert.equal(events.length, 0, "a no-sentinel run must NEVER mint a physical network transition");
    assert.equal(snap.networkState, "UNKNOWN");
    assert.equal(snap.linkObservationCurrent, false);
    assert.equal(snap.sentinelReachable, false);
    assert.equal(snap.handoffArtifact?.peb.runtimeRecords.some(r => r.eventType === "NETWORK_LINK_LOST" || r.eventType === "NETWORK_LINK_RESTORED"), false);
    assert.equal(sentinelReads, 0);
    engine().pick();
    await until(() => engine().snapshot.transferStage === "FORMED", "picking up simulated PEB");
    engine().drop();
    await until(() => engine().snapshot.transferStage === "TRANSFERRED", "independent verifier transfer");
    engine().analyze();
    await until(() => engine().snapshot.verification !== null, "independent verification result", 60_000);
    const verdict = engine().snapshot.verification!;
    assert.equal(verdict.verdict, "INDETERMINATE", "simulated D-006 is not production VALID");
    assert.equal(sentinelReads, 0);
  } finally {
    mounted.unmount();
  }
});

test("physical mode without actual sentinel remains fail-closed and cannot start", async () => {
  const mounted = mountEngine(0, {
    experienceMode: "PHYSICAL_SENTINEL",
    readSentinel: async () => { throw new Error("No observed adapter"); },
  });
  const engine = mounted.engine;
  try {
    await until(() => engine().snapshot.session.runId !== "fortix.d006e.run.unresolved", "physical test run identity");
    assert.equal(engine().networkBaselineReady, false);
    engine().play();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(engine().snapshot.playing, false);
    engine().seek(HUMAN_AUTHORITY_GATE_MS);
    assert.equal(engine().snapshot.masterTimeMs, 0);
    assert.equal(engine().snapshot.networkState, "UNKNOWN");
    assert.equal(engine().snapshot.session.records.filter(r => r.eventType === "NETWORK_LINK_LOST" || r.eventType === "NETWORK_LINK_RESTORED").length, 0);
  } finally {
    mounted.unmount();
  }
});
