export type Locale = "en" | "fr";

export interface FlowStep {
  label: string;
}

export interface PropertyItem {
  title: string;
  body: string;
}

export interface VerificationLayer {
  name: string;
  body: string;
}

export interface UseCaseBlock {
  title: string;
  body: string;
  points: string[];
}

export interface SoftwareChangeUseCase extends UseCaseBlock {
  chain: string[];
}

export interface StandardEntry {
  name: string;
  body: string;
}

export interface Dictionary {
  meta: {
    title: string;
    description: string;
    ogLocale: string;
  };

  nav: {
    brand: string;
    why: string;
    how: string;
    verifier: string;
    useCases: string;
    architecture: string;
    demo: string;
    docs: string;
    pilot: string;
    languageLabel: string;
    themeLabel: string;
    openMenu: string;
    closeMenu: string;
    skipToContent: string;
  };

  cta: {
    viewDemo: string;
    verifyReceipt: string;
  };

  hero: {
    kicker: string;
    title: string;
    titleAlt: string;
    subtitle: string;
    scrollHint: string;
    flow: [FlowStep, FlowStep, FlowStep];
  };

  journey: {
    kicker: string;
    title: string;
    states: { title: string; body: string }[];
  };

  controlGap: {
    kicker: string;
    title: string;
    progression: string[];
    question: string;
    logsLine: string;
    explainer: {
      platforms: string;
      policies: string;
      tools: string;
      logs: string;
      thirdParty: string;
    };
  };

  howItWorks: {
    kicker: string;
    title: string;
    intro: string;
    receipt: {
      title: string;
      body: string;
      fields: string[];
    };
    bundle: {
      title: string;
      body: string;
      fields: string[];
    };
    verifier: {
      title: string;
      body: string;
      verdictsIntro: string;
    };
    boundary: {
      title: string;
      body: string;
    };
  };

  independentByDesign: {
    kicker: string;
    title: string;
    flowLabels: [string, string, string];
    disappearNote: string;
    properties: PropertyItem[];
  };

  proofSequence: {
    kicker: string;
    title: string;
    body: string;
    steps: string[];
    runLabel: string;
    replayLabel: string;
    stateNotRun: string;
    alterLabel: string;
    verifyLabel: string;
    disclaimer: string;
    ctaDemo: string;
  };

  verificationLayers: {
    kicker: string;
    title: string;
    intro: string;
    layers: VerificationLayer[];
    footnote: string;
  };

  useCases: {
    kicker: string;
    title: string;
    intro: string;
    classes: {
      agentic: UseCaseBlock;
      software: UseCaseBlock;
      human: UseCaseBlock;
      payments: UseCaseBlock;
      cyberPhysical: UseCaseBlock;
      external: UseCaseBlock;
      multiParty: UseCaseBlock;
    };
    examplesLabel: string;
    examples: string;
  };

  architecture: {
    kicker: string;
    title: string;
    intro: string;
    rows: [string, string, string, string, string, string];
    note: string;
  };

  standards: {
    kicker: string;
    title: string;
    intro: string;
    legend: {
      delivered: string;
      documented: string;
      roadmap: string;
    };
    delivered: StandardEntry[];
    documented: StandardEntry[];
    roadmap: StandardEntry[];
  };

  openVerification: {
    kicker: string;
    title: string;
    body: string;
    distinguish: {
      available: string;
      experimental: string;
      demonstrative: string;
      roadmap: string;
    };
    items: {
      label: string;
      status: "available" | "experimental" | "demonstrative" | "roadmap";
      body: string;
    }[];
  };

  teaser: {
    kicker: string;
    title: string;
    body: string;
    cta: string;
    play: string;
    pause: string;
    close: string;
    sceneDescription: string;
  };

  pilot: {
    kicker: string;
    title: string;
    body: string;
    cta: string;
    note: string;
    examplesTitle: string;
    examples: string[];
    outro: string;
  };

  finalStatement: {
    line1: string;
    line2: string;
    line3: string;
    ctaDemo: string;
    ctaDocs: string;
    ctaVerify: string;
  };

  d003: {
    receiptTravelsWithEvidence: string;
    verifyReceiptIndependently: string;
    verifying: string;
  };

