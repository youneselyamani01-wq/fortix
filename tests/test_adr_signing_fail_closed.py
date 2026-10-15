"""
Production fails closed without ADR signing configuration.

tests/conftest.py gives every test a deterministic, test-only ADR signing key.
These tests remove it again and check that the runtime never signs without
FORTIX_ADR_SIGNING_PRIVATE_KEY_HEX and FORTIX_ADR_SIGNING_KEY_ID: no embedded
key is used, and the API answers HTTP 503.

A gateway keeps its configuration once it has loaded one, so the gateway check
builds a fresh default gateway, as a process started without the variables
would.
"""
import pytest

from app.core.signing_config import (
    SIGNING_KEY_ID_ENV,
    SIGNING_PRIVATE_KEY_HEX_ENV,
    SigningConfigurationError,
    load_signing_configuration,
)
from app.gateway.action_gateway import build_default_gateway


@pytest.fixture
def no_adr_signing_configuration(monkeypatch):
    monkeypatch.delenv(SIGNING_PRIVATE_KEY_HEX_ENV, raising=False)
    monkeypatch.delenv(SIGNING_KEY_ID_ENV, raising=False)


def test_loader_refuses_to_sign_without_configuration(no_adr_signing_configuration):
    with pytest.raises(SigningConfigurationError) as raised:
        load_signing_configuration()
    assert raised.value.reason_code == "private_key_missing"


def test_default_gateway_refuses_to_sign_without_configuration(no_adr_signing_configuration):
    gateway = build_default_gateway()
    with pytest.raises(SigningConfigurationError) as raised:
        gateway.signing_public_key_hex()
    assert raised.value.reason_code == "private_key_missing"


def test_api_answers_503_without_configuration(client, no_adr_signing_configuration):
    response = client.get("/demo/config")
    assert response.status_code == 503
    assert response.json() == {"detail": "signing_configuration_unavailable"}
