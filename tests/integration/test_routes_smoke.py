"""
Smoke tests for the static and config GET routes.

Covers: GET /demo, GET /sequence, GET /demo/config.
Asserts HTTP status, content-type, and minimal structural markers only.
"""


def test_demo_ui_200(client):
    r = client.get("/demo")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "FortiX" in r.text


def test_sequence_ui_200(client):
    r = client.get("/sequence")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "FortiX" in r.text
    assert "ADR v1.0" in r.text


def test_demo_config_shape(client):
    r = client.get("/demo/config")
    assert r.status_code == 200
    data = r.json()
    assert "public_key_hex" in data
    assert len(data["public_key_hex"]) == 64
    assert all(c in "0123456789abcdef" for c in data["public_key_hex"])
    assert "key_id" in data
    assert data["key_id"] != ""
