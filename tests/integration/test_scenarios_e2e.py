"""
End-to-end integration tests for the three demo scenarios plus replay detection.

Tests the full HTTP path: POST /action/submit → gateway → policy → ADR receipt.
Verifies the receipt loop via POST /adr/verify.
Verifies frozen reference data (remotion-props-reference.json) still verifies.

action_ids use the 'txn-e2e-' prefix; never overlap with txn-demo-* IDs.
"""
from tests.integration.fixtures_demo import (
    ALLOW_SUBMIT,
    DENY_SUBMIT,
    FROZEN_ALLOW_RECEIPT,
    FROZEN_PUBLIC_KEY_HEX,
    REPLAY_SUBMIT,
    REVIEW_SUBMIT,
    VERIFY_SUBMIT,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _assert_receipt(receipt: dict) -> None:
    for field in ("version", "payload", "hash", "signature", "algorithm", "key_id"):
        assert field in receipt, f"receipt missing field: {field}"
    assert receipt["version"] == "1.0"
    assert len(receipt["hash"]) == 64
    assert len(receipt["signature"]) > 0
    assert receipt["algorithm"]["hash"] == "BLAKE3"
    assert receipt["algorithm"]["signature"] == "Ed25519"


# ── POST /action/submit ───────────────────────────────────────────────────────

def test_allow_path(client):
    r = client.post("/action/submit", json=ALLOW_SUBMIT)
    assert r.status_code == 200
    d = r.json()
    assert d["policy"]["decision"] == "ALLOW"
    assert d["policy"]["reason"] == "ok"
    assert d["executed"] is True
    assert d["status"] == "executed"
    _assert_receipt(d["adr_receipt"])


def test_review_path(client):
    r = client.post("/action/submit", json=REVIEW_SUBMIT)
    assert r.status_code == 200
    d = r.json()
    assert d["policy"]["decision"] == "REVIEW"
    assert d["policy"]["reason"] == "high_risk_requires_review"
    assert d["executed"] is False
    assert d["status"] == "pending_review"
    _assert_receipt(d["adr_receipt"])


def test_deny_external(client):
    r = client.post("/action/submit", json=DENY_SUBMIT)
    assert r.status_code == 200
    d = r.json()
    assert d["policy"]["decision"] == "DENY"
    assert d["policy"]["reason"] == "external_transfer_requires_review_approved"
    assert d["executed"] is False
    assert d["status"] == "blocked_by_policy"
    _assert_receipt(d["adr_receipt"])


def test_replay_detection(client, fresh_gateway):
    """
    First submit (low-risk internal) → ALLOW.
    Second submit with identical action_id and payload → DENY / replay_detected.
    fresh_gateway ensures the action_id is unregistered at test start.
    """
    r1 = client.post("/action/submit", json=REPLAY_SUBMIT)
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["policy"]["decision"] == "ALLOW"
    assert d1["executed"] is True

    r2 = client.post("/action/submit", json=REPLAY_SUBMIT)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["policy"]["decision"] == "DENY"
    assert d2["policy"]["reason"] == "replay_detected"
    assert d2["executed"] is False
    assert d2["status"] == "blocked_by_replay_protection"


# ── POST /adr/verify ──────────────────────────────────────────────────────────

def test_e2e_submit_then_verify(client):
    """Submit an action, extract the receipt, verify it via /adr/verify."""
    r = client.post("/action/submit", json=VERIFY_SUBMIT)
    assert r.status_code == 200
    receipt = r.json()["adr_receipt"]

    config = client.get("/demo/config").json()
    public_key_hex = config["public_key_hex"]

    rv = client.post("/adr/verify", json={
        "receipt": receipt,
        "public_key_hex": public_key_hex,
    })
    assert rv.status_code == 200
    assert rv.json()["valid"] is True


def test_adr_verify_frozen_allow(client):
    """
    The frozen ALLOW receipt from remotion-props-reference.json must verify
    against its reference public key (demo-key-001).
    Confirms that the reference props file remains consistent with the verifier.
    """
    rv = client.post("/adr/verify", json={
        "receipt": FROZEN_ALLOW_RECEIPT,
        "public_key_hex": FROZEN_PUBLIC_KEY_HEX,
    })
    assert rv.status_code == 200
    assert rv.json()["valid"] is True
