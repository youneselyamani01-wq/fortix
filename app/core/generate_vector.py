import json
import os
import binascii
from blake3 import blake3
from nacl.signing import SigningKey
from app.core.canonicalizer import canonicalize

payload = {
    "action": "test",
    "actor": "fortix-core",
    "timestamp": "2026-03-11T15:00:00Z"
}

canonical = canonicalize(payload)
hash_hex = blake3(canonical).hexdigest()

signing_key = SigningKey.generate()
verify_key = signing_key.verify_key
signature = signing_key.sign(hash_hex.encode("utf-8")).signature

vector = {
    "payload": payload,
    "hash": hash_hex,
    "signature": binascii.hexlify(signature).decode(),
    "public_key": binascii.hexlify(verify_key.encode()).decode(),
    "algorithm": {
        "hash": "BLAKE3",
        "signature": "Ed25519"
    }
}

base_dir = os.path.dirname(os.path.abspath(__file__))
vector_path = os.path.join(base_dir, "tests", "vectors", "vector_001.json")

with open(vector_path, "w", encoding="utf-8") as f:
    json.dump(vector, f, indent=2)

print("Vector generated at:", vector_path)