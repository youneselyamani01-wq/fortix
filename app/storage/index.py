import json
from pathlib import Path
from typing import Any, Dict, List

from app.core.config import PROOFS_DIR, SESSIONS_DIR

def read_session(session_id: str) -> Dict[str, Any]:
    path = SESSIONS_DIR / f"{session_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))

def list_proofs_by_session(session_id: str) -> List[Dict[str, Any]]:
    proofs = []
    if not PROOFS_DIR.exists():
        return proofs
    for p in PROOFS_DIR.glob("*.json"):
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
            action = obj.get("material", {}).get("action", {})
            if action.get("session_id") == session_id:
                proofs.append(obj)
        except Exception:
            continue
    # sort by timestamp if present
    proofs.sort(key=lambda x: x.get("ts", ""))
    return proofs
