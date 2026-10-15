"""
Tests for ControlService — unit-level.

Coverage:
  - ALLOW on a clean, valid request
  - DENY on missing/blank timestamp
  - DENY on external transfer without review_approved
  - ALLOW on external transfer WITH review_approved
  - REVIEW on high-risk metadata
  - Determinism: same input → same verdict/code
  - DecisionTrace is fully JSON-serialisable
  - evaluate() stops at first matching rule
  - explain() evaluates all rules
  - Fail-closed: exceptions produce DENY/INTERNAL_ERROR
"""
from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest

from app.models.action_request import ActionRequest
from app.control.models import VerdictCode
from app.control.service import ControlService
from app.control.policy import POLICY_VERSION


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_action(**overrides) -> ActionRequest:
    base = {
        "action_id": str(uuid.uuid4()),
        "actor_id": "actor-001",
        "action": "read",
        "target": "internal",
        "timestamp": "2024-01-15T10:00:00+00:00",
        "payload": {},
        "metadata": {},
    }
    base.update(overrides)
    return ActionRequest(**base)


@pytest.fixture
def svc() -> ControlService:
    return ControlService()


# ---------------------------------------------------------------------------
# Verdict correctness
# ---------------------------------------------------------------------------

class TestEvaluateVerdicts:
    def test_clean_request_is_allowed(self, svc):
        action = _make_action()
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "ALLOW"
        assert verdict.code == VerdictCode.OK

    def test_missing_timestamp_is_denied(self, svc):
        # ActionRequest enforces min_length=1, so truly empty string is rejected
        # at schema level (422). The policy handles the blank/whitespace case.
        action = _make_action(timestamp="   ")
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "DENY"
        assert verdict.code == VerdictCode.TIMESTAMP_MISSING

    def test_blank_timestamp_is_denied(self, svc):
        action = _make_action(timestamp="\t")
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "DENY"
        assert verdict.code == VerdictCode.TIMESTAMP_MISSING

    def test_external_transfer_without_approval_is_denied(self, svc):
        action = _make_action(action="transfer", target="external", metadata={})
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "DENY"
        assert verdict.code == VerdictCode.EXTERNAL_TRANSFER_BLOCKED

    def test_external_transfer_with_approval_is_allowed(self, svc):
        action = _make_action(
            action="transfer",
            target="external",
            metadata={"review_approved": True},
        )
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "ALLOW"
        assert verdict.code == VerdictCode.OK

    def test_high_risk_triggers_review(self, svc):
        action = _make_action(metadata={"risk": "high"})
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "REVIEW"
        assert verdict.code == VerdictCode.HIGH_RISK_ESCALATION

    def test_non_high_risk_is_allowed(self, svc):
        action = _make_action(metadata={"risk": "low"})
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "ALLOW"

    def test_internal_transfer_is_allowed(self, svc):
        action = _make_action(action="transfer", target="internal")
        verdict, trace = svc.evaluate(action)
        assert verdict.verdict == "ALLOW"

    def test_verdict_message_is_non_empty(self, svc):
        action = _make_action()
        verdict, _ = svc.evaluate(action)
        assert verdict.message != ""


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    def test_same_input_same_verdict(self, svc):
        action = _make_action()
        v1, _ = svc.evaluate(action)
        v2, _ = svc.evaluate(action)
        assert v1.verdict == v2.verdict
        assert v1.code == v2.code

    def test_same_input_same_verdict_deny(self, svc):
        action = _make_action(timestamp="   ")
        v1, _ = svc.evaluate(action)
        v2, _ = svc.evaluate(action)
        assert v1.verdict == "DENY"
        assert v1.code == v2.code

    def test_trace_ids_differ_across_calls(self, svc):
        """trace_id is a UUID per call — it must differ even for identical input."""
        action = _make_action()
        _, t1 = svc.evaluate(action)
        _, t2 = svc.evaluate(action)
        assert t1.trace_id != t2.trace_id


# ---------------------------------------------------------------------------
# Decision trace structure
# ---------------------------------------------------------------------------