  d005: {
    kicker: string;
    title: string;
    subtitle: string;
    explore: string;
    closeEvidence: string;
    replayReady: string;
    replaying: string;
    masterTime: string;
    scales: { overview: string; mission: string; forensic: string };
    bands: {
      reality: string;
      realitySubtitle: string;
      system: string;
      systemSubtitle: string;
      proof: string;
      proofSubtitle: string;
    };
    passengerAboard: string;
    vehicleEmpty: string;
    activeAuthority: string;
    noAuthorityDecision: string;
    evidenceObjects: string;
    subMissionReceipts: string;
    cycleReceipt: string;
    pending: string;
    available: string;
    verifyCycle: string;
    verifying: string;
    paymentPolicy: string;
    normalInvoice: string;
    approvedInvoice: string;
    deniedInvoice: string;
    missingCompletion: string;
    tamperedInvoice: string;
    autonomousAuthorized: string;
    humanApprovalRequired: string;
    deniedTerminal: string;
    sendBundle: string;
    independentVerifier: string;
    waitingBundle: string;
    productionTrustIncomplete: string;
    emotionalArc: Record<"normality" | "uncertainty" | "understanding" | "control" | "proof" | "calmConfidence", string>;
    trafficStory: Record<"quiet" | "traffic" | "eta" | "authority" | "rerouted", string>;
    paymentStory: Record<"invoice" | "policy" | "human" | "execution" | "receipt" | "stopped", string>;
    receiptBorn: string;
    evidenceJoined: string;
    routeOriginal: string;
    routeAlternative: string;
    cycleComplete: string;
    receiptReady: string;
    evidenceBundled: string;
    receiptTravelsWithEvidence: string;
    verify: string;
  };

  d005f: {
    kicker: string;
    title: string;
    subtitle: string;
    continuityPrinciple: string;
    reviewPacing: string;
    chapterLabel: string;
    boundaryLabel: string;
    operationalMoment: string;
    evidencedMoment: string;
    passengerWaiting: string;
    passengerAboard: string;
    passengerDroppedOff: string;
    pickupPoint: string;
    chosenDestination: string;
    externalGarage: string;
    maintenanceInProgress: string;
    workComplete: string;
    invoiceAmount: string;
    autonomousLimit: string;
    capabilityPresent: string;
    authorityInsufficient: string;
    approve: string;
    delegatedAuthority: string;
    paymentAuthorized: string;
    paymentSettled: string;
    parked: string;
    masterPath: string;
    historicalComparison: string;
    deniedComparison: string;
    prepareBundle: string;
    bundleReady: string;
    detachBundle: string;
    sourceSystem: string;
    evidenceSupport: string;
    noVerdictBeforeVerify: string;
    chapters: Record<"passenger" | "garageJourney" | "maintenance" | "governedPayment" | "return" | "proof", string>;
    moments: Record<
      | "passenger-request"
      | "taxi-en-route-to-passenger"
      | "taxi-aligned-pickup"
      | "passenger-pickup"
      | "passenger-journey"
      | "passenger-destination-approach"
      | "passenger-exit"
      | "passenger-dropoff"
      | "passenger-mission-complete"
      | "garage-mission-begins"
      | "normal-route-to-garage"
      | "garage-journey"
      | "congestion"
      | "eta-at-risk"
      | "provider-transition"
      | "reroute-authorized"
      | "physical-reroute"
      | "garage-approach"
      | "garage-arrival"
      | "maintenance-begins"
      | "diagnosis"
      | "maintenance-proposal"
      | "maintenance-authorized"
      | "work-in-progress"
      | "work-complete"
      | "invoice-1850"
      | "policy-exceeded"
      | "human-approval-required"
      | "human-approve"
      | "authority-delegated"
      | "payment-authorized"
      | "payment-execution"
      | "payment-result"
      | "manager-notified"
      | "return-to-base-intent"
      | "return-route-calculation"
      | "return-route-calculated"
      | "leaving-garage"
      | "return-journey"
      | "base-approach"
      | "parked-at-base"
      | "sub-mission-receipts"
      | "master-cycle-receipt",
      string
    >;
    systems: Record<
      | "passengerService"
      | "navigationA"
      | "navigationB"
      | "taxiAutonomy"
      | "fleetOperations"
      | "trafficProvider"
      | "routingSelection"
      | "garage"
      | "maintenanceSystem"
      | "paymentPolicy"
      | "humanApprover"
      | "authorityGovernance"
      | "paymentProvider"
      | "managerWorkflow"
      | "causalCompiler",
      string
    >;
    boundaries: Record<string, string>;
    evidenceLabels: Record<string, string>;
    authorityStates: Record<"notApplicable" | "autonomousLimit" | "humanRequired" | "humanApproved" | "delegated" | "paymentAuthorized", string>;
    paymentSteps: Record<"invoice" | "limit" | "escalation" | "approved" | "delegated" | "authorized" | "request" | "result" | "receipt", string>;
  };

