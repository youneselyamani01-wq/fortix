def generate_receipt(action: dict, event_hash: str, signature: str) -> dict:
    return {
        "summary": f'{action.get("actor_id")} performed {action.get("action")} on {action.get("target")}',
        "confidence_score": action.get("confidence_score", 0.0),
        "contestable": action.get("contestable", True),
        "event_hash": event_hash,
        "signature": signature,
    }