class TestDecisionTrace:
    def test_trace_contains_action_id(self, svc):
        action = _make_action()
        _, trace = svc.evaluate(action)
        assert trace.action_id == action.action_id

    def test_trace_contains_actor_id(self, svc):
        action = _make_action()
        _, trace = svc.evaluate(action)
        assert trace.actor_id == action.actor_id

    def test_trace_policy_version(self, svc):
        action = _make_action()
        _, trace = svc.evaluate(action)
        assert trace.policy_version == POLICY_VERSION

    def test_trace_has_trace_id(self, svc):
        action = _make_action()
        _, trace = svc.evaluate(action)
        assert trace.trace_id != ""

    def test_trace_is_json_serialisable(self, svc):
        action = _make_action()
        _, trace = svc.evaluate(action)
        audit = trace.to_audit_dict()
        # Round-trip through JSON must not raise
        serialised = json.dumps(audit)
        parsed = json.loads(serialised)
        assert parsed["action_id"] == action.action_id
        assert parsed["verdict"]["verdict"] == "ALLOW"
        assert parsed["verdict"]["code"] == VerdictCode.OK.value

    def test_trace_deny_is_serialisable(self, svc):
        action = _make_action(timestamp="   ")
        _, trace = svc.evaluate(action)
        audit = trace.to_audit_dict()
        serialised = json.dumps(audit)
        parsed = json.loads(serialised)
        assert parsed["verdict"]["verdict"] == "DENY"
        assert parsed["verdict"]["code"] == VerdictCode.TIMESTAMP_MISSING.value

    def test_trace_rules_evaluated_non_empty(self, svc):
        action = _make_action()
        _, trace = svc.evaluate(action)
        assert len(trace.rules_evaluated) >= 1


# ---------------------------------------------------------------------------
# evaluate vs explain modes
# ---------------------------------------------------------------------------

class TestEvaluateVsExplain:
    def test_evaluate_stops_at_first_match(self, svc):
        """
        When timestamp is blank (first rule), evaluate() should include
        only one rule trace (it stops immediately).
        """
        action = _make_action(timestamp="   ")
        _, trace = svc.evaluate(action)
        # Only the first rule (timestamp_present) should appear
        assert len(trace.rules_evaluated) == 1
        assert trace.rules_evaluated[0].rule == "timestamp_present"

    def test_explain_runs_all_rules(self, svc):
        """explain() runs all rules even if the first one matches."""
        from app.control.policy import CONTROL_RULES
        action = _make_action(timestamp="   ")
        _, trace = svc.explain(action)
        assert len(trace.rules_evaluated) == len(CONTROL_RULES)

    def test_explain_same_verdict_as_evaluate(self, svc):
        action = _make_action(metadata={"risk": "high"})
        v_eval, _ = svc.evaluate(action)
        v_expl, _ = svc.explain(action)
        assert v_eval.verdict == v_expl.verdict
        assert v_eval.code == v_expl.code

    def test_explain_all_rules_present(self, svc):
        from app.control.policy import CONTROL_RULES
        action = _make_action()  # no matches — ALLOW
        _, trace = svc.explain(action)
        rule_names = {r.rule for r in trace.rules_evaluated}
        expected = {fn.__name__.removeprefix("rule_") for fn in CONTROL_RULES}
        # Each rule function name maps to the rule field value
        assert len(trace.rules_evaluated) == len(CONTROL_RULES)

    def test_explain_unmatched_rules_have_no_verdict(self, svc):
        action = _make_action(timestamp="   ")
        _, trace = svc.explain(action)
        # First rule matched — subsequent rules should not be matched
        for r in trace.rules_evaluated[1:]:
            assert not r.matched


# ---------------------------------------------------------------------------
# Fail-closed behaviour
# ---------------------------------------------------------------------------

class TestFailClosed:
    def test_exception_in_rule_produces_deny(self, svc):
        """
        If any rule raises, the service must return DENY/INTERNAL_ERROR,
        not propagate the exception.
        """
        from app.control import policy as policy_module

        action = _make_action()
        original_rules = list(policy_module.CONTROL_RULES)

        def exploding_rule(a):
            raise RuntimeError("simulated rule failure")

        policy_module.CONTROL_RULES.insert(0, exploding_rule)
        try:
            verdict, trace = svc.evaluate(action)
        finally:
            policy_module.CONTROL_RULES.clear()
            policy_module.CONTROL_RULES.extend(original_rules)

        assert verdict.verdict == "DENY"
        assert verdict.code == VerdictCode.INTERNAL_ERROR

    def test_fail_closed_trace_is_serialisable(self, svc):
        from app.control import policy as policy_module

        action = _make_action()
        original_rules = list(policy_module.CONTROL_RULES)

        def exploding_rule(a):
            raise RuntimeError("boom")

        policy_module.CONTROL_RULES.insert(0, exploding_rule)
        try:
            _, trace = svc.evaluate(action)
        finally:
            policy_module.CONTROL_RULES.clear()
            policy_module.CONTROL_RULES.extend(original_rules)

        audit = trace.to_audit_dict()
        json.dumps(audit)  # must not raise
