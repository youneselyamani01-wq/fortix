from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HumanReview(BaseModel):
    """Explicit record of a manual review action."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    review_id: str = Field(..., min_length=1)
    review_role: str = Field(..., min_length=1)
    reviewer_id: str = Field(..., min_length=1)
    outcome: Literal["approved", "rejected"]
    justification: str = Field(..., min_length=1)
    timestamp: str = Field(..., min_length=1)