  d005g: {
    physicalSync: string;
    reviewModeLabel: string;
    interactiveMode: string;
    recordingMode: string;
    waitingForAuthority: string;
    deniedTerminal: string;
    humanGateLabel: string;
    humanApprover: string;
    humanApprovalRequired: string;
    invoice: string;
    autonomousLimit: string;
    approve: string;
    deny: string;
    approvalEvidenced: string;
    canonicalApprovalMode: string;
    noPaymentAfterDeny: string;
    passengerBoarding: string;
    passengerExiting: string;
    downloadPeb: string;
    copyPeb: string;
    pebCopied: string;
    copyFailed: string;
    qrUnavailable: string;
    vehicleStates: Record<
      | "stopped"
      | "moving"
      | "arriving"
      | "boarding"
      | "passengerOnboard"
      | "dropoff"
      | "garageStopped"
      | "maintenance"
      | "waitingForAuthority"
      | "paymentPending"
      | "readyToDepart"
      | "returningToBase"
      | "parked",
      string
    >;
    passengerStates: Record<"waiting" | "boarding" | "onboard" | "droppingOff" | "notOnboard", string>;
  };

  d005h: {
    naturalPacing: string;
    harmonyPrinciple: string;
    slowdown: string;
    arrivalDelayed: string;
    routeSearch: string;
    routeAuthorized: string;
    routeChanged: string;
    departingNaturally: string;
    autoResuming: string;
    anchors: Record<"pickup" | "dropoff" | "garage" | "base", string>;
  };

  d006d: {
    language: string;
    networkStatus: string;
    connected: string;
    lost: string;
    restored: string;
    unknown: string;
    externalReachabilityNotMeasured: string;
    evidenceContinuesLocal: string;
    sameMission: string;
    networkLostReceipt: string;
    networkRestoredReceipt: string;
    finalReceiptLocal: string;
    quarantined: string;
    /**
     * The Reconciliation Receipt as a node in the causal graph — the evidence
     * object itself, named like its NR-NET-* siblings. Distinct from
     * `reconciliation`, which names the process the status panel reports on.
     * Rendering both with one string made two different things look like one
     * duplicated thing.
     */
    reconciliationReceipt: string;
    reconciliation: string;
    reconciliationPending: string;
    reconciliationComplete: string;
    reconciliationFailed: string;
    noEvidenceChanged: string;
    sameOriginDemoScope: string;
    immutableChecks: Record<"mission" | "finalReceipt" | "peb" | "verdict" | "causalOrder", string>;
    unchanged: string;
  };

