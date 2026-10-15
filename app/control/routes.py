"""
FortiX Control Layer — API Routes
====================================
POST /control/evaluate   — fast evaluation (stops at first matching rule)
POST /control/explain    — full evaluation (all rules, full trace)

Both endpoints accept an ActionRequest body and return a ControlEvaluateResponse.
The response schema is identical so callers can switch between modes without
changing their parsing logic.

Advisory status:
    These endpoints are non-authoritative.  They run the same policy rules as
    the gateway but are NOT wired into the gateway processing cycle.

    The single authoritative runtime decision path is:
        POST /action/submit  →  ActionGateway._process()

    Use /control/evaluate and /control/explain for:
    - Diagnostic and dry-run evaluation of policy against a candidate action.
    - Audit trail inspection (explain mode shows all rules, not just the match).
    - Tooling and testing of policy rules in isolation.

    Do NOT use these endpoints as a substitute for submitting an action through
    the gateway if you require an authoritative receipt and audit entry.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.action_request import ActionRequest
from app.control.models import ControlVerdict, DecisionTrace
from app.control.service import ControlService


router = APIRouter(prefix="/control", tags=["control"])
_service = ControlService()


class ControlEvaluateResponse(BaseModel):
    verdict: ControlVerdict
    trace: DecisionTrace


@router.post("/evaluate", response_model=ControlEvaluateResponse)
def control_evaluate(request: ActionRequest) -> ControlEvaluateResponse:
    """
    Evaluate an action request against the FortiX control policy.

    Returns a standardised verdict (ALLOW / DENY / REVIEW) with an explicit
    reason code and a serialisable decision trace.  Stops at the first
    matching rule.  Fails closed — any internal error yields DENY.
    """
    verdict, trace = _service.evaluate(request)
    return ControlEvaluateResponse(verdict=verdict, trace=trace)


@router.post("/explain", response_model=ControlEvaluateResponse)
def control_explain(request: ActionRequest) -> ControlEvaluateResponse:
    """
    Like /evaluate, but evaluates all rules regardless of match order.

    The trace.rules_evaluated list will contain an entry for every rule in the
    policy chain, making this endpoint suitable for audit review and debugging.
    """
    verdict, trace = _service.explain(request)
    return ControlEvaluateResponse(verdict=verdict, trace=trace)
