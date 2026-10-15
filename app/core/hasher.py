from blake3 import blake3

def hash_bytes(data: bytes) -> str:
    return blake3(data).hexdigest()