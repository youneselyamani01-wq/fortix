import json
from pathlib import Path
from typing import Any, Dict

from app.core.config import LOGS_DIR, PROOFS_DIR, SESSIONS_DIR

def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

def save_session(session_id: str, payload: Dict[str, Any]) -> Path:
    path = SESSIONS_DIR / f"{session_id}.json"
    _write_json(path, payload)
    return path

def save_proof(proof_id: str, payload: Dict[str, Any]) -> Path:
    path = PROOFS_DIR / f"{proof_id}.json"
    _write_json(path, payload)
    return path

def append_log(session_id: str, payload: Dict[str, Any]) -> Path:
    path = LOGS_DIR / f"{session_id}.log.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return path

def read_proof(proof_id: str) -> Dict[str, Any]:
    path = PROOFS_DIR / f"{proof_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))

def read_logs(session_id: str) -> list[Dict[str, Any]]:
    path = LOGS_DIR / f"{session_id}.log.jsonl"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]
