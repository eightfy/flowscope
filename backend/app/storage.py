from __future__ import annotations

import json
import sqlite3
import threading
import time
from datetime import datetime
from typing import Any

from .config import DB_PATH


class RunStore:
    def __init__(self, path=DB_PATH):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                created_at TEXT,
                dataset TEXT,
                region_id TEXT,
                region_label TEXT,
                algorithm TEXT,
                algorithm_name TEXT,
                input_len INTEGER,
                output_len INTEGER,
                duration REAL,
                metrics TEXT,
                config TEXT,
                result TEXT
            )
            """
        )
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC)")
        self._conn.commit()

    def save(self, run_id: str, result: dict[str, Any], algorithm_name: str, duration: float):
        cfg = result.get("config", {})
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    run_id,
                    datetime.now().isoformat(timespec="seconds"),
                    result.get("dataset"),
                    result.get("region"),
                    result.get("regionLabel"),
                    result.get("algorithm"),
                    algorithm_name,
                    cfg.get("input_len"),
                    cfg.get("output_len"),
                    round(duration, 3),
                    json.dumps(result.get("metrics", {}), ensure_ascii=False),
                    json.dumps(cfg, ensure_ascii=False),
                    json.dumps(result, ensure_ascii=False),
                ),
            )
            self._conn.commit()

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, created_at, dataset, region_id, region_label, algorithm, algorithm_name, "
                "input_len, output_len, duration, metrics FROM runs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "id": r[0],
                    "createdAt": r[1],
                    "dataset": r[2],
                    "region": r[3],
                    "regionLabel": r[4],
                    "algorithm": r[5],
                    "algorithmName": r[6],
                    "inputLen": r[7],
                    "outputLen": r[8],
                    "duration": r[9],
                    "metrics": json.loads(r[10] or "{}"),
                }
            )
        return out

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT result FROM runs WHERE id = ?", (run_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def delete(self, run_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM runs WHERE id = ?", (run_id,))
            self._conn.commit()
        return cur.rowcount > 0
