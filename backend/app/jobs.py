from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from .data_store import Dataset
from .forecast.engine import Cancelled, run_forecast
from .forecast.registry import ALGO_MAP
from .storage import RunStore

run_store = RunStore()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Job:
    def __init__(self, dataset: Dataset, cfg: dict[str, Any]):
        self.id = uuid.uuid4().hex[:12]
        self.dataset = dataset
        self.cfg = cfg
        self.algo = ALGO_MAP[cfg["algorithm"]]
        self.cancel_event = threading.Event()
        self.lock = threading.Lock()
        self.status = "queued"
        self.progress = 0.0
        self.stage = "queued"
        self.message = "任务已排队"
        self.created_at = _now()
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.logs: list[dict[str, Any]] = []
        self.curve: list[dict[str, Any]] = []
        self.result: dict[str, Any] | None = None
        self.error: str | None = None
        self._last_msg = ""
        self._t0 = time.time()

    def emit(self, progress: float, stage: str, message: str, point: dict | None = None):
        with self.lock:
            self.progress = round(max(self.progress, min(1.0, float(progress))), 4)
            self.stage = stage
            self.message = message
            if point:
                self.curve.append(point)
            if message != self._last_msg:
                self._last_msg = message
                self.logs.append({"t": _now(), "message": message, "progress": self.progress})
                self.logs = self.logs[-160:]

    def snapshot(self, include_result: bool = False) -> dict[str, Any]:
        with self.lock:
            state = {
                "id": self.id,
                "status": self.status,
                "progress": self.progress,
                "stage": self.stage,
                "message": self.message,
                "createdAt": self.created_at,
                "startedAt": self.started_at,
                "finishedAt": self.finished_at,
                "duration": round(time.time() - self._t0, 2) if self.started_at else 0,
                "algorithm": self.cfg["algorithm"],
                "algorithmName": self.algo["name"],
                "dataset": self.dataset.id,
                "region": self.cfg["region"],
                "regionLabel": self.dataset.label(self.cfg["region"]),
                "config": self.cfg,
                "curve": self.curve[-400:],
                "logs": self.logs[-60:],
                "error": self.error,
            }
            if include_result and self.result:
                state["result"] = self.result
            return state

    def execute(self):
        with self.lock:
            self.status = "running"
            self.started_at = _now()
            self.stage = "preparing"
            self.message = "任务启动"
        try:
            result = run_forecast(self.dataset, self.cfg, self.emit, self.cancel_event)
            duration = time.time() - self._t0
            result["algorithmName"] = self.algo["name"]
            result["unit"] = self.dataset.meta.get("unit")
            result["runId"] = self.id
            result["duration"] = round(duration, 2)
            with self.lock:
                self.result = result
                self.status = "succeeded"
                self.progress = 1.0
                self.stage = "done"
                self.message = "预测完成"
                self.finished_at = _now()
            try:
                run_store.save(self.id, result, self.algo["name"], duration)
            except Exception as exc:  # noqa: BLE001
                self.emit(1.0, "done", f"结果已生成，但写入历史失败：{exc}")
        except Cancelled:
            with self.lock:
                self.status = "cancelled"
                self.message = "任务已取消"
                self.finished_at = _now()
                self.stage = "cancelled"
        except Exception as exc:  # noqa: BLE001
            detail = str(exc)
            tb = traceback.format_exc(limit=4)
            with self.lock:
                self.status = "failed"
                self.error = detail
                self.message = f"失败：{detail}"
                self.finished_at = _now()
                self.stage = "failed"
                self.logs.append({"t": _now(), "message": tb, "progress": self.progress})
                self.logs = self.logs[-160:]

    def cancel(self):
        self.cancel_event.set()
        with self.lock:
            if self.status in ("queued", "running"):
                self.message = "正在取消…"


class JobManager:
    def __init__(self, max_workers: int = 2):
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="forecast")
        self.jobs: dict[str, Job] = {}
        self.order: list[str] = []
        self.lock = threading.Lock()

    def submit(self, ds: Dataset, cfg: dict[str, Any]) -> Job:
        job = Job(ds, cfg)
        with self.lock:
            self.jobs[job.id] = job
            self.order.insert(0, job.id)
            self.order = self.order[:80]
        self.executor.submit(job.execute)
        return job

    def get(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if not job:
            raise KeyError(f"未知任务: {job_id}")
        return job

    def active(self) -> list[dict[str, Any]]:
        with self.lock:
            jobs = [self.jobs[i] for i in self.order if i in self.jobs]
        return [j.snapshot() for j in jobs if j.status in ("queued", "running")]


manager = JobManager()
