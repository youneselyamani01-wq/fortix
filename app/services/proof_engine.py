from typing import Any, Dict
from uuid import uuid4
import hashlib

from app.core.utils import canonical_json, sha256_hex, utc_now_iso
from app.core.signer import sign_hash
from app.core.signing_config import SigningConfiguration, load_signing_configuration
from app.core.receipt import generate_receipt


def generate_proof(
    action_payload: Dict[str, Any],
    *,
    signing_configuration: SigningConfiguration | None = None,
) -> Dict[str, Any]:
    """
    Build an append-only proof object:
    - material: canonical data to be hashed
    - digest: SHA-256(canonical_json(material))
    - event_hash: SHA-256(canonical_json(material)) (same as digest for now)
    - signature: Ed25519 signature over event_hash using required runtime config
    - receipt: structured receipt (action + hashes + signature)
    """
    if signing_configuration is None:
        signing_configuration = load_signing_configuration()

    proof_id = str(uuid4())
    ts = utc_now_iso()

    material: Dict[str, Any] = {
        "ts": ts,
        "action": action_payload,
    }

    # Stable digest (canonical)
    digest = sha256_hex(canonical_json(material))

    # Event hash (kept explicit for future chaining / ledger)
    event_hash = hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()

    # Signature (implementation in app.core.signer)
    signature = sign_hash(event_hash, signing_configuration.private_key_hex)

    # Receipt (implementation in app.core.receipt)
    receipt = generate_receipt(material.get("action", {}), event_hash, signature)

    return {
        "proof_id": proof_id,
        "ts": ts,
        "algo": "SHA-256(canonical_json({ts,action}))",
        "digest": digest,
        "event_hash": event_hash,
        "signature": signature,
        "receipt": receipt,
        "action_ref": action_payload.get("action_id"),
        "material": material,
    }


def verify_proof(proof: Dict[str, Any]) -> Dict[str, Any]:
    material = proof.get("material", {})
    expected = proof.get("digest")

    recomputed = sha256_hex(canonical_json(material))
    valid_digest = (recomputed == expected)

    # This legacy proof verifier validates digest consistency only.
    # ADR signature verification is implemented by the dedicated ADR verifier.
    return {
        "valid": bool(valid_digest),
        "recomputed": recomputed,
        "expected": expected,
        "checks": {
            "digest_match": bool(valid_digest),
        },
    }
