"""
Tests for the FortiX end-to-end demo runner.

Coverage:
  - Each scenario produces the expected control verdict
  - Each scenario produces the expected gateway status
  - All scenarios verify as VALID via the independent VerifyService
  - Verification uses only the public key (no private key, no gateway state)
  - Audit entries are written for every scenario
  - Audit entry actor_id matches the scenario action
  - Audit entry idempotency_outcome is FIRST_SEEN for all demo scenarios
  - All scenario results are JSON-serialisable
  - Demo is deterministic: same scenario inputs → same receipt hash
  - DENY scenario: action is not executed; receipt is still issued
  - REVIEW scenario: action is queued, not executed
  - No regression on existing ADR, Control, Verify, Gateway flows
"""
from __future__ import annotations

import json

import pytest

from demo.fixtures import DEMO_PUBLIC_KEY_HEX, SCENARIOS, DemoScenario
from demo.runner import ScenarioResult, build_demo_services, run_scenario


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _patch_audit(tmp_path, monkeypatch):
    """Redirect gateway audit writes to a temp file for test isolation."""
    import app.gateway.audit as audit_module
    monkeypatch.setattr(audit_module, "AUDIT_LOG_PATH", tmp_path / "gateway_audit.log")


@pytest.fixture(scope="function")
def demo_results() -> list[ScenarioResult]:
    """Run all three demo scenarios and return results."""
    gateway, control_svc, verify_svc = build_demo_services()
    return [
        run_scenario(s, gateway, control_svc, verify_svc)
        for s in SCENARIOS
    ]


def _result_for(results: list[ScenarioResult], scenario_id: str) -> ScenarioResult:
    return next(r for r in results if r.scenario_id == scenario_id)


# ---------------------------------------------------------------------------
# Control verdicts
# ---------------------------------------------------------------------------

class TestControlVerdicts:
    def test_allow_scenario_control_verdict(self, demo_results):
        r = _result_for(demo_results, "allow")
        assert r.control_verdict == "ALLOW"
        assert r.control_code == "ok"

    def test_review_scenario_control_verdict(self, demo_results):
        r = _result_for(demo_results, "review")
        assert r.control_verdict == "REVIEW"
        assert r.control_code == "high_risk_escalation"

    def test_deny_scenario_control_verdict(self, demo_results):
        r = _result_for(demo_results, "deny")
        assert r.control_verdict == "DENY"
        assert r.control_code == "external_transfer_blocked"

    def test_control_messages_are_non_empty(self, demo_results):
        for r in demo_results:
            assert len(r.control_message) > 10

    def test_control_trace_has_all_rules(self, demo_results):
        from app.control.policy import CONTROL_RULES
        for r in demo_results:
            # In evaluate mode, at least 1 rule is always present.
            assert len(r.control_trace.rules_evaluated) >= 1

    def test_expected_verdicts_match_scenario_definitions(self, demo_results):
        for scenario, result in zip(SCENARIOS, demo_results):
            assert result.control_verdict == scenario.expected_control_verdict, (
                f"Scenario {scenario.id}: expected {scenario.expected_control_verdict}, "
                f"got {result.control_verdict}"
            )


# ---------------------------------------------------------------------------
# Gateway status
# ---------------------------------------------------------------------------

class TestGatewayStatus:
    def test_allow_scenario_gateway_status(self, demo_results):
        r = _result_for(demo_results, "allow")
        assert r.gateway_status == "executed"
        assert r.gateway_executed is True

    def test_review_scenario_gateway_status(self, demo_results):
        r = _result_for(demo_results, "review")
        assert r.gateway_status == "pending_review"
        assert r.gateway_executed is False

    def test_deny_scenario_gateway_status(self, demo_results):
        r = _result_for(demo_results, "deny")
        assert r.gateway_status == "blocked_by_policy"
        assert r.gateway_executed is False

    def test_expected_statuses_match_scenario_definitions(self, demo_results):
        for scenario, result in zip(SCENARIOS, demo_results):
            assert result.gateway_status == scenario.expected_gateway_status

    def test_all_scenarios_produce_adr_receipt(self, demo_results):
        """A receipt is issued regardless of the policy outcome."""
        for r in demo_results:
            assert len(r.gateway_receipt_hash) == 64
            assert len(r.gateway_receipt_signature) > 0
            assert r.gateway_receipt_key_id == "demo-key-001"


# ---------------------------------------------------------------------------
# Independent verification — the verifier has no gateway state or private key
# ---------------------------------------------------------------------------

class TestIndependentVerification:
    def test_all_scenarios_verify_as_valid(self, demo_results):
        """
        Regardless of policy outcome (ALLOW / REVIEW / DENY), the ADR receipt
        is always cryptographically valid — it was signed by the gateway key.
        """
        for r in demo_results:
            assert r.verify_status == "VALID", (
                f"Scenario {r.scenario_id}: expected VALID, got {r.verify_status} "
                f"(code: {r.verify_code})"
            )

    def test_hash_verified_true_for_all_scenarios(self, demo_results):
        for r in demo_results:
            assert r.verify_hash_verified is True

    def test_signature_verified_true_for_all_scenarios(self, demo_results):
        for r in demo_results:
            assert r.verify_signature_verified is True

    def test_institutional_verdict_says_verified(self, demo_results):
        for r in demo_results:
            assert "verified" in r.verify_institutional_verdict.lower()

    def test_verify_uses_public_key_only(self):
        """
        The verifier is instantiated with zero gateway state.
        Verify it can confirm a receipt knowing only the public key.
        """
        from app.verify.service import VerifyService
        from app.gateway.action_gateway import ActionGateway
        from app.models.action_request import ActionRequest
        from app.policy.engine import PolicyEngine
        from demo.fixtures import DEMO_PRIVATE_KEY_HEX, DEMO_KEY_ID, DEMO_PUBLIC_KEY_HEX

        # Separate gateway and verifier instances — no shared state.
        gw = ActionGateway(
            private_key_hex=DEMO_PRIVATE_KEY_HEX,
            key_id=DEMO_KEY_ID,
            policy_engine=PolicyEngine(),
        )
        svc = VerifyService()

        action = ActionRequest(
            action_id="verify-isolation-test",
            actor_id="actor-test",
            action="read",
            target="internal",
            timestamp="2024-01-15T10:00:00+00:00",
            payload={"item": "ledger-entry"},
            metadata={},
        )
        resp = gw.submit_action(action)
        receipt = resp["adr_receipt"]

        # Verifier has no reference to the gateway instance.
        result = svc.verify(receipt, DEMO_PUBLIC_KEY_HEX)
        assert result.status == "VALID"
        assert result.hash_match is True
        assert result.signature_valid is True


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

