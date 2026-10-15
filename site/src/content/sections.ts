/**
 * Section identity registry: anchors, ordering, and which nav item (if any)
 * targets each section. Kept separate from copy (i18n/locales) so reordering
 * or retargeting the page never touches translated strings.
 */
export const SECTION_IDS = {
  hero: "hero",
  controlGap: "control-gap",
  proofJourney: "proof-journey",
  howItWorks: "how-it-works",
  independentByDesign: "independent-by-design",
  proofSequence: "proof-sequence",
  verificationLayers: "verification-layers",
  useCases: "use-cases",
  architecture: "architecture",
  standards: "standards",
  openVerification: "open-verification",
  finalStatement: "final-statement",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

export const NAV_TARGETS: { key: "why" | "how" | "verifier" | "useCases" | "architecture"; anchor: string }[] = [
  { key: "why", anchor: SECTION_IDS.controlGap },
  { key: "how", anchor: SECTION_IDS.howItWorks },
  { key: "useCases", anchor: SECTION_IDS.useCases },
  { key: "architecture", anchor: SECTION_IDS.architecture },
];
