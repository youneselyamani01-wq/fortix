import type { Metadata } from "next";
import { headers } from "next/headers";
import { en } from "../../../../site/src/i18n/locales/en";
import { fr } from "../../../../site/src/i18n/locales/fr";
import { resolveLocaleFromAcceptLanguage } from "../locale.ts";
import { EXPERIENCE_DURATION_MS } from "../storyTimeline.ts";
import { NxExperience, type WorkspaceState } from "./experience/NxExperience";
import { inspectSectionFrom } from "./verifier/inspectSections.ts";
import type { DossierFocus } from "./workspace/EvidenceDossier";

/**
 * D-006 NX1 — the blank-slate public experience, at /nx.
 * The legacy experience at / is preserved as the negative reference.
 */
export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  const copy = (locale === "fr" ? fr : en).nx;
  return {
    title: { absolute: `FortiX · ${copy.title}` },
    description: copy.kicker,
  };
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * `?t=<ms>` opens the experience at a moment — a review deep link, never a fact.
 *
 * A link that declares a post-boundary act — the PEB picked, handed over or
 * analyzed — but names no moment means "at the end". The acts persist and
 * apply only once the artifact exists, so rendering such a link at t = 0
 * showed a mission that had not started and none of the declared acts: four
 * differently named review captures came out byte-identical.
 */
function initialTimeFrom(params: SearchParams | undefined): number {
  const raw = params?.t;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  const one = (key: string) => { const entry = params?.[key]; return Array.isArray(entry) ? entry[0] : entry; };
  const declaresAct = one("handoff") === "done" || one("analysis") === "requested" || one("peb") === "picked";
  return declaresAct ? EXPERIENCE_DURATION_MS : 0;
}

const BRANCHES = new Set(["city", "vehicle", "mission", "route", "service", "authority", "bank", "network", "safety", "unresolved"]);
const EPISODES = new Set(["missionStart", "signalStop", "passenger", "garageRoute", "maintenance", "payment", "return", "final", "network", "other"]);

/**
 * Review deep links for the workspace: `?dossier=open` (or the R2 alias
 * `?evidence=open`), `?branch=<lane>`, `?episode=<id>`, `?receipt=<id>`,
 * `?object=final|peb`, `?verifier=open`. They open a panel a reviewer asks
 * for; they never create evidence or a verdict.
 */
function workspaceFrom(params: SearchParams | undefined): WorkspaceState {
  const one = (key: string) => { const raw = params?.[key]; return Array.isArray(raw) ? raw[0] : raw; };
  const branch = one("branch");
  const episode = one("episode");
  const receipt = one("receipt");
  const object = one("object");
  let focus: DossierFocus | null = null;
  if (receipt !== undefined && receipt.length > 0) focus = { kind: "receipt", evidenceId: receipt };
  else if (branch !== undefined && BRANCHES.has(branch)) focus = { kind: "branch", branch: branch as Extract<DossierFocus, { kind: "branch" }>["branch"] };
  else if (episode !== undefined && EPISODES.has(episode)) focus = { kind: "episode", episode: episode as Extract<DossierFocus, { kind: "episode" }>["episode"] };
  else if (object === "final") focus = { kind: "final" };
  else if (object === "peb") focus = { kind: "peb" };
  const open = one("dossier") === "open" || one("evidence") === "open" || focus !== null;
  return {
    // A picked-up PEB opens the verifier (OPEN follows PICK); the link may
    // also open it directly. Neither transfers anything.
    verifier: one("verifier") === "open" || one("peb") === "picked" || one("inspect") !== undefined,
    // `?inspect=<section>` opens one INSPECT section — shown only once a
    // verdict exists, so it is meaningful with `?analysis=requested`.
    inspect: inspectSectionFrom(one("inspect")),
    dossier: { open, focus },
  };
}

/**
 * `?decision=approved`, `?handoff=done`, `?analysis=requested`: the human
 * acts a reviewer declares as already performed, so a review can open on
 * the post-authority workspace. Each is the same engine rule as the click.
 */
function actsFrom(params: SearchParams | undefined): Readonly<{ decision?: "APPROVED"; pebPicked: boolean; handoffDone: boolean; analysisRequested: boolean }> {
  const one = (key: string) => { const raw = params?.[key]; return Array.isArray(raw) ? raw[0] : raw; };
  const analysisRequested = one("analysis") === "requested";
  const handoffDone = one("handoff") === "done" || analysisRequested;
  // `?peb=picked`: the PEB in a reviewer's hand and the verifier open — the
  // state between PICK and DROP, where the verifier must show it holds nothing.
  const pebPicked = one("peb") === "picked" && !handoffDone;
  const decision = one("decision") === "approved" || handoffDone || pebPicked ? "APPROVED" as const : undefined;
  return { decision, pebPicked, handoffDone, analysisRequested };
}

/** `?select=<evidence id>`: a receipt selected on the proof — the chain lights up, no panel opens (B R2 §22). */
function selectionFrom(params: SearchParams | undefined): string | null {
  const raw = params?.select;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value.length > 0 ? value : null;
}

export default async function NxPage({ searchParams }: { searchParams?: Promise<SearchParams> | SearchParams }) {
  const params = searchParams === undefined ? undefined : await searchParams;
  // Public visitors can explore the fictional mission without hardware.
  // The explicit physical mode retains the actual sentinel baseline gate.
  const requestedMode = params?.mode;
  const physicalMode = (Array.isArray(requestedMode) ? requestedMode[0] : requestedMode) === "physical";
  return <NxExperience initialExperienceMode={physicalMode ? "PHYSICAL_SENTINEL" : "PUBLIC_SIMULATION"} initialMasterTimeMs={initialTimeFrom(params)} initialWorkspace={workspaceFrom(params)} initialActs={actsFrom(params)} initialSelection={selectionFrom(params)} />;
}
