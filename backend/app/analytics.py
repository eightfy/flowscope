from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import signal
from statsmodels.tsa.seasonal import STL
from statsmodels.tsa.stattools import acf

from .data_store import Dataset


def _f(x: float | np.floating | None, nd: int = 3) -> float | None:
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), nd)


def _series_payload(s: pd.Series, freq_label: str) -> dict[str, Any]:
    s = s.dropna()
    return {
        "freq": freq_label,
        "times": [t.strftime("%Y-%m-%dT%H:%M:%S") for t in s.index],
        "values": [_f(v, 2) for v in s.to_numpy()],
    }


def gini(values: np.ndarray) -> float:
    x = np.sort(np.asarray(values, dtype=float))
    x = x[np.isfinite(x)]
    if len(x) == 0 or x.sum() <= 0:
        return 0.0
    n = len(x)
    cum = np.cumsum(x)
    return float((n + 1 - 2 * np.sum(cum) / cum[-1]) / n)


def _profiles(total: pd.Series, raw: pd.Series) -> dict[str, Any]:
    hours = raw.index.hour.to_numpy()
    weekdays = raw.index.weekday.to_numpy()
    vals = raw.to_numpy(dtype=float)

    hour_sum = np.zeros(24)
    hour_cnt = np.zeros(24)
    np.add.at(hour_sum, hours, vals)
    np.add.at(hour_cnt, hours, 1)
    hour_profile = hour_sum / np.maximum(hour_cnt, 1)

    wd_sum = np.zeros(7)
    wd_cnt = np.zeros(7)
    np.add.at(wd_sum, weekdays, vals)
    np.add.at(wd_cnt, weekdays, 1)
    weekday_profile = wd_sum / np.maximum(wd_cnt, 1)

    heat = np.zeros((7, 24))
    cnt = np.zeros((7, 24))
    np.add.at(heat, (weekdays, hours), vals)
    np.add.at(cnt, (weekdays, hours), 1)
    heat = heat / np.maximum(cnt, 1)

    return {
        "hourProfile": [_f(v, 2) for v in hour_profile],
        "weekdayProfile": [_f(v, 2) for v in weekday_profile],
        "weekdayHour": [[_f(v, 2) for v in row] for row in heat],
    }


