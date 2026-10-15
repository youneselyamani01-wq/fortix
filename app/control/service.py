"""
FortiX Control Layer — Control Service
========================================
ControlService is the single entry point for evaluating an ActionRequest
against the control policy.

Properties:
  - Stateless: no side effects, no global state.
  - Deterministic: identical inputs produce identical verdicts (trace_id and
    evaluated_at differ by design; verdict/code are deterministic).
  - Fail-closed: any unexpected exception returns DENY/INTERNAL_ERROR.
  - Two evaluation modes:
      evaluate()  — stop at first matching rule (fast path, production).
      explain()   — run all rules, return full trace (audit/debug path).
"""
from __future__ import annotations

import uuid

from app.models.action_request import ActionRequest
from app.core.utils import utc_now_iso
from app.control.models import (
    ControlVerdict,
    DecisionTrace,
    RuleTrace,
    VerdictCode,
)
from app.control.policy import CONTROL_RULES, POLICY_VERSION, RuleResult


_VERDICT_MESSAGES: dict[VerdictCode, str] = {
    VerdictCode.OK: "Action is permitted.",
    VerdictCode.TIMESTAMP_MISSING: (
        "Request denied: timestamp is missing or blank."
    ),
    VerdictCode.TIMESTAMP_INVALID: (
        "Request denied: timestamp is not a valid ISO 8601 datetime string."
    ),
    VerdictCode.EXTERNAL_TRANSFER_BLOCKED: (
        "Request denied: external transfer requires explicit review approval."
    ),
    VerdictCode.HIGH_RISK_ESCALATION: (
        "Request escalated for manual review: action is flagged high-risk."
    ),
    VerdictCode.INTERNAL_ERROR: (
        "Request denied: internal evaluation error (fail-closed)."
    ),
}


def _make_verdict(verdict_str: str, code: VerdictCode) -> ControlVerdict:
    return ControlVerdict(
        verdict=verdict_str,  # type: ignore[arg-type]
        code=code,
        message=_VERDICT_MESSAGES.get(code, f"{verdict_str}: {code.value}"),
    )


class ControlService:
    """
    Evaluates ActionRequest objects against the FortiX control policy.

    Usage::

        svc = ControlService()
        verdict, trace = svc.evaluate(action_request)
        audit_record = trace.to_audit_dict()
    """

    def evaluate(
        self, action: ActionRequest
    ) -> tuple[ControlVerdict, DecisionTrace]:
        """
        Fast-path evaluation: stop at first matching rule.

        Returns (verdict, trace). Never raises — fails closed on exception.
        """
        try:
            return self._run(action, explain=False)
        except Exception:
            return self._fail_closed(action)

    def explain(
        self, action: ActionRequest
    ) -> tuple[ControlVerdict, DecisionTrace]:
        """
        Full-trace evaluation: all rules are evaluated regardless of match.

        Returns (verdict, trace). Never raises — fails closed on exception.
        """
        try:
            return self._run(action, explain=True)
        except Exception:
            return self._fail_closed(action)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run(
        self, action: ActionRequest, explain: bool
    ) -> tuple[ControlVerdict, DecisionTrace]:
        evaluated_at = utc_now_iso()
        trace_id = str(uuid.uuid4())
        results: list[RuleResult] = []
        winning: RuleResult | None = None

        for rule_fn in CONTROL_RULES:
            result = rule_fn(action)
            results.append(result)
            if result.matched and winning is None:
                winning = result
                if not explain:
                    break  # fast path: stop at first match

        if winning is not None:
            assert winning.verdict is not None  # rule contract
            assert winning.code is not None
            verdict = _make_verdict(winning.verdict, winning.code)
        else:
            verdict = _make_verdict("ALLOW", VerdictCode.OK)

        trace = DecisionTrace(
            trace_id=trace_id,
            action_id=action.action_id,
            actor_id=action.actor_id,
            evaluated_at=evaluated_at,
            policy_version=POLICY_VERSION,
            verdict=verdict,
            rules_evaluated=[
                RuleTrace(
                    rule=r.rule,
                    matched=r.matched,
                    verdict=r.verdict,
                    code=r.code,
                )
                for r in results
            ],
        )
        return verdict, trace

    def _fail_closed(
        self, action: ActionRequest
    ) -> tuple[ControlVerdict, DecisionTrace]:
        verdict = _make_verdict("DENY", VerdictCode.INTERNAL_ERROR)
        trace = DecisionTrace(
            trace_id=str(uuid.uuid4()),
            action_id=action.action_id,
            actor_id=action.actor_id,
            evaluated_at=utc_now_iso(),
            policy_version=POLICY_VERSION,
            verdict=verdict,
            rules_evaluated=[],
        )
        return verdict, trace
