import json
import os
from pathlib import Path

from fortix_sdk import ADRReceipt, FortiXClient


def main() -> None:
    receipt_path = Path("receipt.json")
    public_key_hex = os.environ["FORTIX_PUBLIC_KEY_HEX"]

    receipt = ADRReceipt.model_validate(json.loads(receipt_path.read_text(encoding="utf-8")))

    with FortiXClient("http://127.0.0.1:8000") as client:
        result = client.verify_receipt(receipt, public_key_hex=public_key_hex)

    print("status:", result.status)
    print("code:", result.code)
    print("verdict:", result.institutional.verdict)
    print("detail:", result.institutional.explanation)


if __name__ == "__main__":
    main()
