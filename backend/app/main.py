from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .analytics import overview, spatial, temporal
from .clustering import cluster
from .config import FRONTEND_DIST
from .data_store import store
from .forecast.registry import ALGO_MAP, registry
from .jobs import manager, run_store

app = FastAPI(title="FlowScope 智能流量分析平台", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ClusterRequest(BaseModel):
    dataset: str
    k: int = Field(4, ge=2, le=12)
    method: str = "kmeans"
    auto_k: bool = False
    use_profile: bool = True
    use_weekend: bool = True
    use_level: bool = True
    use_variability: bool = True


class ForecastRequest(BaseModel):
    dataset: str
    region: str
    algorithm: str
    input_len: int = Field(144, ge=2, le=4096)
    output_len: int = Field(24, ge=1, le=1024)
    history_len: int = Field(0, ge=0, le=20000)
    log_transform: bool = False
    params: dict[str, Any] = Field(default_factory=dict)
    seed: int = 42


def _ds(dataset: str):
    try:
        return store.get(dataset)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "datasets": [d.id for d in store.datasets.values()],
        "algorithms": len(ALGO_MAP),
    }


@app.get("/api/datasets")
def datasets():
    return {"datasets": store.list_meta()}


@app.get("/api/datasets/{dataset_id}")
def dataset_detail(dataset_id: str):
    ds = _ds(dataset_id)
    meta = dict(ds.meta)
    meta["regions"] = sorted(meta.get("regions", []), key=lambda r: r["mean"], reverse=True)
    return meta


@app.get("/api/datasets/{dataset_id}/regions")
def dataset_regions(dataset_id: str, q: str = "", sort: str = "mean", limit: int = 500):
    ds = _ds(dataset_id)
    items = [
        {
            "id": rid,
            "label": ds.label(rid),
            "mean": round(float(ds.values[:, j].mean()), 2),
            "max": round(float(ds.values[:, j].max()), 2),
            **{
                k: ds.region_stats.get(rid, {}).get(k)
                for k in ("peak_hour", "weekend_ratio", "cv", "peak_time")
            },
        }
        for j, rid in enumerate(ds.ids)
    ]
    if q:
        ql = q.lower()
        items = [i for i in items if ql in i["id"].lower() or ql in i["label"].lower()]
    if sort == "name":
        items.sort(key=lambda i: i["label"])
    elif sort == "cv":
        items.sort(key=lambda i: (i.get("cv") or 0), reverse=True)
    else:
        items.sort(key=lambda i: i["mean"], reverse=True)
    return {"regions": items[:limit], "total": len(items)}


