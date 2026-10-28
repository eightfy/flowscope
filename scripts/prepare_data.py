"""Prepare raw traffic CSVs into compact, server-friendly artifacts.

Outputs (prepared/):
  <dataset>.npz        values (T x N float32), timestamps (ISO strings), region ids/names
  <dataset>.geojson    Normalized FeatureCollection (feature.properties.name == region id)
  datasets.json        Metadata consumed by the API
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data"
OUT = ROOT / "prepared"
OUT.mkdir(exist_ok=True)

DATASETS = [
    {
        "id": "milano",
        "name": "米兰 Milano",
        "subtitle": "Telecom Italia 城市网格 · 10 分钟粒度",
        "csv": "milano_traffic_nid.csv",
        "geo": "milano.geojson",
        "geo_id_prop": "NIL",
        "geo_label_props": ["NIL"],
        "interval_min": 10,
        "unit": "流量单位",
        "unit_short": "u",
        "scale": 1.0,
        "scale_label": "",
        "color": "#22d3ee",
        "description": "米兰市区 88 个 NIL 区域，2013-11-01 至 2014-01-01，10 分钟聚合网络流量。",
    },
    {
        "id": "trentino",
        "name": "特伦蒂诺 Trentino",
        "subtitle": "223 个市镇 · 10 分钟粒度",
        "csv": "trentino_traffic_nid.csv",
        "geo": "trento.geojson",
        "geo_id_prop": "NAME_3",
        "geo_label_props": ["NAME_3"],
        "interval_min": 10,
        "unit": "流量单位",
        "unit_short": "u",
        "scale": 1.0,
        "scale_label": "",
        "color": "#a78bfa",
        "description": "特伦蒂诺 223 个市镇，2013-11-01 至 2014-01-01，10 分钟聚合网络流量。",
    },
    {
        "id": "jinan",
        "name": "济南 Jinan",
        "subtitle": "4G 下行 · 15 分钟粒度 · 2024",
        "csv": "zte_4g_down.region.csv",
        "geo": "zte_4g_down.traffic.geojson",
        "geo_id_prop": "unique_id",
        "geo_label_props": ["name", "ext_path"],
        "interval_min": 15,
        "unit": "Bytes",
        "unit_short": "B",
        "scale": 1.0,
        "scale_label": "",
        "color": "#fb923c",
        "description": "济南市 148 个街道 4G 下行流量，2024-07-28 至 2024-08-25，15 分钟粒度。",
    },
]


def ring_centroid(coords):
    """Cheap centroid from the largest exterior ring (mean of vertices)."""
    try:
        geom = coords
        polys = geom if geom and isinstance(geom[0][0][0], list) else [geom]
        best, area = None, -1
        for poly in polys:
            ring = poly[0]
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            a = (max(xs) - min(xs)) * (max(ys) - min(ys))
            if a > area:
                area, best = a, (sum(xs) / len(xs), sum(ys) / len(ys))
        return best or (0.0, 0.0)
    except Exception:
        return (0.0, 0.0)


def normalize_geo(raw_geo: dict, keep_ids: set[str], id_prop: str, label_props: list[str]):
    feats = []
    for f in raw_geo.get("features", []):
        props = f.get("properties") or {}
        rid = str(props.get(id_prop, ""))
        if rid not in keep_ids:
            continue
        label = next((str(props.get(p)) for p in label_props if props.get(p)), rid)
        c = ring_centroid(f.get("geometry", {}).get("coordinates"))
        feats.append(
            {
                "type": "Feature",
                "id": rid,
                "properties": {"name": rid, "label": label, "lng": c[0], "lat": c[1]},
                "geometry": f["geometry"],
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def build(cfg: dict):
    print(f"[{cfg['id']}] reading {cfg['csv']} ...")
    df = pd.read_csv(RAW / cfg["csv"], index_col=0, parse_dates=True)
    df = df[~df.index.duplicated(keep="first")].sort_index()
    df = df.apply(pd.to_numeric, errors="coerce")

    # Keep only regions that have a polygon so every series is mappable.
    raw_geo = json.loads((RAW / cfg["geo"]).read_text())
    geo_ids = {str((f.get("properties") or {}).get(cfg["geo_id_prop"], "")) for f in raw_geo["features"]}
    cols = [c for c in df.columns if str(c) in geo_ids]
    dropped = len(df.columns) - len(cols)
    df = df[cols]
    df.columns = [str(c) for c in df.columns]
    df = df.ffill().bfill()

    values = df.to_numpy(dtype=np.float32)
    times = df.index.strftime("%Y-%m-%dT%H:%M:%S").tolist()
    ids = list(df.columns)
    geo = normalize_geo(raw_geo, set(ids), cfg["geo_id_prop"], cfg["geo_label_props"])

    np.savez_compressed(
        OUT / f"{cfg['id']}.npz",
        values=values,
        times=np.array(times, dtype="U19"),
        ids=np.array(ids, dtype="U128"),
        names=np.array(ids, dtype="U128"),
    )
    (OUT / f"{cfg['id']}.geojson").write_text(json.dumps(geo, ensure_ascii=False, separators=(",", ":")))

    idx = df.index
    hours = idx.hour.to_numpy()
    weekdays = idx.weekday.to_numpy()
    weekend = weekdays >= 5
    per_region = []
    for j, rid in enumerate(ids):
        col = values[:, j]
        mean = float(col.mean())
        std = float(col.std())
        peak_i = int(col.argmax())
        weekend_mean = float(col[weekend].mean()) if weekend.any() else mean
        weekday_mean = float(col[~weekend].mean()) if (~weekend).any() else mean
        # average daily profile by hour
        prof = np.zeros(24)
        cnt = np.zeros(24)
        np.add.at(prof, hours, col)
        np.add.at(cnt, hours, 1.0)
        prof = prof / np.maximum(cnt, 1)
        per_region.append(
            {
                "id": rid,
                "label": next((f["properties"]["label"] for f in geo["features"] if f["properties"]["name"] == rid), rid),
                "mean": mean,
                "std": std,
                "max": float(col.max()),
                "min": float(col.min()),
                "total": float(col.sum()),
                "peak_time": times[peak_i],
                "peak_hour": int(hours[peak_i]),
                "weekend_ratio": float(weekend_mean / weekday_mean) if weekday_mean else 1.0,
                "cv": float(std / mean) if mean else 0.0,
            }
        )

    meta = {
        "id": cfg["id"],
        "name": cfg["name"],
        "subtitle": cfg["subtitle"],
        "description": cfg["description"],
        "color": cfg["color"],
        "interval_min": cfg["interval_min"],
        "unit": cfg["unit"],
        "unit_short": cfg["unit_short"],
        "n_regions": len(ids),
        "n_points": len(times),
        "start": times[0],
        "end": times[-1],
        "dropped_regions": dropped,
        "global_mean": float(values.mean()),
        "global_max": float(values.max()),
        "total": float(values.sum()),
        "regions": per_region,
    }
    print(f"[{cfg['id']}] {values.shape}, geo {len(geo['features'])}, dropped {dropped}")
    return meta


def main():
    metas = []
    for cfg in DATASETS:
        metas.append(build(cfg))
    (OUT / "datasets.json").write_text(json.dumps(metas, ensure_ascii=False, indent=1))
    print("done ->", OUT)


if __name__ == "__main__":
    main()
