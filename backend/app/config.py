from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PREPARED = ROOT / "prepared"
FRONTEND_DIST = ROOT / "frontend" / "dist"
DB_PATH = Path(os.environ.get("FLOWSCOPE_DB", ROOT / "backend" / "runs.db"))
