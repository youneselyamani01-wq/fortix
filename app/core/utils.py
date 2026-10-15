import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def canonical_json(obj: Dict[str, Any]) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
