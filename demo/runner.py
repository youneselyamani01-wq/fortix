"""
FortiX  - End-to-End Flow Demonstration
=========================================
Runs the full FortiX pipeline in-process using production service modules.
No live server required.

Decision authority:
  The gateway (ActionGateway / POST /action/submit) is the single authoritative
  runtime decision point.  It evaluates policy, issues the ADR receipt, and
  writes the audit entry in a single processing cycle.

Each scenario walks through three production steps plus one advisory trace:

  Step 1  - Gateway Processing   (ActionGateway -> receipt + policy + audit)
             Single authoritative runtime decision point.
  Step 2  - Independent Verify   (VerifyService  - stateless, no gateway state)
  Step 3  - Audit Trail          (GatewayAuditEntry read from log)

  Advisory - FortiX Control Trace (ControlService)
             Non-authoritative.  Runs the same policy rules as the gateway
             but is not wired into the gateway decision path.  Shown here
             for diagnostic comparison only.

Note on execution: _execute_action() is a stub in this reference build.
The receipt, policy decision, and audit entry are real; the downstream
action call returns a placeholder result.

Usage:
    python demo/runner.py

Returns (when imported) a list[ScenarioResult] for programmatic inspection.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

# Make sure the fortix-core package root is on sys.path when run as a script.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.control.models import DecisionTrace
from app.control.service import ControlService
from app.gateway.action_gateway import ActionGateway
from app.gateway.audit import read_audit_entries_for_action
from app.gateway.models import GatewayAuditEntry
from app.models.action_request import ActionRequest
from app.policy.engine import PolicyEngine
from app.verify.models import VerificationResult
from app.verify.presenter import present
from app.verify.service import VerifyService

from demo.fixtures import (
    DEMO_KEY_ID,
    DEMO_PRIVATE_KEY_HEX,
    DEMO_PUBLIC_KEY_HEX,
    SCENARIOS,
    DemoScenario,
)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class ScenarioResult:
    scenario_id: str
    # Advisory - FortiX Control trace (non-authoritative)
    control_verdict: str          # "ALLOW" | "REVIEW" | "DENY"
    control_code: str             # VerdictCode.value
    control_trace: DecisionTrace
    control_message: str
    # Step 1  - Gateway (authoritative decision point)
    gateway_status: str           # GatewayStatus.value
    gateway_executed: bool
    gateway_policy_decision: str
    gateway_policy_reason: str
    gateway_receipt_hash: str     # full BLAKE3 hex
    gateway_receipt_signature: str  # full Ed25519 hex
    gateway_receipt_key_id: str
    gateway_idempotency_outcome: str
    # Step 2  - Verify
    verify_status: str            # "VALID" | "INVALID" | "UNVERIFIABLE"
    verify_code: str
    verify_institutional_verdict: str
    verify_institutional_explanation: str
    verify_hash_verified: bool | None
    verify_signature_verified: bool | None
    # Step 3  - Audit
    audit_entry: GatewayAuditEntry | None


# ---------------------------------------------------------------------------
# Services factory
# ---------------------------------------------------------------------------

def build_demo_services() -> tuple[ActionGateway, ControlService, VerifyService]:
    """
    Build fresh, isolated service instances for the demo.

    Each call returns a new ActionGateway with empty idempotency state so the
    demo is reproducible regardless of prior runs or test state.
    """
    gateway = ActionGateway(
        private_key_hex=DEMO_PRIVATE_KEY_HEX,
        key_id=DEMO_KEY_ID,
        policy_engine=PolicyEngine(),
    )
    return gateway, ControlService(), VerifyService()


# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------

def run_scenario(
    scenario: DemoScenario,
    gateway: ActionGateway,
    control_svc: ControlService,
    verify_svc: VerifyService,
) -> ScenarioResult:
    """Run one scenario through all four FortiX pipeline steps."""
    action = ActionRequest(**scenario.action)

    # ── Advisory: FortiX Control trace (non-authoritative) ────────────────
    control_verdict_obj, control_trace = control_svc.evaluate(action)

    # ── Step 1: Gateway Processing (receipt + policy + audit) ──────────────
    # The gateway is the single authoritative runtime decision point.
    gateway_response = gateway.submit_action(action)
    receipt = gateway_response["adr_receipt"]

    # ── Step 2: Independent Verification ──────────────────────────────────
    verify_result = verify_svc.verify(
        receipt=receipt,
        public_key_hex=DEMO_PUBLIC_KEY_HEX,
    )
    verify_response = present(verify_result)

    # ── Step 3: Audit Trail ────────────────────────────────────────────────
    audit_entries = read_audit_entries_for_action(action.action_id)
    audit_entry = audit_entries[-1] if audit_entries else None

    return ScenarioResult(
        scenario_id=scenario.id,
        # Step 1
        control_verdict=control_verdict_obj.verdict,
        control_code=control_verdict_obj.code.value,
        control_trace=control_trace,
        control_message=control_verdict_obj.message,
        # Step 2
        gateway_status=gateway_response["status"],
        gateway_executed=gateway_response.get("executed", False),
        gateway_policy_decision=gateway_response["policy"]["decision"],
        gateway_policy_reason=gateway_response["policy"]["reason"],
        gateway_receipt_hash=receipt["hash"],
        gateway_receipt_signature=receipt["signature"],
        gateway_receipt_key_id=receipt["key_id"],
        gateway_idempotency_outcome=audit_entry.idempotency_outcome.value
        if audit_entry
        else "unknown",
        # Step 3
        verify_status=verify_response.status,
        verify_code=verify_response.code.value,
        verify_institutional_verdict=verify_response.institutional.verdict,
        verify_institutional_explanation=verify_response.institutional.explanation,
        verify_hash_verified=verify_response.expert.hash_verified,
        verify_signature_verified=verify_response.expert.signature_verified,
        # Step 4
        audit_entry=audit_entry,
    )


# ---------------------------------------------------------------------------
# Human-readable printer
# ---------------------------------------------------------------------------

_W = 60  # column width for banners


def _line(char: str = "-") -> str:
    return char * _W


def _banner(char: str = "=") -> str:
    return char * _W


def _tick(v: bool | None) -> str:
    if v is True:
        return "OK"
    if v is False:
        return "FAIL"
    return "--"


def _verdict_badge(verdict: str) -> str:
    badges = {"ALLOW": "[ALLOW]", "REVIEW": "[REVIEW]", "DENY": "[DENY]"}
    return badges.get(verdict, f"[{verdict}]")


def print_demo_header() -> None:
    print()
    print(_banner())
    print("  FortiX  - End-to-End Flow Demonstration")
    print("  Gateway (authoritative) | Verify | Audit  +  Control trace (advisory)")
    print(_banner())
    print(f"  Key       {DEMO_KEY_ID}")
    print(f"  Pub key   {DEMO_PUBLIC_KEY_HEX[:16]}...{DEMO_PUBLIC_KEY_HEX[-8:]}")
    print()


def print_scenario(scenario: DemoScenario, result: ScenarioResult) -> None:
    n = SCENARIOS.index(scenario) + 1
    total = len(SCENARIOS)

    print(_banner())
    print(f"  {scenario.title}")
    print(f"  {scenario.subtitle}")
    print(_banner())

    action = scenario.action
    payload = action.get("payload", {})
    metadata = action.get("metadata", {})
    amt = payload.get("amount", "")
    cur = payload.get("currency", "")
    ref = payload.get("reference", "")
    risk = metadata.get("risk", "")

    print(f"  Actor      {action['actor_id']}")
    print(f"  Action     {action['action']} -> {action['target']}")
    if amt and cur:
        print(f"  Amount     {cur} {amt:,}  |  Ref: {ref}")
    print(f"  Risk       {risk}")
    print(f"  Timestamp  {action['timestamp']}")
    print()

    # ── Advisory: FortiX Control trace ───────────────────────────────────
    print("  [Advisory / FortiX Control Trace]")
    print("  Note       Non-authoritative. Gateway (Step 1) is the single")
    print("             runtime decision point. Shown here for comparison.")
    print(f"  Service    ControlService  (policy-version: {result.control_trace.policy_version})")
    print(f"  Verdict  > {result.control_verdict}  (code: {result.control_code})")
    rules = result.control_trace.rules_evaluated
    rule_parts = []
    for r in rules:
        icon = "OK" if not r.matched else "FAIL" if r.verdict == "DENY" else "WARN"
        rule_parts.append(f"{r.rule}: {icon}")
    print(f"  Rules      {' | '.join(rule_parts)}")
    print(f"  Message    \"{result.control_message}\"")
    print()

    # ── Step 1 ────────────────────────────────────────────────────────────
    print("  [Step 1 / Gateway  ->  Receipt / Policy / Audit]")
    print(f"  Service    ActionGateway  (key: {result.gateway_receipt_key_id})")
    print(f"  Receipt  > ADR v1.0 issued  (BLAKE3 + Ed25519)")
    print(f"  Hash       {result.gateway_receipt_hash[:16]}...{result.gateway_receipt_hash[-8:]}")
    print(f"  Sig        {result.gateway_receipt_signature[:16]}...{result.gateway_receipt_signature[-8:]}")
    print(f"  Decision   {result.gateway_policy_decision} / {result.gateway_policy_reason}")
    print(f"  Status   > {result.gateway_status}")
    print(f"  Executed   {result.gateway_executed}  (stub; receipt and audit are real)")
    print(f"  Idempot.   {result.gateway_idempotency_outcome}")
    print()

    # ── Step 2 ────────────────────────────────────────────────────────────
    print("  [Step 2 / Independent Verification]")
    print("  Service    VerifyService  - stateless, no gateway context or private key")
    print(f"  Status   > {result.verify_status}  (code: {result.verify_code})")
    print(
        f"  Checks     hash: {_tick(result.verify_hash_verified)}  "
        f"| signature: {_tick(result.verify_signature_verified)}"
    )
    print(f"  Verdict    \"{result.verify_institutional_verdict}\"")
    print(f"  Detail     \"{result.verify_institutional_explanation}\"")
    print()

    # ── Step 3 ────────────────────────────────────────────────────────────
    print("  [Step 3 / Audit Trail]")
    if result.audit_entry:
        ae = result.audit_entry
        print(f"  entry_id   {ae.entry_id}")
        print(f"  ts         {ae.ts}")
        print(f"  action_id  {ae.action_id}")
        print(f"  actor_id   {ae.actor_id}")
        print(f"  status     {ae.status.value}")
        print(f"  executed   {ae.executed}")
        print(f"  idempotency_outcome  {ae.idempotency_outcome.value}")
        print(f"  adr_hash   {ae.adr_hash[:16]}...{ae.adr_hash[-8:]}")
    else:
        print("  (no audit entry found)")
    print()

    # ── What this proves ──────────────────────────────────────────────────
    print("  What this proves:")
    for point in scenario.proves:
        # Word-wrap at _W - 6 chars
        words = point.split()
        lines_out: list[str] = []
        current = ""
        for w in words:
            if len(current) + len(w) + 1 > _W - 6:
                lines_out.append(current)
                current = w
            else:
                current = (current + " " + w).strip()
        if current:
            lines_out.append(current)
        for i, ln in enumerate(lines_out):
            prefix = "  + " if i == 0 else "    "
            print(f"{prefix}{ln}")
    print()
    print(_line())
    print()


def print_demo_summary(scenarios: list[DemoScenario], results: list[ScenarioResult]) -> None:
    print(_banner())
    print("  Summary")
    print(_banner())
    for s, r in zip(scenarios, results):
        ctrl = _verdict_badge(r.control_verdict)
        gw = r.gateway_status
        vfy = r.verify_status
        print(f"  {s.id:<8}  control: {ctrl:<10}  gateway: {gw:<26}  verify: {vfy}")
    print()
    print("  All three scenarios used the same production modules.")
    print("  Gateway (Step 1) is the single authoritative runtime decision point.")
    print("  FortiX Control trace is advisory - not wired into the gateway path.")
    print("  The Verify step was stateless  - no gateway context, no private key.")
    print("  Each decision is recorded in a structured, serialisable audit trail.")
    print(_banner())
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> list[ScenarioResult]:
    gateway, control_svc, verify_svc = build_demo_services()

    print_demo_header()

    results: list[ScenarioResult] = []
    for scenario in SCENARIOS:
        result = run_scenario(scenario, gateway, control_svc, verify_svc)
        results.append(result)
        print_scenario(scenario, result)

    print_demo_summary(SCENARIOS, results)
    return results


if __name__ == "__main__":
    main()
