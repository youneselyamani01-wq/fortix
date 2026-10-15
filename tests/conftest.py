"""
Shared pytest fixtures for the FortiX test suite.
"""
import hashlib

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import routes
from app.core.signing_config import SIGNING_KEY_ID_ENV, SIGNING_PRIVATE_KEY_HEX_ENV
from app.policy.engine import InMemoryReplayStateStore


# Test-only ADR signing configuration.
#
# The runtime signs ADR receipts only with FORTIX_ADR_SIGNING_PRIVATE_KEY_HEX and
# FORTIX_ADR_SIGNING_KEY_ID, and fails closed (HTTP 503) without them; see
# app/core/signing_config.py. The suite brings its own key so that it runs on a
# clean clone. This key is a TEST FIXTURE: deterministic, derived from the public
# label below, not a secret, and never to be used outside this test suite.
ADR_TEST_ONLY_KEY_LABEL = b"fortix:test-only:adr-signing-key:v1"
ADR_TEST_ONLY_PRIVATE_KEY_HEX = hashlib.sha256(ADR_TEST_ONLY_KEY_LABEL).hexdigest()
ADR_TEST_ONLY_KEY_ID = "fortix-test-only-adr-signing-key"


@pytest.fixture(autouse=True)
def adr_test_only_signing_configuration(monkeypatch):
    """
    Give each test the deterministic, test-only ADR signing key.

    Any value already in the environment is replaced for the duration of the
    test, so the suite never signs with a real key. Tests of the fail-closed
    path remove both variables again (tests/test_adr_signing_fail_closed.py).
    """
    monkeypatch.setenv(SIGNING_PRIVATE_KEY_HEX_ENV, ADR_TEST_ONLY_PRIVATE_KEY_HEX)
    monkeypatch.setenv(SIGNING_KEY_ID_ENV, ADR_TEST_ONLY_KEY_ID)


@pytest.fixture(scope="session")
def client():
    """Single TestClient for the entire test session."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def fresh_gateway():
    """
    Reset the module-level ActionGateway to a clean state before the test,
    then restore the prior state afterwards.

    Clears both isolation layers:
      - ActionGateway._idempotency_fingerprints  (replay/duplicate guard)
      - PolicyEngine._replay_store._seen_pairs   (InMemoryReplayStateStore)

    Use only when a test submits an action_id that may already be registered
    (e.g. replay detection tests). Other tests use unique action_ids and do
    not require this fixture.
    """
    gw = routes.action_gateway

    saved_fingerprints = dict(gw._idempotency_fingerprints)
    replay_store = gw._policy_engine._replay_store
    saved_pairs = (
        set(replay_store._seen_pairs)
        if isinstance(replay_store, InMemoryReplayStateStore)
        else None
    )

    gw._idempotency_fingerprints.clear()
    if saved_pairs is not None:
        replay_store._seen_pairs.clear()

    yield gw

    gw._idempotency_fingerprints.clear()
    gw._idempotency_fingerprints.update(saved_fingerprints)
    if saved_pairs is not None:
        replay_store._seen_pairs.clear()
        replay_store._seen_pairs.update(saved_pairs)
