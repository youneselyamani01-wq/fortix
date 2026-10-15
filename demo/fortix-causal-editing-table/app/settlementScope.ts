/**
 * D-006G P2R — settlement claims may not exceed the evidence that supports
 * them.
 *
 * The signed D-005M bundle contains exactly one settlement assertion:
 *
 *   d005m.master-payment-result
 *     issuer            fortix.demo.payment-provider.d005m
 *     trust boundary    fortix.demo.boundary.payment-provider
 *     details           { provider_result: "SETTLED", amount_eur: 1850, ... }
 *
 * and there is no bank, no account-holding institution and no financial
 * settlement boundary anywhere in its 45 objects. A payment PROCESSOR moves an
 * instruction; only an account-holding institution settles funds. So this is a
 * party asserting an act it is not the one who performs.
 *
 * Now that signatures are genuinely verified, this matters MORE, not less. The
 * assertion is authentic — the provider really did sign that string — and an
 * authentic assertion is exactly the kind a verifier is most likely to promote
 * into a conclusion. Authenticity establishes WHO SAID IT, never WHETHER IT
 * HAPPENED.
 *
 * The fixture cannot be regenerated in this checkout (`app.evidence.builders`
 * is absent), and forging a correction would be worse than the defect. So the
 * claim is quarantined instead: detected from the evidence, reported, and
 * barred from supporting any verdict.
 */

export type SettlementAssertion = Readonly<{
  evidenceId: string;
  eventId: string;
  issuerId: string;
  boundaryId: string;
}>;

export type SettlementScope = Readonly<{
  assertions: readonly SettlementAssertion[];
  /** Does any object come from a boundary that could actually settle funds? */
  financialInstitutionPresent: boolean;
  /** Settlement assertions for which no matching settling event exists. */
  unsupportedAssertions: readonly SettlementAssertion[];
  /** At least one settlement assertion lacks transaction-matched support. */
  quarantined: boolean;
}>;

export type FinancialClosure = Readonly<{
  invoiceId: "invoice-d005m-1850";
  amountEur: 1850;
  autonomousAuthorityLimitEur: 500;
  authorizationStatus: "AUTHORIZED" | "NOT_DEMONSTRATED";
  transactionSubmissionStatus: "PRESENTED" | "NOT_DEMONSTRATED";
  settlementStatus: "NOT_DEMONSTRATED";
  supportingEvidenceIds: readonly string[];
  unsupportedClaimEvidenceIds: readonly string[];
}>;

