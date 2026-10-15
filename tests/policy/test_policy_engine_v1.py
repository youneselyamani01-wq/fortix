from __future__ import annotations

from app.models.action_request import ActionRequest
from app.models.adr_receipt import ADRAlgorithm, ADRReceipt
from app.policy.engine import PolicyEngine


def _receipt() -> ADRReceipt:
    return ADRReceipt(
        version="1.0",
        payload={"action_id": "pol-001"},
        hash="a" * 64,
        signature="b" * 128,
        algorithm=ADRAlgorithm(hash="BLAKE3", signature="Ed25519"),
        key_id="test-key-001",
    )


def _action(**overrides) -> ActionRequest:
    payload = {
        "action_id": "pol-001",
        "actor_id": "actor-001",
        "action": "approve_transfer",
        "target": "internal",
        "timestamp": "2026-04-23T10:00:00Z",
        "payload": {"amount": 5000, "currency": "EUR"},
        "metadata": {"risk": "low"},
    }
    payload.update(overrides)
    return ActionRequest(**payload)


def _assert_required_policy_fields(decision) -> None:
    data = decision.to_response_dict()
    for field in (
        "status",
        "reason_code",
        "reason_text",
        "policy_id",
        "policy_version",
        "requires_human",
        "overrideable",
        "risk_level",
        "triggered_rules",
        "human_review",
    ):
        assert field in data
    assert data["policy_id"] == "fortix-policy-v1"
    assert data["policy_version"] == "1.0.0"


def test_unauthorized_actor_blocks_and_is_not_overrideable() -> None:
    engine = PolicyEngine()
    decision = engine.evaluate(
        _action(metadata={"actor_authorized": False, "risk": "low"}),
        _receipt(),
    )

    _assert_required_policy_fields(decision)
    assert decision.status == "block"
    assert decision.reason_code == "BLOCK_UNAUTHORIZED_ACTOR"
    assert decision.requires_human is False
    assert decision.overrideable is False
    assert decision.human_review is None


def test_sanctions_hit_blocks_and_is_not_overrideable() -> None:
    engine = PolicyEngine()
    decision = engine.evaluate(
        _action(metadata={"sanctions_hit": True, "risk": "low"}),
        _receipt(),
    )

    _assert_required_policy_fields(decision)
    assert decision.status == "block"
    assert decision.reason_code == "BLOCK_SANCTIONS_HIT"
    assert decision.requires_human is False
    assert decision.overrideable is False
    assert decision.risk_level == "critical"


def test_critical_risk_blocks_and_is_not_overrideable() -> None:
    engine = PolicyEngine()
    decision = engine.evaluate(
        _action(metadata={"risk_level": "critical"}),
        _receipt(),
    )

    _assert_required_policy_fields(decision)
    assert decision.status == "block"
    assert decision.reason_code == "BLOCK_CRITICAL_RISK"
    assert decision.requires_human is False
    assert decision.overrideable is False
    assert decision.risk_level == "critical"


def test_high_aml_score_without_hard_hit_requires_review() -> None:
    engine = PolicyEngine()
    decision = engine.evaluate(
        _action(metadata={"aml_score": 92, "risk": "medium"}),
        _receipt(),
    )

    _assert_required_policy_fields(decision)
    assert decision.status == "require_review"
    assert decision.reason_code == "REVIEW_AML_SCORE_HIGH"
    assert decision.requires_human is True
    assert decision.overrideable is False


def test_amount_above_threshold_requires_review() -> None:
    engine = PolicyEngine()
    decision = engine.evaluate(
        _action(payload={"amount": 250000, "currency": "EUR"}, metadata={"risk": "medium"}),
        _receipt(),
    )

    _assert_required_policy_fields(decision)
    assert decision.status == "require_review"
    assert decision.reason_code == "REVIEW_AMOUNT_ABOVE_THRESHOLD"
    assert decision.requires_human is True
    assert decision.overrideable is False


def test_clean_low_risk_verified_action_allows() -> None:
    engine = PolicyEngine()
    decision = engine.evaluate(
        _action(metadata={"risk": "low", "identity_verified": True}),
        _receipt(),
    )

    _assert_required_policy_fields(decision)
    assert decision.status == "allow"
    assert decision.reason_code == "ALLOW_LOW_RISK_VERIFIED"
    assert decision.requires_human is False
    assert decision.overrideable is False
    assert decision.risk_level == "low"


def test_evaluate_never_emits_override() -> None:
    engine = PolicyEngine()

    decisions = [
        engine.evaluate(_action(metadata={"risk": "low"}), _receipt()),
        engine.evaluate(_action(metadata={"aml_score": 91}), _receipt()),
        engine.evaluate(_action(metadata={"sanctions_hit": True}), _receipt()),
    ]

    assert all(decision.status != "override" for decision in decisions)
    assert all(decision.human_review is None for decision in decisions)
