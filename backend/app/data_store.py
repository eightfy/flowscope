from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import PREPARED


@dataclass
class Dataset:
    meta: dict[str, Any]
    values: np.ndarray
    times: pd.DatetimeIndex
    ids: list[str]
    labels: dict[str, str]
    geo: dict[str, Any]
    region_stats: dict[str, dict[str, Any]] = field(default_factory=dict)
    _agg_cache: dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.meta["id"]

    @property
    def interval_min(self) -> int:
        return int(self.meta["interval_min"])

    @property
    def n_regions(self) -> int:
        return len(self.ids)

    @property
    def n_points(self) -> int:
        return len(self.times)

    def region_index(self, region: str) -> int:
        try:
            return self.ids.index(region)
        except ValueError as exc:
            raise KeyError(f"未知区域: {region}") from exc

    def label(self, region: str) -> str:
        return self.labels.get(region, region)

    def series(self, region: str) -> pd.Series:
        j = self.region_index(region)
        return pd.Series(self.values[:, j], index=self.times, name=region)

    def total_series(self) -> pd.Series:
        return pd.Series(self.values.sum(axis=1), index=self.times, name="ALL")

    def selection_series(self, region: str | None) -> pd.Series:
        if region in (None, "", "ALL", "all"):
            return self.total_series()
        return self.series(region)

    def frame(self) -> pd.DataFrame:
        cache = self._agg_cache.get("frame")
        if cache is None:
            cache = pd.DataFrame(self.values, index=self.times, columns=self.ids)
            self._agg_cache["frame"] = cache
        return cache

    def timeline(self, freq: str = "D") -> tuple[pd.DataFrame, list[str]]:
        """Aggregate every region by calendar bucket (sum of traffic)."""
        key = f"timeline:{freq}"
        cached = self._agg_cache.get(key)
        if cached is not None:
            return cached
        df = self.frame().resample(freq).sum()
        df = df.dropna(how="all")
        times = [t.strftime("%Y-%m-%dT%H:%M:%S") for t in df.index]
        out = (df, times)
        self._agg_cache[key] = out
        return out

    def map_points(self) -> dict[str, tuple[float, float]]:
        return {
            f["properties"]["name"]: (f["properties"]["lng"], f["properties"]["lat"])
            for f in self.geo.get("features", [])
        }


class Store:
    def __init__(self, prepared: Path = PREPARED):
        self.datasets: dict[str, Dataset] = {}
        self._lock = threading.Lock()
        self._load(prepared)

    def _load(self, prepared: Path):
        meta_path = prepared / "datasets.json"
        if not meta_path.exists():
            raise RuntimeError(f"缺少数据文件 {meta_path}，请先运行 scripts/prepare_data.py")
        metas = json.loads(meta_path.read_text())
        for meta in metas:
            did = meta["id"]
            npz = np.load(prepared / f"{did}.npz", allow_pickle=False)
            times = pd.to_datetime(npz["times"])
            ids = [str(x) for x in npz["ids"].tolist()]
            geo = json.loads((prepared / f"{did}.geojson").read_text())
            labels = {
                str(f["properties"]["name"]): str(f["properties"].get("label") or f["properties"]["name"])
                for f in geo["features"]
            }
            stats = {r["id"]: r for r in meta.get("regions", [])}
            self.datasets[did] = Dataset(
                meta=meta,
                values=npz["values"].astype(np.float32),
                times=times,
                ids=ids,
                labels=labels,
                geo=geo,
                region_stats=stats,
            )

    def get(self, dataset_id: str) -> Dataset:
        try:
            return self.datasets[dataset_id]
        except KeyError as exc:
            raise KeyError(f"未知数据集: {dataset_id}") from exc

    def list_meta(self) -> list[dict[str, Any]]:
        out = []
        for ds in self.datasets.values():
            m = {k: v for k, v in ds.meta.items() if k != "regions"}
            m["n_regions"] = ds.n_regions
            m["n_points"] = ds.n_points
            out.append(m)
        return out


store = Store()
