"""
ADR canonical serialisation.

Rule: json.dumps with sort_keys=True, no spaces, UTF-8 encoding.
NaN/Infinity are forbidden (allow_nan=False raises ValueError on encounter).
"""
import json


def canonicalize(payload: dict) -> bytes:
    """Return the canonical UTF-8 JSON encoding of *payload*.

    Raises:
        TypeError:  if *payload* is not a dict.
        ValueError: if *payload* contains NaN or Infinity.
    """
    if not isinstance(payload, dict):
        raise TypeError(f"payload must be a dict, got {type(payload).__name__}")
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
