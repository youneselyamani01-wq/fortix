from datetime import UTC, datetime

from fortix_sdk import ActionRequest, FortiXClient


def main() -> None:
    action = ActionRequest(
        action_id="txn-sdk-001",
        actor_id="agent-finops-01",
        action="approve_transfer",
        target="internal",
        timestamp=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        payload={
            "amount": 12000,
            "currency": "EUR",
            "recipient": "counterparty-B",
            "reference": "INV-2026-0010",
        },
        metadata={
            "risk": "low",
            "threshold_check": "pass",
        },
    )

    with FortiXClient("http://127.0.0.1:8000") as client:
        result = client.submit_action(action)

    print("decision:", result.policy.decision)
    print("status:", result.status)
    print("executed:", result.executed)
    print("receipt hash:", result.adr_receipt.hash)


if __name__ == "__main__":
    main()