def overview(ds: Dataset) -> dict[str, Any]:
    total = ds.total_series()
    daily = total.resample("D").sum()
    hourly = total.resample("h").sum()
    vals = ds.values
    means = vals.mean(axis=0)
    peak_i = int(np.argmax(total.to_numpy()))
    weekday_heat = np.zeros((7, 24))
    counts = np.zeros((7, 24))
    np.add.at(weekday_heat, (total.index.weekday, total.index.hour), total.to_numpy())
    np.add.at(counts, (total.index.weekday, total.index.hour), 1)
    weekday_heat /= np.maximum(counts, 1)
    hour_sum = np.zeros(24)
    hour_cnt = np.zeros(24)
    np.add.at(hour_sum, total.index.hour, total.to_numpy())
    np.add.at(hour_cnt, total.index.hour, 1)
    hour_profile = hour_sum / np.maximum(hour_cnt, 1)

    top = sorted(
        (
            {
                "id": rid,
                "label": ds.label(rid),
                "mean": _f(means[j], 2),
                "share": _f(means[j] / means.sum() * 100, 2),
                "peak_hour": ds.region_stats.get(rid, {}).get("peak_hour"),
                "weekend_ratio": _f(ds.region_stats.get(rid, {}).get("weekend_ratio"), 3),
            }
            for j, rid in enumerate(ds.ids)
        ),
        key=lambda r: r["mean"] or 0,
        reverse=True,
    )[:12]

    last_day = daily.iloc[-1] if len(daily) else 0
    prev_day = daily.iloc[-2] if len(daily) > 1 else last_day
    g = gini(means)
    sorted_means = np.sort(means)[::-1]
    top10_share = float(sorted_means[: max(1, len(means) // 10)].sum() / means.sum() * 100)

    return {
        "dataset": ds.id,
        "kpis": {
            "total": _f(total.sum(), 1),
            "mean": _f(total.mean(), 2),
            "peak": _f(total.max(), 2),
            "peakTime": total.idxmax().strftime("%Y-%m-%dT%H:%M:%S"),
            "regions": ds.n_regions,
            "days": len(daily),
            "gini": _f(g, 4),
            "top10Share": _f(top10_share, 2),
            "lastDayDelta": _f((last_day / prev_day - 1) * 100 if prev_day else 0, 2),
            "meanRegion": _f(means.mean(), 2),
        },
        "daily": _series_payload(daily, "day"),
        "hourlyTotal": _series_payload(hourly, "hour"),
        "hourProfile": [_f(v, 2) for v in hour_profile],
        "weekdayHour": [[_f(v, 2) for v in row] for row in weekday_heat],
        "topRegions": top,
        "regionMean": {rid: _f(means[j], 2) for j, rid in enumerate(ds.ids)},
        "hourlyPeak": int(np.argmax(hour_profile)),
        "weekdayPeak": int(np.argmax(weekday_heat.sum(axis=1))),
    }


def temporal(ds: Dataset, region: str | None, granularity: str = "hour") -> dict[str, Any]:
    raw = ds.selection_series(region)
    freq = {"hour": "h", "day": "D", "raw": None}.get(granularity, "h")
    if freq is None:
        agg = raw.iloc[-2000:]
        label = f"{ds.interval_min}min"
    else:
        agg = raw.resample(freq).sum().dropna()
        label = "hour" if freq == "h" else "day"

    probs = _profiles(raw, raw)
    vals = raw.to_numpy(dtype=float)

    # autocorrelation on the hourly aggregate (captures daily/weekly cycles)
    hourly = raw.resample("h").sum().dropna()
    acf_data: list[float] = []
    if len(hourly) >= 48:
        nlags = min(120, len(hourly) // 2 - 1)
        try:
            a = acf(hourly.to_numpy(), nlags=nlags, fft=True)
            acf_data = [_f(v, 4) for v in a[1:]]
        except Exception:
            acf_data = []

    # periodogram: strongest cycles between 3h and 7 days
    periods: list[dict[str, Any]] = []
    if len(hourly) >= 72:
        x = hourly.to_numpy(dtype=float)
        x = x - x.mean()
        f, p = signal.periodogram(x)
        mask = (f > 1 / 168) & (f < 1 / 3)
        if mask.any():
            fm, pm = f[mask], p[mask]
            order = np.argsort(pm)[::-1]
            seen: list[float] = []
            for idx in order:
                per = 1 / fm[idx]
                if all(abs(per - s) / s > 0.12 for s in seen):
                    seen.append(per)
                    periods.append({"periodHours": _f(per, 2), "power": _f(pm[idx] / (pm.max() + 1e-12), 4)})
                if len(periods) >= 4:
                    break

    # STL on daily total (weekly seasonality)
    decomposition = None
    daily = raw.resample("D").sum().dropna()
    if len(daily) >= 21:
        try:
            res = STL(daily.to_numpy(dtype=float), period=7, robust=True).fit()
            decomposition = {
                "times": [t.strftime("%Y-%m-%dT%H:%M:%S") for t in daily.index],
                "observed": [_f(v, 1) for v in daily.to_numpy()],
                "trend": [_f(v, 1) for v in res.trend],
                "seasonal": [_f(v, 1) for v in res.seasonal],
                "resid": [_f(v, 1) for v in res.resid],
            }
        except Exception:
            decomposition = None

    # linear trend over daily totals
    slope = None
    if len(daily) >= 3:
        xs = np.arange(len(daily), dtype=float)
        slope = float(np.polyfit(xs, daily.to_numpy(dtype=float), 1)[0])

    night_mask = (raw.index.hour < 6)
    day_mask = (raw.index.hour >= 8) & (raw.index.hour < 18)
    weekend_mask = raw.index.weekday >= 5
    mean = float(np.nanmean(vals))
    return {
        "dataset": ds.id,
        "region": region or "ALL",
        "label": "全部区域合计" if region in (None, "", "ALL") else ds.label(region),
        "stats": {
            "mean": _f(mean, 2),
            "std": _f(float(np.nanstd(vals)), 2),
            "cv": _f(float(np.nanstd(vals) / mean) if mean else 0, 4),
            "min": _f(float(np.nanmin(vals)), 2),
            "max": _f(float(np.nanmax(vals)), 2),
            "peakTime": raw.idxmax().strftime("%Y-%m-%dT%H:%M:%S"),
            "nightRatio": _f(float(vals[night_mask].mean() / mean) if mean else 0, 3),
            "dayRatio": _f(float(vals[day_mask].mean() / mean) if mean else 0, 3),
            "weekendRatio": _f(float(vals[weekend_mask].mean() / mean) if mean else 0, 3),
            "trendPerDay": _f(slope, 2),
            "trendPerDayPct": _f(slope / mean * 100 if mean else 0, 3),
        },
        "series": _series_payload(agg, label),
        **probs,
        "acf": acf_data,
        "periods": periods,
        "decomposition": decomposition,
    }


def moran(ds: Dataset, values: np.ndarray, k: int = 6) -> dict[str, Any]:
    pts = ds.map_points()
    coords = np.array([pts[r] for r in ds.ids], dtype=float)
    lat0 = math.radians(float(coords[:, 1].mean()))
    xy = np.c_[coords[:, 0] * math.cos(lat0), coords[:, 1]]
    n = len(xy)
    if n < 5:
        return {"i": None, "p": None, "z": None}
    try:
        from sklearn.neighbors import NearestNeighbors

        nn = NearestNeighbors(n_neighbors=min(k + 1, n)).fit(xy)
        _, idx = nn.kneighbors(xy)
        W = np.zeros((n, n))
        for i in range(n):
            for j in idx[i, 1:]:
                W[i, j] = 1.0
        W = W / np.maximum(W.sum(axis=1, keepdims=True), 1)
        x = values.astype(float)
        x = x - x.mean()
        denom = float(x @ x)
        if denom <= 0:
            return {"i": None, "p": None, "z": None}
        I = float((n / W.sum()) * (x @ W @ x) / denom)
        E = -1.0 / (n - 1)
        # permutation test
        rng = np.random.default_rng(7)
        sims = np.empty(199)
        for t in range(199):
            xp = rng.permutation(x)
            sims[t] = (n / W.sum()) * (xp @ W @ xp) / denom
        p = float((np.sum(sims >= I) + 1) / (len(sims) + 1))
        z = float((I - E) / (sims.std(ddof=1) + 1e-9))
        return {"i": round(I, 4), "p": round(p, 4), "z": round(z, 3), "expected": round(E, 4)}
    except Exception:
        return {"i": None, "p": None, "z": None}


def spatial(ds: Dataset, granularity: str = "day") -> dict[str, Any]:
    means = ds.values.mean(axis=0)
    stats = []
    for j, rid in enumerate(ds.ids):
        meta = ds.region_stats.get(rid, {})
        stats.append(
            {
                "id": rid,
                "label": ds.label(rid),
                "mean": _f(means[j], 2),
                "max": _f(meta.get("max"), 2),
                "cv": _f(meta.get("cv"), 4),
                "weekend_ratio": _f(meta.get("weekend_ratio"), 3),
                "peak_hour": meta.get("peak_hour"),
            }
        )

    freq = "D" if granularity != "hour" else "h"
    df, times = ds.timeline(freq)
    arr = df.to_numpy(dtype=np.float64)
    # Normalize for the animated map is done client-side; keep raw values.
    frames = [
        {"time": times[i], "values": [_f(v, 1) for v in arr[i]]}
        for i in range(arr.shape[0])
    ]

    # change in the most recent bucket vs the previous one
    movers = []
    if arr.shape[0] >= 2:
        prev = np.maximum(arr[-2], 1e-9)
        delta = (arr[-1] - arr[-2]) / prev * 100
        base = arr[:-1].mean(axis=0)
        valid = base > np.percentile(base, 20)
        order = np.argsort(delta)
        picks = [i for i in order[::-1] if valid[i]][:6] + [i for i in order if valid[i]][:4]
        seen = set()
        for i in picks:
            if i in seen:
                continue
            seen.add(i)
            movers.append(
                {
                    "id": ds.ids[i],
                    "label": ds.label(ds.ids[i]),
                    "delta": _f(delta[i], 2),
                    "value": _f(arr[-1, i], 2),
                }
            )

    z = (means - means.mean()) / (means.std() + 1e-9)
    mor = moran(ds, means)
    sorted_means = np.sort(means)[::-1]
    return {
        "dataset": ds.id,
        "granularity": "hour" if freq == "h" else "day",
        "regionStats": stats,
        "regionMean": {rid: _f(means[j], 2) for j, rid in enumerate(ds.ids)},
        "frames": frames,
        "movers": movers,
        "moran": mor,
        "gini": _f(gini(means), 4),
        "hot": int((z > 1.5).sum()),
        "cold": int((z < -1.5).sum()),
        "top10Share": _f(sorted_means[: max(1, len(means) // 10)].sum() / means.sum() * 100, 2),
        "globalMean": _f(means.mean(), 2),
        "globalMax": _f(means.max(), 2),
    }
