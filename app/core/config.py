from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
PROOFS_DIR = DATA_DIR / "proofs"
LOGS_DIR = DATA_DIR / "logs"

for d in (DATA_DIR, SESSIONS_DIR, PROOFS_DIR, LOGS_DIR):
    d.mkdir(parents=True, exist_ok=True)