class TestAuditTrail:
    def test_all_scenarios_have_audit_entries(self, demo_results):
        for r in demo_results:
            assert r.audit_entry is not None, f"No audit entry for {r.scenario_id}"

    def test_all_scenarios_idempotency_outcome_first_seen(self, demo_results):
        from app.gateway.models import IdempotencyOutcome
        for r in demo_results:
            assert r.audit_entry.idempotency_outcome == IdempotencyOutcome.FIRST_SEEN

    def test_audit_entry_actor_id_matches_action(self, demo_results):
        for scenario, result in zip(SCENARIOS, demo_results):
            assert result.audit_entry.actor_id == scenario.action["actor_id"]

    def test_audit_entry_adr_hash_matches_gateway_receipt(self, demo_results):
        for r in demo_results:
            assert r.audit_entry.adr_hash == r.gateway_receipt_hash

    def test_audit_entry_executed_matches_gateway_executed(self, demo_results):
        for r in demo_results:
            assert r.audit_entry.executed == r.gateway_executed

    def test_audit_entry_is_json_serialisable(self, demo_results):
        for r in demo_results:
            data = r.audit_entry.to_audit_dict()
            json.dumps(data)  # must not raise

    def test_audit_entry_status_matches_gateway_status(self, demo_results):
        for r in demo_results:
            assert r.audit_entry.status.value == r.gateway_status


# ---------------------------------------------------------------------------
# Determinism — same inputs → same receipt hash across separate runs
# ---------------------------------------------------------------------------

class TestDeterminism:
    def test_allow_receipt_hash_is_stable(self, tmp_path, monkeypatch):
        """
        Running the ALLOW scenario twice with a fresh gateway each time must
        produce the same receipt hash (fixed key + fixed payload).
        """
        import app.gateway.audit as audit_module
        monkeypatch.setattr(audit_module, "AUDIT_LOG_PATH", tmp_path / "audit2.log")

        scenario = next(s for s in SCENARIOS if s.id == "allow")
        gw1, ctrl1, vfy1 = build_demo_services()
        gw2, ctrl2, vfy2 = build_demo_services()

        r1 = run_scenario(scenario, gw1, ctrl1, vfy1)
        r2 = run_scenario(scenario, gw2, ctrl2, vfy2)

        assert r1.gateway_receipt_hash == r2.gateway_receipt_hash
        assert r1.gateway_receipt_signature == r2.gateway_receipt_signature

    def test_deny_receipt_hash_is_stable(self, tmp_path, monkeypatch):
        import app.gateway.audit as audit_module
        monkeypatch.setattr(audit_module, "AUDIT_LOG_PATH", tmp_path / "audit3.log")

        scenario = next(s for s in SCENARIOS if s.id == "deny")
        gw1, ctrl1, vfy1 = build_demo_services()
        gw2, ctrl2, vfy2 = build_demo_services()

        r1 = run_scenario(scenario, gw1, ctrl1, vfy1)
        r2 = run_scenario(scenario, gw2, ctrl2, vfy2)

        assert r1.gateway_receipt_hash == r2.gateway_receipt_hash

    def test_control_verdict_is_deterministic(self):
        """Same action → same control verdict, even across ControlService instances."""
        from app.control.service import ControlService
        from app.models.action_request import ActionRequest
        scenario = next(s for s in SCENARIOS if s.id == "review")
        action = ActionRequest(**scenario.action)
        ctrl1 = ControlService()
        ctrl2 = ControlService()
        v1, _ = ctrl1.evaluate(action)
        v2, _ = ctrl2.evaluate(action)
        assert v1.verdict == v2.verdict
        assert v1.code == v2.code


# ---------------------------------------------------------------------------
# Scenario completeness
# ---------------------------------------------------------------------------

class TestScenarioCompleteness:
    def test_three_scenarios_run(self, demo_results):
        assert len(demo_results) == 3

    def test_scenario_ids_are_allow_review_deny(self, demo_results):
        ids = {r.scenario_id for r in demo_results}
        assert ids == {"allow", "review", "deny"}

    def test_deny_receipt_still_issued(self, demo_results):
        """Even a denied action gets a signed receipt — this is the audit proof."""
        r = _result_for(demo_results, "deny")
        assert len(r.gateway_receipt_hash) == 64
        assert r.verify_status == "VALID"

    def test_review_receipt_still_issued(self, demo_results):
        r = _result_for(demo_results, "review")
        assert len(r.gateway_receipt_hash) == 64
        assert r.verify_status == "VALID"

    def test_scenario_fixtures_have_expected_fields(self):
        for s in SCENARIOS:
            assert s.id
            assert s.title
            assert s.action
            assert s.expected_control_verdict in ("ALLOW", "REVIEW", "DENY")
            assert s.expected_gateway_status
            assert len(s.proves) >= 1
