"""
LEGACY — Pre-ADR proof system. NOT ADR v1-compliant.

These routes use SHA-256 + HMAC signing, NOT BLAKE3 + Ed25519.
They do NOT produce ADR v1 receipts. They are preserved for backward
compatibility with the demo session UI and existing stored proofs.

DO NOT use these routes as a reference for ADR v1 behaviour.
ADR v1 action routes: /action/submit, /action/review.
Verification: POST /verify/receipt (primary) or POST /adr/verify (legacy thin endpoint).
"""
from fastapi import APIRouter, HTTPException

from app.core.utils import utc_now_iso
from app.services.proof_engine import generate_proof, verify_proof
from app.storage.fs_store import append_log, read_logs, read_proof, save_proof

legacy_router = APIRouter(tags=["legacy-pre-adr"])


@legacy_router.post("/proof/generate")
def proof_generate(payload: dict):
    # Accept both shapes:
    # 1) flat: {"actor_id":..., "action":..., "target":..., ... , "session_id":...}
    # 2) wrapped: {"session_id":..., "action": {...same fields...}}
    if not isinstance(payload, dict) or len(payload) == 0:
        raise HTTPException(status_code=422, detail="Body must be a non-empty JSON object.")

    session_id = payload.get("session_id", "unknown-session")

    if isinstance(payload.get("action"), dict):
        action = payload["action"].copy()
    else:
        action = payload.copy()
        action.pop("session_id", None)

    if not action or not action.get("actor_id") or not action.get("action") or not action.get("target"):
        raise HTTPException(
            status_code=422,
            detail="Missing required fields. Expected actor_id, action, target (and optionally payload_hash, confidence_score, contestable)."
        )

    proof = generate_proof(action)
    save_proof(proof["proof_id"], proof)
    append_log(
        session_id,
        {"ts": utc_now_iso(), "event": "PROOF_GENERATED", "data": {"proof_id": proof["proof_id"]}},
    )
    return proof


@legacy_router.post("/proof/verify")
def proof_verify(payload: dict):
    if "proof_id" in payload and len(payload.keys()) == 1:
        proof = read_proof(payload["proof_id"])
    else:
        proof = payload
    result = verify_proof(proof)
    return {"result": result}


@legacy_router.get("/proof/{proof_id}")
def proof_get(proof_id: str):
    try:
        return read_proof(proof_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Proof not found")


@legacy_router.get("/receipt/{proof_id}")
def receipt_get(proof_id: str):
    proof = read_proof(proof_id)
    action = proof.get("material", {}).get("action", {})
    return {
        "proof_id": proof.get("proof_id"),
        "ts": proof.get("ts"),
        "session_id": action.get("session_id"),
        "actor_id": action.get("actor_id", "unknown"),
        "action_type": action.get("action_type", "unknown"),
        "amount": action.get("amount", None),
        "currency": action.get("currency", None),
        "digest": proof.get("digest"),
        "algo": proof.get("algo"),
    }


@legacy_router.get("/session/export/{session_id}")
def session_export(session_id: str):
    from app.storage.index import read_session, list_proofs_by_session

    session = read_session(session_id)
    logs = read_logs(session_id)
    proofs = list_proofs_by_session(session_id)

    actions = []
    for e in logs:
        if e.get("event") == "ACTION_INIT":
            actions.append(e.get("data"))

    receipts = []
    for pr in proofs:
        action = pr.get("material", {}).get("action", {})
        receipts.append({
            "proof_id": pr.get("proof_id"),
            "ts": pr.get("ts"),
            "actor_id": action.get("actor_id"),
            "action_type": action.get("action_type"),
            "amount": action.get("amount"),
            "currency": action.get("currency"),
            "digest": pr.get("digest"),
        })

    return {
        "session": session,
        "timeline": logs,
        "actions": actions,
        "proofs": proofs,
        "receipts": receipts,
        "counts": {
            "timeline": len(logs),
            "actions": len(actions),
            "proofs": len(proofs),
        },
    }