@app.get("/api/datasets/{dataset_id}/geo")
def dataset_geo(dataset_id: str):
    ds = _ds(dataset_id)
    return JSONResponse(ds.geo, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/datasets/{dataset_id}/overview")
def dataset_overview(dataset_id: str):
    return overview(_ds(dataset_id))


@app.get("/api/datasets/{dataset_id}/temporal")
def dataset_temporal(dataset_id: str, region: str = "ALL", granularity: str = "hour"):
    return temporal(_ds(dataset_id), None if region in ("", "ALL") else region, granularity)


@app.get("/api/datasets/{dataset_id}/spatial")
def dataset_spatial(dataset_id: str, granularity: str = "day"):
    return spatial(_ds(dataset_id), granularity)


@app.get("/api/datasets/{dataset_id}/series")
def dataset_series(
    dataset_id: str,
    region: str = "ALL",
    granularity: str = "hour",
    start: str | None = None,
    end: str | None = None,
):
    ds = _ds(dataset_id)
    s = ds.selection_series(None if region in ("", "ALL") else region)
    if start:
        s = s[s.index >= pd.to_datetime(start)]
    if end:
        s = s[s.index <= pd.to_datetime(end)]
    if granularity in ("hour", "day"):
        s = s.resample("h" if granularity == "hour" else "D").sum()
    if len(s) > 4000:
        s = s.iloc[-4000:]
    return {
        "times": [t.strftime("%Y-%m-%dT%H:%M:%S") for t in s.index],
        "values": [round(float(v), 2) for v in s.to_numpy()],
        "label": ds.label(region) if region not in ("", "ALL") else "全部区域合计",
        "region": region,
    }


@app.get("/api/algorithms")
def algorithms(dataset: str | None = None):
    interval = 15
    if dataset:
        interval = _ds(dataset).interval_min
    return {"algorithms": registry(interval), "intervalMin": interval}


@app.post("/api/cluster")
def run_cluster(req: ClusterRequest):
    ds = _ds(req.dataset)
    try:
        return cluster(
            ds,
            k=req.k,
            method=req.method,
            use_profile=req.use_profile,
            use_weekend=req.use_weekend,
            use_level=req.use_level,
            use_variability=req.use_variability,
            auto_k=req.auto_k,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/forecast")
def start_forecast(req: ForecastRequest):
    ds = _ds(req.dataset)
    if req.algorithm not in ALGO_MAP:
        raise HTTPException(400, f"未知算法: {req.algorithm}")
    if req.region not in ds.ids:
        raise HTTPException(400, f"未知区域: {req.region}")
    default_history = 2016 if ds.interval_min == 10 else 1344
    history_len = req.history_len or default_history
    if history_len + req.output_len > ds.n_points:
        history_len = ds.n_points - req.output_len
    if history_len <= req.input_len + 16:
        raise HTTPException(400, "训练历史必须大于输入长度 + 16 步")
    cfg = {
        "region": req.region,
        "algorithm": req.algorithm,
        "input_len": req.input_len,
        "output_len": req.output_len,
        "history_len": history_len,
        "log_transform": req.log_transform,
        "params": req.params,
        "seed": req.seed,
    }
    job = manager.submit(ds, cfg)
    return {"jobId": job.id, "state": job.snapshot()}


@app.get("/api/jobs")
def list_jobs():
    return {"jobs": manager.active()}


@app.get("/api/jobs/{job_id}")
def job_state(job_id: str):
    try:
        return manager.get(job_id).snapshot()
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str):
    try:
        job = manager.get(job_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    if job.status != "succeeded" or not job.result:
        raise HTTPException(409, f"任务尚未完成（{job.status}）")
    return job.result


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    try:
        job = manager.get(job_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    job.cancel()
    return {"ok": True, "state": job.snapshot()}


@app.get("/api/runs")
def list_runs(limit: int = 50):
    return {"runs": run_store.list(limit)}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    result = run_store.get(run_id)
    if not result:
        raise HTTPException(404, "历史记录不存在")
    # Backfill metadata for runs saved by earlier versions.
    if "algorithmName" not in result or "unit" not in result:
        summary = next((r for r in run_store.list(200) if r["id"] == run_id), None)
        if summary:
            result.setdefault("algorithmName", summary.get("algorithmName"))
            result.setdefault("duration", summary.get("duration"))
        try:
            result.setdefault("unit", store.get(result["dataset"]).meta.get("unit"))
        except KeyError:
            pass
    result.setdefault("runId", run_id)
    return result


@app.delete("/api/runs/{run_id}")
def delete_run(run_id: str):
    if not run_store.delete(run_id):
        raise HTTPException(404, "历史记录不存在")
    return {"ok": True}


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    index = FRONTEND_DIST / "index.html"
    if full_path:
        target = (FRONTEND_DIST / full_path).resolve()
        if FRONTEND_DIST.resolve() in target.parents and target.is_file():
            return FileResponse(target)
    if index.exists():
        return FileResponse(index)
    return JSONResponse(
        {
            "message": "前端尚未构建。请运行 `cd frontend && npm run build`，或使用 `./run.sh` 一键启动。",
            "docs": "/docs",
        }
    )
