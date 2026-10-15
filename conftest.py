from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest


@pytest.fixture
def tmp_path(request):
    base = Path(__file__).resolve().parent / "test_tmp"
    base.mkdir(exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", request.node.nodeid)[:80]
    path = base / f"{safe_name}_{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    return path
