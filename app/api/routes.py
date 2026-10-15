from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from uuid import uuid4

from app.core.utils import utc_now_iso
from app.core.adr_verify import verify_adr
from app.core.signing_config import load_signing_configuration
from app.api.pilot import router as pilot_router
from app.gateway.action_gateway import build_default_gateway
from app.models.action_request import ActionRequest
from app.models.adr_receipt import ADRVerifyRequest
from app.services.proof_engine import generate_proof, verify_proof
from app.storage.fs_store import (
    append_log,
    read_logs,
    read_proof,
    save_proof,
    save_session,
)

router = APIRouter()
router.include_router(pilot_router)
action_gateway = build_default_gateway()

class IdentityMockIn(BaseModel):
    actor_name: str = Field(default="demo-user")
    assurance_level: str = Field(default="demo")

class ActionInitIn(BaseModel):
    session_id: str
    actor_id: str
    action_type: str = Field(default="payment")
    amount: float = Field(default=42.0)
    currency: str = Field(default="EUR")
    context: dict = Field(default_factory=dict)

@router.post("/identity/mock")
def identity_mock(payload: IdentityMockIn):
    actor_id = str(uuid4())
    session_id = str(uuid4())
    session = {
        "session_id": session_id,
        "actor_id": actor_id,
        "actor_name": payload.actor_name,
        "assurance_level": payload.assurance_level,
        "created_at": utc_now_iso(),
        "status": "active",
    }
    save_session(session_id, session)
    append_log(session_id, {"ts": utc_now_iso(), "event": "IDENTITY_MOCK", "data": session})
    return session

@router.post("/action/init")
def action_init(payload: ActionInitIn):
    action_id = str(uuid4())
    action = {
        "action_id": action_id,
        "session_id": payload.session_id,
        "actor_id": payload.actor_id,
        "action_type": payload.action_type,
        "amount": payload.amount,
        "currency": payload.currency,
        "context": payload.context,
        "created_at": utc_now_iso(),
        "status": "initialized",
    }
    append_log(payload.session_id, {"ts": utc_now_iso(), "event": "ACTION_INIT", "data": action})
    return action

@router.post("/proof/generate")
def proof_generate(payload: dict):
    # Accept both shapes:
    # 1) flat: {"actor_id":..., "action":..., "target":..., ... , "session_id":...}
    # 2) wrapped: {"session_id":..., "action": {...same fields...}}
    if not isinstance(payload, dict) or len(payload) == 0:
        raise HTTPException(status_code=422, detail="Body must be a non-empty JSON object.")

    session_id = payload.get("session_id", "unknown-session")

    # Wrapped form
    if isinstance(payload.get("action"), dict):
        action = payload["action"].copy()
    else:
        # Flat form
        action = payload.copy()
        action.pop("session_id", None)

    # Minimal validation to avoid empty action {}
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


@router.post("/proof/verify")
def proof_verify(payload: dict):
    if "proof_id" in payload and len(payload.keys()) == 1:
        proof = read_proof(payload["proof_id"])
    else:
        proof = payload
    result = verify_proof(proof)
    return {"result": result}

@router.get("/proof/{proof_id}")
def proof_get(proof_id: str):
    try:
        return read_proof(proof_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Proof not found")

@router.get("/logs/session/{session_id}")
def logs_session(session_id: str):
    return {"session_id": session_id, "logs": read_logs(session_id)}

@router.get("/receipt/{proof_id}")
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

@router.get("/session/export/{session_id}")
def session_export(session_id: str):
    # session
    from app.storage.index import read_session, list_proofs_by_session

    session = read_session(session_id)
    logs = read_logs(session_id)
    proofs = list_proofs_by_session(session_id)

    # derive actions from logs
    actions = []
    for e in logs:
        if e.get("event") == "ACTION_INIT":
            actions.append(e.get("data"))

    # create receipt summaries for proofs
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


@router.post("/action/submit")
def action_submit(payload: ActionRequest):
    return action_gateway.submit_action(payload)


@router.post("/action/review")
def action_review(payload: ActionRequest):
    return action_gateway.review_action(payload)


@router.post("/adr/verify")
def adr_verify(payload: ADRVerifyRequest):
    is_valid = verify_adr(
        receipt=payload.receipt.model_dump(),
        public_key_hex=payload.public_key_hex,
    )
    return {"valid": is_valid}


# ---------------------------------------------------------------------------
# Demo routes (Phase 5)
# ---------------------------------------------------------------------------

_DEMO_HTML     = Path(__file__).parent.parent.parent / "demo" / "index.html"
_SEQUENCE_HTML = Path(__file__).parent.parent.parent / "demo" / "sequence.html"


@router.get("/demo", response_class=HTMLResponse)
def demo_ui():
    """Serve the single-file demo UI."""
    if not _DEMO_HTML.exists():
        raise HTTPException(status_code=404, detail="Demo UI not found.")
    return HTMLResponse(content=_DEMO_HTML.read_text(encoding="utf-8"))


@router.get("/sequence", response_class=HTMLResponse)
def sequence_ui():
    """Serve the static demonstration sequence (frozen data, no runtime fetch)."""
    if not _SEQUENCE_HTML.exists():
        raise HTTPException(status_code=404, detail="Sequence UI not found.")
    return HTMLResponse(content=_SEQUENCE_HTML.read_text(encoding="utf-8"))


@router.get("/demo/config")
def demo_config():
    """Return the configured public key and key identifier."""
    configuration = load_signing_configuration()
    return {
        "public_key_hex": configuration.public_key_hex,
        "key_id": configuration.key_id,
    }
