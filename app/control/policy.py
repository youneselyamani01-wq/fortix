"""
FortiX Control Layer — Policy Rules
=====================================
Pure, stateless rule functions.  Each rule receives an ActionRequest and
returns a RuleResult indicating whether it matched and, if so, what verdict
and reason code to apply.

Rules are ordered; the evaluation chain stops at the first match (evaluate
mode) or runs all rules (explain mode).  Default is ALLOW/OK.

Adding a new rule: append a function following the RuleResult contract and
add it to CONTROL_RULES.  Do not mutate CONTROL_RULES at runtime.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from app.models.action_request import ActionRequest
from app.control.models import VerdictCode


POLICY_VERSION = "control-v1"

# Minimal ISO 8601 datetime pattern — matches the same surface as GatewayVerifier.
# Seconds required; fractional seconds optional; Z or numeric offset required.
_ISO8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)


@dataclass(frozen=True)
class RuleResult:
    rule: str
    matched: bool
    verdict: Literal["ALLOW", "DENY", "REVIEW"] | None = None
    code: VerdictCode | None = None


# ---------------------------------------------------------------------------
# Individual rules
# ---------------------------------------------------------------------------

def rule_timestamp_present(action: ActionRequest) -> RuleResult:
    """
    DENY when the action timestamp is absent, blank, or not ISO 8601.

    Two distinct codes:
      TIMESTAMP_MISSING — empty or whitespace-only string.
      TIMESTAMP_INVALID — non-empty but does not match ISO 8601 format.

    The format check mirrors the pattern used by GatewayVerifier so that
    advisory control evaluation and gateway-level validation are consistent.
    """
    timestamp = (action.timestamp or "").strip()
    if not timestamp:
        return RuleResult(
            rule="timestamp_present",
            matched=True,
            verdict="DENY",
            code=VerdictCode.TIMESTAMP_MISSING,
        )
    if not _ISO8601_RE.match(timestamp):
        return RuleResult(
            rule="timestamp_present",
            matched=True,
            verdict="DENY",
            code=VerdictCode.TIMESTAMP_INVALID,
        )
    return RuleResult(rule="timestamp_present", matched=False)


def rule_external_transfer(action: ActionRequest) -> RuleResult:
    """
    DENY external transfers that have not been explicitly review-approved.

    An action qualifies when:
      - action == "transfer"
      - target == "external"
      - metadata.review_approved is not exactly True
    """
    is_external_transfer = (
        action.action == "transfer" and action.target == "external"
    )
    review_approved = action.metadata.get("review_approved") is True
    if is_external_transfer and not review_approved:
        return RuleResult(
            rule="external_transfer",
            matched=True,
            verdict="DENY",
            code=VerdictCode.EXTERNAL_TRANSFER_BLOCKED,
        )
    return RuleResult(rule="external_transfer", matched=False)


def rule_high_risk(action: ActionRequest) -> RuleResult:
    """REVIEW when metadata.risk == "high"."""
    if action.metadata.get("risk") == "high":
        return RuleResult(
            rule="high_risk",
            matched=True,
            verdict="REVIEW",
            code=VerdictCode.HIGH_RISK_ESCALATION,
        )
    return RuleResult(rule="high_risk", matched=False)


# ---------------------------------------------------------------------------
# Ordered evaluation chain — first match wins in evaluate mode.
# ---------------------------------------------------------------------------
CONTROL_RULES = [
    rule_timestamp_present,
    rule_external_transfer,
    rule_high_risk,
]