export type RuntimeFinancialRecord = Readonly<{
  eventId: string;
  receiptId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

/** Boundaries whose participants can perform settlement. */
const SETTLING_BOUNDARY = /bank|financial-institution|account-holding|settlement/i;

/** Payload markers that assert funds actually moved. */
const SETTLEMENT_CLAIM = /"(?:provider_result|result|status|settlement_status)"\s*:\s*"(?:SETTLED|SETTLEMENT_COMPLETE)"/i;

function readString(source: unknown, key: string): string {
  if (typeof source !== "object" || source === null) return "";
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function payloadOf(candidate: unknown): unknown {
  if (typeof candidate !== "object" || candidate === null) return null;
  return (candidate as Record<string, unknown>).evidence_payload ?? null;
}

function findScalar(source: unknown, key: string): string | number | null {
  if (source === null || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const value of source) {
      const found = findScalar(value, key);
      if (found !== null) return found;
    }
    return null;
  }
  const object = source as Record<string, unknown>;
  const direct = object[key];
  if (typeof direct === "string" || typeof direct === "number") return direct;
  for (const value of Object.values(object)) {
    const found = findScalar(value, key);
    if (found !== null) return found;
  }
  return null;
}

function transactionKey(candidate: unknown): string {
  const payload = payloadOf(candidate);
  const invoice = findScalar(payload, "invoice_id") ?? findScalar(payload, "instruction_ref") ?? "";
  const amount = findScalar(payload, "amount_eur") ?? "";
  const currency = findScalar(payload, "currency") ?? "EUR";
  return `${String(invoice)}|${String(amount)}|${String(currency)}`;
}

export function assessSettlementScope(
  canonicalEvidenceObjects: readonly unknown[],
): SettlementScope {
  const assertions: SettlementAssertion[] = [];
  const settlingAssertions: Readonly<{ assertion: SettlementAssertion; transaction: string }>[] = [];
  let financialInstitutionPresent = false;

  for (const candidate of canonicalEvidenceObjects) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const object = candidate as Record<string, unknown>;
    const boundaryId = readString(object.trust_boundary, "trust_boundary_id");
    if (SETTLING_BOUNDARY.test(boundaryId)) financialInstitutionPresent = true;

    // Matched against the payload only, so a boundary NAME containing the word
    // cannot be mistaken for a claim that funds moved.
    if (!SETTLEMENT_CLAIM.test(JSON.stringify(object.evidence_payload ?? {}))) continue;
    const assertion = {
      evidenceId: readString(object, "evidence_id"),
      eventId: readString(object.significant_event, "event_id"),
      issuerId: readString(object.issuer, "issuer_id"),
      boundaryId,
    };
    assertions.push(assertion);
    if (SETTLING_BOUNDARY.test(boundaryId)) {
      settlingAssertions.push({ assertion, transaction: transactionKey(object) });
    }
  }

  const unsupportedAssertions = assertions.filter((assertion) => {
    if (SETTLING_BOUNDARY.test(assertion.boundaryId)) return false;
    const source = canonicalEvidenceObjects.find((candidate) => (
      typeof candidate === "object"
      && candidate !== null
      && readString(candidate, "evidence_id") === assertion.evidenceId
    ));
    const claimedTransaction = transactionKey(source);
    return !settlingAssertions.some((support) => (
      support.transaction === claimedTransaction
      || (support.transaction === "||EUR" && claimedTransaction === "||EUR")
    ));
  });

  return Object.freeze({
    assertions: Object.freeze(assertions),
    financialInstitutionPresent,
    unsupportedAssertions: Object.freeze(unsupportedAssertions),
    // Merely adding a bank AUTHORIZATION object must not rehabilitate a
    // provider's SETTLED assertion. Support must itself be a settlement event
    // from a settling boundary and must name the same transaction.
    quarantined: unsupportedAssertions.length > 0,
  });
}

/**
 * The strongest financial statement the current D-006 evidence can carry.
 * Human approval, provider presentation and bank authorization are material
 * and independently named. No clearing/settlement result participates, so
 * settlement remains NOT_DEMONSTRATED even though the frozen predecessor
 * bundle contains a provider-authored SETTLED assertion.
 */
export function deriveFinancialClosure(
  canonicalEvidenceObjects: readonly unknown[],
  runtimeRecords: readonly RuntimeFinancialRecord[],
): FinancialClosure {
  const scope = assessSettlementScope(canonicalEvidenceObjects);
  const instruction = runtimeRecords.find((record) => record.eventId === "d006g.payment-instruction-presented");
  const authorization = runtimeRecords.find((record) => record.eventId === "d006g.bank-authorization");
  const confirmation = runtimeRecords.find((record) => record.eventId === "d006g.bank-confirmation");
  const supportingEvidenceIds = [
    ...canonicalEvidenceObjects.flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const object = candidate as Record<string, unknown>;
      const eventId = readString(object.significant_event, "event_id");
      return [
        "d005m.master-invoice-1850",
        "d005m.master-payment-policy-exceeded",
        "d005m.master-human-approve",
        "d005m.master-payment-authorized",
        "d005m.master-payment-instruction",
      ].includes(eventId)
        ? [readString(object, "evidence_id")]
        : [];
    }),
    instruction?.receiptId ?? "",
    authorization?.receiptId ?? "",
    confirmation?.receiptId ?? "",
  ].filter((value) => value.length > 0);

  return Object.freeze({
    invoiceId: "invoice-d005m-1850",
    amountEur: 1850,
    autonomousAuthorityLimitEur: 500,
    authorizationStatus: authorization?.payload.decision === "AUTHORIZED"
      ? "AUTHORIZED"
      : "NOT_DEMONSTRATED",
    transactionSubmissionStatus: instruction === undefined ? "NOT_DEMONSTRATED" : "PRESENTED",
    settlementStatus: "NOT_DEMONSTRATED",
    supportingEvidenceIds: Object.freeze(supportingEvidenceIds),
    unsupportedClaimEvidenceIds: Object.freeze(
      scope.unsupportedAssertions.map((assertion) => assertion.evidenceId),
    ),
  });
}
