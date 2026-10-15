from typing import Any

from pydantic import BaseModel, Field


class ActionRequest(BaseModel):
    action_id: str = Field(..., min_length=1)
    actor_id: str = Field(..., min_length=1)
    action: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    timestamp: str = Field(..., min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
