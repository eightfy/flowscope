from __future__ import annotations

from typing import Any

import numpy as np


def _safe(x: float) -> float | None:
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), 4)


def evaluate(actual: np.ndarray, pred: np.ndarray) -> dict[str, Any]:
    a = np.asarray(actual, dtype=float)
    p = np.asarray(pred, dtype=float)
    mask = np.isfinite(a) & np.isfinite(p)
    a, p = a[mask], p[mask]
    n = len(a)
    if n == 0:
        return {"n": 0}
    err = a - p
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err**2)))
    nz = np.abs(a) > 1e-6
    mape = float(np.mean(np.abs(err[nz] / a[nz])) * 100) if nz.any() else None
    denom = np.abs(a) + np.abs(p)
    smape = float(np.mean(2 * np.abs(err) / np.maximum(denom, 1e-9)) * 100)
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((a - a.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
    wape = float(np.sum(np.abs(err)) / max(np.sum(np.abs(a)), 1e-9) * 100)
    nrmse = rmse / max(float(np.mean(np.abs(a))), 1e-9)
    return {
        "n": n,
        "mae": _safe(mae),
        "rmse": _safe(rmse),
        "mape": _safe(mape) if mape is not None else None,
        "smape": _safe(smape),
        "r2": _safe(r2) if r2 is not None else None,
        "wape": _safe(wape),
        "nrmse": _safe(nrmse),
        "bias": _safe(float(np.mean(err))),
        "meanActual": _safe(float(a.mean())),
        "meanPred": _safe(float(p.mean())),
    }


def mase(actual: np.ndarray, pred: np.ndarray, train: np.ndarray, season: int) -> float | None:
    try:
        train = np.asarray(train, dtype=float)
        if len(train) <= season or season < 1:
            return None
        scale = float(np.mean(np.abs(train[season:] - train[:-season])))
        if scale <= 1e-9:
            return None
        return round(float(np.mean(np.abs(np.asarray(actual) - np.asarray(pred))) / scale), 4)
    except Exception:
        return None