  /** D-006-C2 public-experience copy. Canonical identifiers stay outside this
      namespace and are never translated. */
  d006c2: {
    brandSubtitle: string;
    journey: [string, string, string];
    journeyLabel: string;
    missionKicker: string;
    heroQuestion: string;
    heroAnswer: string;
    heroIntro: string;
    switchToFrench: string;
    switchToEnglish: string;
    startOver: string;
    pause: string;
    callTaxi: string;
    continueMission: string;
    missionClock: string;
    timelineAria: string;
    eventRibbonAria: string;
    bands: {
      happened: string;
      happenedSubtitle: string;
      evidence: string;
      evidenceSubtitle: string;
    };
    causal: Record<
      "request" | "physicalAi" | "route" | "maintenance" | "authority" | "payment" | "return" | "network" | "complete",
      string[]
    >;
    eventLabels: Record<string, string>;
    actorLabels: Record<string, string>;
    signalStates: Record<"OFF" | "GREEN" | "YELLOW" | "RED", string>;
    familyLabels: Record<"mission" | "vehicle" | "infrastructure" | "service" | "human" | "financial", string>;
    receiptKinds: Record<"mission" | "vehicle" | "infrastructure" | "service" | "human" | "financial", string>;
    network: {
      testLabel: string;
      testInstruction: string;
      lost: string;
      missionContinues: string;
      evidenceContinues: string;
      restoredEvent: string;
    };
    routing: {
      title: string;
      recalculating: string;
      ready: string;
      technicalDetails: string;
      simulatedProvider: string;
    };
    completion: {
      missionComplete: string;
      portableEvidenceReady: string;
      readyToCarry: string;
      stopped: string;
      noApproval: string;
      restart: string;
    };
    authority: {
      aria: string;
      boundary: string;
      required: string;
      question: string;
      requested: string;
      requestedAmount: string;
      autonomousLimit: string;
      limitAmount: string;
      localEvidence: string;
      noSettlement: string;
      allow: string;
      deny: string;
    };
    proof: {
      treeAria: string;
      receiptDetail: string;
      producedBy: string;
      recordedAt: string;
      evidence: string;
      source: string;
      portableReady: string;
      take: string;
      localFinalReceipt: string;
      carryToVerifier: string;
      handedOver: string;
      sameArtifactTransit: string;
      flowerAria: string;
      final: string;
      receipt: string;
      nanoReceipt: string;
    };
    verifier: {
      step: string;
      title: string;
      subtitle: string;
      heading: string;
      chamberAria: string;
      structureAria: string;
      waiting: string;
      insert: string;
      releaseToInsert: string;
      insertHere: string;
      carryInstruction: string;
      received: string;
      ready: string;
      analyze: string;
      result: string;
      checksAria: string;
      limitsAria: string;
      productionTrustMissing: string;
      settlementNotShown: string;
      canonicalVerdict: string;
      identitySummary: string;
      identityTitle: string;
      profile: string;
      key: string;
      trustAnchor: string;
      scope: string;
      transport: string;
      localDeterministic: string;
      noNetworkRequired: string;
      verdicts: Record<"VALID" | "INVALID" | "REVOKED" | "INDETERMINATE", { headline: string; scope: string; reading: string }>;
      checkLabels: Record<string, string>;
    };
    transversality: {
      kicker: string;
      title: string;
      question: string;
      domains: [string, string, string, string, string];
    };
    footer: string;
  };

