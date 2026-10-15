from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Body

from app.action_control.models import ActionControlIntent, ActionControlResponse
from app.action_control.service import ActionControlService
from app.core.utils import utc_now_iso


router = APIRouter(prefix="/action-control", tags=["action-control"])
_service = ActionControlService()


@router.post("/intent", response_model=ActionControlResponse)
def submit_intent(intent: ActionControlIntent) -> ActionControlResponse:
    return _service.submit_intent(intent)


@router.post("/demo", response_model=ActionControlResponse)
def submit_demo(
    intent: ActionControlIntent | None = Body(default=None),
) -> ActionControlResponse:
    if intent is None:
        intent = ActionControlIntent(
            action="payment.submit",
            actor="claude_worker",
            amount=250000,
            currency="EUR",
            destination="AE",
            timestamp=utc_now_iso(),
            action_id=f"demo-auto-generated-{uuid4()}",
        )
    return submit_intent(intent)
