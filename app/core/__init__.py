import hashlib
import json


def canonical_json(obj: dict) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def compute_event_hash(material: dict) -> str:
    return sha256_hex(canonical_json(material))


def sign_hash(event_hash: str, private_key_hex: str | None = None) -> str:
    from app.core.signer import sign_hash as sign_ed25519

    if private_key_hex is None:
        from app.core.signing_config import load_signing_configuration

        private_key_hex = load_signing_configuration().private_key_hex
    return sign_ed25519(event_hash, private_key_hex)


def generate_receipt(action: dict, event_hash: str, signature: str) -> dict:
    return {
        "summary": f'{action.get("actor_id")} performed {action.get("action")} on {action.get("target")}',
        "confidence_score": action.get("confidence_score", 0.0),
        "contestable": action.get("contestable", True),
        "event_hash": event_hash,
        "signature": signature,
    }