  d006c3: {
    passenger: {
      phases: Record<
        "HIDDEN" | "WAITING" | "WALKING_TO_TAXI" | "ABOARD" | "STEPPING_OUT" | "AT_DESTINATION",
        string
      >;
    };
    network: {
      waitingLive: string;
    };
    reconciliation: {
      localRecords: string;
      transferred: string;
      digests: string;
      digestsMatch: string;
    };
    verifier: {
      technicalDetails: string;
    };
    factSections: Record<
      "mission" | "road" | "passenger" | "route" | "garage" | "payment" | "network" | "evidence",
      string
    >;
    factStatus: Record<"SUPPORTED" | "NOT_OCCURRED" | "NOT_DEMONSTRATED", string>;
    inspectionStatus: Record<
      "VERIFIED" | "NOT_COVERED" | "NOT_DEMONSTRATED" | "NOT_PRESENTED" | "NOT_VERIFIED",
      string
    >;
    facts: {
      recordKicker: string;
      recordTitle: string;
      recordAria: string;
      inspectionAria: string;
      statements: Record<string, string>;
    };
  };
  /** D-006 NX1 — the blank-slate public experience. Copy is short by rule (§58). */
  nx: {
    title: string;
    kicker: string;
    start: string;
    pause: string;
    resume: string;
    restart: string;
    missionTime: string;
    ready: string;
    evidenceOne: string;
    evidenceMany: string;
    newEvidence: string;
    evidenceKicker: string;
    evidenceControl: string;
    openBranch: string;
    openReceipt: string;
    worldAria: string;
    languageAria: string;
    factAria: string;
    evidenceAria: string;
    actors: { taxi: string; passenger: string; light: string; base: string; garage: string; queue: string };
    /** One label per provenance branch of the Proof Tree projection. */
    provenance: Record<"city" | "vehicle" | "mission" | "route" | "service" | "authority" | "bank" | "network" | "safety" | "unresolved", string>;
    /** Significant episodes the evidence is grouped by on demand. */
    episodes: Record<"missionStart" | "signalStop" | "passenger" | "garageRoute" | "maintenance" | "payment" | "return" | "final" | "network" | "other", string>;
    /** B R2 — the action / evidence family each nano-receipt carries as its colour. */
    families: Record<"perception" | "intent" | "decision" | "authorization" | "action" | "result" | "network" | "unclassified", string>;
    /** B R2 — the proof band's own words: the reading rail's head and the family legend. */
    proof: { readingOrder: string; causalDepth: string; families: string; legendAria: string; threads: string; threadCause: string; threadObserved: string; threadCompiled: string; toStart: string; toEnd: string; chain: string };
    /** R3 — the lower workspace: reconciliation band, verifier left, dossier right. */
    workspace: { aria: string; inspect: string; close: string; back: string; technical: string };
    /** B R1 — the post-seal zone label beneath the Final Receipt. */
    postSeal: string;
    /**
     * Checkpoint B — the physical link, as the sentinel observes it.
     * C-R2-F04 shows it as a signal glyph with no visible words; these strings
     * are the accessible name, which must still state what was observed.
     */
    link: {
      title: string;
      aria: string;
      connected: string;
      lost: string;
      unobserved: string;
      lostNote: string;
      missionContinues: string;
      restoredEvent: string;
      sentinelAbsent: string;
    };
    /**
     * The reconciliation band. C-R2-F04 removed `unobserved` and `connected`:
     * both described the LINK and where evidence was kept in one sentence, and
     * link state now belongs to the signal glyph alone. What remains is the
     * reconciliation sequence — evidence facts, which this band still reports.
     */
    reconciliation: {
      title: string;
      aria: string;
      local: string;
      returned: string;
      comparing: string;
      reconciled: string;
      failed: string;
      receipt: string;
      evidenceLocal: string;
      evidenceReconciled: string;
      verdictHeld: string;
      reasons: string;
      journalAfterSeal: string;
    };
    verifier: {
      title: string;
      aria: string;
      question: string;
      relation: string;
      awaiting: string;
      notReady: string;
      handoff: string;
      handedOver: string;
      analyze: string;
      analyzing: string;
      result: string;
      verdict: string;
      established: string;
      notEstablished: string;
      reasons: string;
      checks: string;
      identity: string;
      transferred: string;
      facts: string;
      dropHere: string;
      dropArmed: string;
      /** The verifier as an instrument: header, empty state, the acts, the inspect sections. */
      instrument: string;
      pick: string;
      carried: string;
      release: string;
      deposit: string;
      notReceived: string;
      noAnalysis: string;
      noVerdict: string;
      received: string;
      missionId: string;
      objects: string;
      bundleStatus: string;
      digest: string;
      offline: string;
      online: string;
      unobserved: string;
      inspectVerdict: string;
      sections: Record<"path" | "graph" | "structure" | "flow" | "receipts" | "trust", string>;
      categories: Record<"integrity" | "signatures" | "trust" | "causality" | "time" | "evidence", string>;
      similarityNotCausality: string;
      flowNotAuthority: string;
      receivedOffline: string;
      verdictOffline: string;
      establishes: Record<"transferredBytesExact" | "bundleIntegrity" | "missionRunIdentity" | "trustAuthorization" | "signatures" | "causalClosure" | "displayedCoverage" | "nonSettlement", string>;
    };
    dossier: {
      title: string;
      aria: string;
      question: string;
      empty: string;
      nrOne: string;
      nrMany: string;
      finalReceipt: string;
      finalPending: string;
      peb: string;
      pebLong: string;
      pebPending: string;
      mission: string;
      episodes: string;
      branches: string;
      nanoReceipts: string;
      compiledInto: string;
      carriedIn: string;
      allBranches: string;
      episodeCountOne: string;
      episodeCountMany: string;
      inputs: string;
      issuedAt: string;
      settlement: string;
      notDemonstrated: string;
      members: string;
      supporting: string;
      runtime: string;
      bytes: string;
      pebState: Record<"NOT_READY" | "FORMING" | "READY" | "IN_TRANSIT" | "RECEIVED", string>;
      take: string;
      pick: string;
      dragHint: string;
      sealedCount: string;
      afterSealCount: string;
    };
    detail: {
      title: string;
      id: string;
      event: string;
      type: string;
      family: string;
      /** Checkpoint C — the reading handle, and the statement that it is only that. */
      ordinal: string;
      time: string;
      provenance: string;
      trustDomain: string;
      source: string;
      parents: string;
      observed: string;
      digest: string;
      assurance: string;
      retained: string;
      notRetained: string;
      journal: string;
      context: string;
      closure: string;
      run: string;
      mission: string;
      none: string;
      sources: Record<"SIGNED_CANONICAL" | "RUNTIME_JOURNAL" | "D006_FINAL_RECEIPT", string>;
    };
  };

  footer: {
    productHeading: string;
    demoLink: string;
    docsLink: string;
    verifierLink: string;
    githubLink: string;
    githubUnavailable: string;
    legalHeading: string;
    disclaimer: string;
    languageHeading: string;
    copyrightNote: string;
  };

  emptyStates: {
    noWebgl: string;
    reducedMotion: string;
  };
}
