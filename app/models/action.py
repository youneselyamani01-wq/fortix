from pydantic import BaseModel
from typing import Optional

class Action(BaseModel):
    actor_id: str
    action: str
    target: str
    payload_hash: str
    confidence_score: float = 0.0
    contestable: bool = True

class GenerateProofRequest(BaseModel):
    action: Action
