from __future__ import annotations

import copy
import math
import warnings
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import (
    ExtraTreesRegressor,
    GradientBoostingRegressor,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.linear_model import Lasso, Ridge
from sklearn.neighbors import KNeighborsRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR

from ..data_store import Dataset
from .metrics import evaluate, mase
from .registry import AUTO_SEASON, resolve_params

Emit = Callable[..., None]


class Cancelled(Exception):
    pass


def _check(cancel):
    if cancel is not None and cancel.is_set():
        raise Cancelled()


def _rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


def _windows(y: np.ndarray, lags: int):
    sw = np.lib.stride_tricks.sliding_window_view(y, lags)
    return sw[:-1], y[lags:]


def _recursive(model, y: np.ndarray, lags: int, horizon: int, xs: StandardScaler, ys: StandardScaler) -> np.ndarray:
    """Recursive multi-step forecast with a stability guard.

    Tree/NN models can drift outside the observed range after a few feedback
    steps. Traffic is bounded by its historical envelope, so clamp every
    intermediate prediction to [min(y), max(y)] of the training history.
    """
    ctx = np.asarray(y[-lags:], dtype=float).copy()
    lo, hi = float(np.min(y)), float(np.max(y))
    outs = []
    for _ in range(horizon):
        x = xs.transform(ctx[-lags:].reshape(1, -1))
        p_scaled = float(model.predict(x)[0])
        p = float(ys.inverse_transform([[p_scaled]])[0, 0])
        p = float(np.clip(p, lo, hi))
        outs.append(p)
        ctx = np.r_[ctx, p]
    return np.asarray(outs, dtype=float)


def _prepare_windows(y: np.ndarray, lags: int, horizon: int, seed: int):
    X, target = _windows(y, lags)
    n = len(target)
    if n < 20:
        raise ValueError(f"可用训练样本仅 {n} 个，请缩短输入长度或增大历史窗口")
    val_size = min(max(horizon, int(0.18 * n)), max(1, n - 10))
    Xtr, ytr = X[:-val_size], target[:-val_size]
    Xva, yva = X[-val_size:], target[-val_size:]
    xs = StandardScaler().fit(Xtr)
    ys = StandardScaler().fit(ytr.reshape(-1, 1))
    return (
        xs.transform(Xtr),
        ys.transform(ytr.reshape(-1, 1)).ravel(),
        xs.transform(Xva),
        ys.transform(yva.reshape(-1, 1)).ravel(),
        xs,
        ys,
        len(Xtr),
        len(Xva),
    )


def _importances(model, lags: int, top: int = 12) -> list[dict[str, Any]]:
    vals = getattr(model, "feature_importances_", None)
    if vals is None:
        return []
    idx = np.argsort(vals)[::-1][:top]
    return [{"lag": int(lags - i), "importance": round(float(vals[i]), 5)} for i in idx]


def _fit_forest(kind: str, Xtr, ytr, Xva, yva, y, params, emit, cancel):
    n = params["n_estimators"]
    step = max(10, n // 18)
    kwargs = dict(random_state=42, n_jobs=-1)
    if kind == "rf":
        kwargs.update(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"])
        mf = params.get("max_features", "sqrt")
        kwargs["max_features"] = 1.0 if mf == "1.0" else mf
        cls = RandomForestRegressor
    else:
        kwargs.update(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"])
        cls = ExtraTreesRegressor
    model = None
    curve = []
    for m in range(step, n + 1, step):
        _check(cancel)
        if model is None:
            model = cls(n_estimators=m, warm_start=True, **kwargs)
        else:
            model.set_params(n_estimators=m)
        model.fit(Xtr, ytr)
        val_rmse = _rmse(yva, model.predict(Xva))
        curve.append({"step": m, "val": round(val_rmse, 5), "train": None})
        emit(0.12 + 0.72 * m / n, f"{m}/{n} 棵树", point=curve[-1])
    if model is None:
        raise ValueError("树模型参数无效")
    if model.n_estimators != n:
        model.set_params(n_estimators=n)
        model.fit(Xtr, ytr)
    return model


def _fit_mlp(Xtr, ytr, Xva, yva, params, emit, cancel, seed):
    hidden = tuple(int(x) for x in str(params["hidden"]).split(","))
    model = MLPRegressor(
        hidden_layer_sizes=hidden,
        activation="relu",
        solver="adam",
        alpha=params["alpha"],
        batch_size=min(512, max(32, len(Xtr) // 8)),
        learning_rate_init=params["lr"],
        max_iter=1,
        warm_start=True,
        shuffle=True,
        random_state=seed,
        tol=0.0,
        n_iter_no_change=10000,
    )
    best, best_val, wait = None, float("inf"), 0
    curve = []
    epochs = params["epochs"]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for ep in range(epochs):
            _check(cancel)
            model.fit(Xtr, ytr)
            train_rmse = _rmse(ytr, model.predict(Xtr))
            val_rmse = _rmse(yva, model.predict(Xva))
            curve.append({"step": ep + 1, "train": round(train_rmse, 5), "val": round(val_rmse, 5)})
            emit(0.04 + 0.8 * (ep + 1) / epochs, f"epoch {ep + 1}/{epochs} · val RMSE {val_rmse:.4f}", point=curve[-1])
            if val_rmse < best_val - 1e-5:
                best_val = val_rmse
                best = copy.deepcopy(model)
                wait = 0
            else:
                wait += 1
                if wait >= params["patience"]:
                    emit(0.86, f"早停于 epoch {ep + 1}")
                    break
    if best is not None:
        model = best
    model.curve = curve  # type: ignore[attr-defined]
    return model, "pmse"


def _fit_ml(kind: str, Xtr, ytr, Xva, yva, ys, y, lags, params, emit, cancel, seed):
    if kind in ("rf", "et"):
        model = _fit_forest(kind, Xtr, ytr, Xva, yva, y, params, emit, cancel)
        return model, "rmse", None
    if kind == "ridge":
        model = Ridge(alpha=params["alpha"])
        emit(0.3, "闭式求解中")
        model.fit(Xtr, ytr)
        emit(0.7, "拟合完成")
        return model, "rmse", "abscoef"
    if kind == "lasso":
        model = Lasso(alpha=params["alpha"], max_iter=5000)
        emit(0.3, "坐标下降优化中")
        model.fit(Xtr, ytr)
        emit(0.7, "拟合完成")
        return model, "rmse", "abscoef"
    if kind == "knn":
        model = KNeighborsRegressor(n_neighbors=params["k"], weights=params["weights"], n_jobs=-1)
        emit(0.35, "构建邻居索引")
        model.fit(Xtr, ytr)
        emit(0.65, "索引完成")
        return model, "rmse", None
    if kind == "svr":
        model = SVR(C=params["C"], epsilon=params["epsilon"], gamma=params["gamma"], cache_size=600)
        emit(0.15, "核矩阵求解中")
        model.fit(Xtr, ytr)
        emit(0.75, "核矩阵求解完成")
        return model, "rmse", None
    if kind == "gb":
        total = params["n_estimators"]
        chunk = max(5, total // 40)
        model = GradientBoostingRegressor(
            n_estimators=min(chunk, total),
            learning_rate=params["learning_rate"],
            max_depth=params["max_depth"],
            subsample=params["subsample"],
            random_state=seed,
            warm_start=True,
        )
        emit(0.06, "提升树拟合中")
        for m in range(chunk, total + 1, chunk):
            _check(cancel)
            model.set_params(n_estimators=m)
            model.fit(Xtr, ytr)
            val_rmse = _rmse(yva, model.predict(Xva))
            point = {"step": m, "val": round(val_rmse, 5), "train": None}
            emit(0.06 + 0.78 * m / total, f"提升轮 {m}/{total}", point=point)
        if model.n_estimators != total:
            model.set_params(n_estimators=total)
            model.fit(Xtr, ytr)
        return model, "rmse", None
    if kind == "hgb":
        model = HistGradientBoostingRegressor(
            max_iter=params["max_iter"],
            learning_rate=params["learning_rate"],
            max_leaf_nodes=params["max_leaf_nodes"],
            l2_regularization=params["l2_regularization"],
            early_stopping=False,
            random_state=seed,
        )
        emit(0.2, "直方图分箱构建中")
        model.fit(Xtr, ytr)
        emit(0.85, "提升树拟合完成")
        return model, "rmse", None
    if kind == "mlp":
        model, unit = _fit_mlp(Xtr, ytr, Xva, yva, params, emit, cancel, seed)
        return model, unit, None
    raise ValueError(f"未实现的模型 {kind}")


def _stat_forecast(kind: str, y: np.ndarray, horizon: int, params: dict, emit, cancel):
    _check(cancel)
    if kind == "naive":
        emit(0.5, "取最后观测值")
        return np.repeat(y[-1], horizon), float(np.std(np.diff(y[-min(len(y) - 1, 200):]))), {}
    if kind == "seasonal_naive":
        season = int(params["season"])
        emit(0.5, f"按 {season} 步季节周期外推")
        if len(y) >= season:
            pat = y[-season:]
            pred = np.resize(pat, horizon)
            resid = y[season:] - y[:-season]
            return pred, float(np.std(resid)), {"season": season}
        return np.repeat(y[-1], horizon), float(np.std(y)), {"season": season}
    if kind == "moving_average":
        w = int(params["window"])
        emit(0.5, f"最近 {w} 步均值")
        seg = y[-w:]
        return np.repeat(seg.mean(), horizon), float(np.std(seg) / math.sqrt(max(1, w))) + float(np.std(y[-min(len(y), 200):])) * 0.3, {}
    if kind == "exp_smoothing":
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing

        emit(0.25, "拟合指数平滑")
        fit = SimpleExpSmoothing(y, initialization_method="estimated").fit(
            smoothing_level=params["alpha"], optimized=False
        )
        pred = np.asarray(fit.forecast(horizon), dtype=float)
        emit(0.8, "预测完成")
        return pred, float(np.std(fit.resid)), {"alpha": params["alpha"]}
    if kind == "holt_winters":
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        season = int(params["season_length"])
        trend = params["trend"] if params["trend"] != "none" else None
        seasonal = params["seasonal"] if params["seasonal"] != "none" else None
        if seasonal and len(y) < 2 * season:
            raise ValueError(f"历史长度不足以估计 {season} 步季节项，请减小季节周期")
        emit(0.2, "估计水平/趋势/季节项")
        kwargs = dict(
            trend=trend,
            damped_trend=bool(params["damped"]),
            initialization_method="estimated",
        )
        if seasonal:
            kwargs.update(seasonal=seasonal, seasonal_periods=season)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fit = ExponentialSmoothing(y, **kwargs).fit(optimized=True)
        pred = np.asarray(fit.forecast(horizon), dtype=float)
        emit(0.85, "Holt-Winters 拟合完成")
        return pred, float(np.std(fit.resid)), {"season": season, "aic": getattr(fit, "aic", None)}
    if kind == "sarima":
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        p, d, q = params["p"], params["d"], params["q"]
        P, D, Q, m = params["P"], params["D"], params["Q"], int(params["m"])
        seasonal_order = (P, D, Q, m) if m > 1 and (P or D or Q) else (0, 0, 0, 0)
        if seasonal_order != (0, 0, 0, 0) and len(y) < 3 * m:
            raise ValueError(f"季节周期 m={m} 过大，历史长度至少需要 {3 * m} 步")
        emit(0.12, f"SARIMAX({p},{d},{q}) 初始化")
        mod = SARIMAX(
            y,
            order=(p, d, q),
            seasonal_order=seasonal_order,
            trend="c",
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        try:
            fit = mod.fit(disp=False, maxiter=params["max_iter"])
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"SARIMA 拟合失败：{exc}。可降低阶数或关闭季节项") from exc
        pred = np.asarray(fit.forecast(horizon), dtype=float)
        emit(0.88, "SARIMA 拟合完成")
        return pred, float(np.std(fit.resid)), {"aic": float(fit.aic)}
    raise ValueError(f"未实现的统计模型 {kind}")


def _transform(y: np.ndarray, on: bool) -> np.ndarray:
    return np.log1p(np.maximum(y, 0.0)) if on else y.astype(float)


def _inverse(y: np.ndarray, on: bool) -> np.ndarray:
    out = np.expm1(y) if on else y
    return np.maximum(out, 0.0)


def run_forecast(ds: Dataset, cfg: dict[str, Any], emit: Emit, cancel=None) -> dict[str, Any]:
    region = cfg["region"]
    algo_id = cfg["algorithm"]
    input_len = int(cfg["input_len"])
    output_len = int(cfg["output_len"])
    history_len = int(cfg.get("history_len") or 2016)
    log_transform = bool(cfg.get("log_transform", False))
    seed = int(cfg.get("seed") or 42)
    params = resolve_params(algo_id, cfg.get("params"), ds.interval_min)

    j = ds.region_index(region)
    raw = ds.values[:, j].astype(float)
    n = len(raw)
    if output_len < 1 or output_len >= n - 8:
        raise ValueError("输出长度超出数据范围")
    history_len = max(input_len + output_len + 32, min(history_len, n - output_len))
    if history_len + output_len > n:
        history_len = n - output_len
    if history_len <= input_len + 16:
        raise ValueError("历史窗口过短：请增大训练历史或缩短输入长度")

    test = raw[-output_len:]
    hist = raw[-(output_len + history_len):-output_len]
    test_times = ds.times[-output_len:]
    hist_times = ds.times[-(output_len + history_len):-output_len]
    emit(0.03, "data", f"切分数据：历史 {len(hist)} 步，预测 {output_len} 步")

    y = _transform(hist, log_transform)
    test_work = _transform(test, log_transform)

    # seasonal baseline for skill score
    season = AUTO_SEASON.get(ds.interval_min, 24)
    if len(hist) >= season:
        baseline = _inverse(np.resize(_transform(hist[-season:], log_transform), output_len), log_transform)
    else:
        baseline = np.repeat(test.mean(), output_len)
    base_metrics = evaluate(test, baseline)

    curve: list[dict[str, Any]] = []

    def train_emit(frac: float, msg: str, point: dict | None = None):
        _check(cancel)
        emit(0.1 + 0.74 * float(max(0.0, min(1.0, frac))), "training", msg, point=point)
        if point:
            curve.append(point)

    if algo_id in ("naive", "seasonal_naive", "moving_average", "exp_smoothing", "holt_winters", "sarima"):
        pred_w, resid_std, stat_info = _stat_forecast(algo_id, y, output_len, params, train_emit, cancel)
        info = {"samples": len(y), "features": input_len, **stat_info}
        unit = "rmse"
    else:
        emit(0.08, "training", "构建监督学习窗口")
        Xtr, ytr, Xva, yva, xs, ys, ntr, nva = _prepare_windows(y, input_len, output_len, seed)
        kind_map = {
            "ridge_ar": "ridge",
            "lasso_ar": "lasso",
            "knn": "knn",
            "random_forest": "rf",
            "extra_trees": "et",
            "gradient_boosting": "gb",
            "hist_gb": "hgb",
            "mlp": "mlp",
            "svr": "svr",
        }
        kind = kind_map[algo_id]
        emit(0.1, "training", f"训练样本 {ntr} · 验证样本 {nva}")
        model, unit, imp_mode = _fit_ml(kind, Xtr, ytr, Xva, yva, ys, y, input_len, params, train_emit, cancel, seed)
        _check(cancel)
        emit(0.9, "predict", "递归多步预测中")
        pred_w = _recursive(model, y, input_len, output_len, xs, ys)
        val_pred = model.predict(Xva)
        resid = (yva - val_pred) * float(ys.scale_[0])
        resid_std = float(np.std(resid))
        imp = _importances(model, input_len) if hasattr(model, "feature_importances_") else []
        if not imp and imp_mode == "abscoef" and hasattr(model, "coef_"):
            coef = np.abs(np.ravel(model.coef_))
            idx = np.argsort(coef)[::-1][:12]
            imp = [{"lag": int(input_len - i), "importance": round(float(coef[i]), 5)} for i in idx]
        info = {
            "samples": ntr,
            "valSamples": nva,
            "features": input_len,
            "importantLags": imp,
            "hidden": params.get("hidden") if algo_id == "mlp" else None,
        }

    _check(cancel)
    pred = _inverse(pred_w, log_transform)
    pred = np.nan_to_num(pred, nan=float(test.mean()), posinf=float(test.max()), neginf=0.0)

    # approximate 90% interval: residual scale grows with sqrt(horizon)
    base_sigma = resid_std if np.isfinite(resid_std) and resid_std > 0 else float(np.std(y) * 0.08)
    steps = np.arange(1, output_len + 1, dtype=float)
    sigma_w = base_sigma * np.sqrt(steps)
    if log_transform:
        sigma_raw = sigma_w * (pred + 1.0)
    else:
        sigma_raw = sigma_w
    lo = np.maximum(pred - 1.645 * sigma_raw, 0.0)
    hi = pred + 1.645 * sigma_raw

    metrics = evaluate(test, pred)
    metrics["mase"] = mase(test, pred, hist, min(season, max(1, len(hist) // 2)))
    if base_metrics.get("rmse") and metrics.get("rmse") is not None:
        metrics["skill"] = round(1 - metrics["rmse"] / base_metrics["rmse"], 4)

    horizon = []
    for i in range(output_len):
        err = float(test[i] - pred[i])
        horizon.append(
            {
                "step": i + 1,
                "time": test_times[i].strftime("%Y-%m-%dT%H:%M:%S"),
                "actual": round(float(test[i]), 3),
                "predicted": round(float(pred[i]), 3),
                "lo": round(float(lo[i]), 3),
                "hi": round(float(hi[i]), 3),
                "error": round(err, 3),
                "absPct": round(abs(err) / max(abs(float(test[i])), 1e-9) * 100, 2),
            }
        )

    lookback = min(len(hist), max(input_len + output_len, 288))
    hist_payload = {
        "times": [t.strftime("%Y-%m-%dT%H:%M:%S") for t in hist_times[-lookback:]],
        "values": [round(float(v), 2) for v in hist[-lookback:]],
    }
    emit(0.97, "evaluate", "计算评估指标")
    result = {
        "dataset": ds.id,
        "region": region,
        "regionLabel": ds.label(region),
        "algorithm": algo_id,
        "config": {
            "input_len": input_len,
            "output_len": output_len,
            "history_len": history_len,
            "log_transform": log_transform,
            "params": params,
            "seed": seed,
            "interval_min": ds.interval_min,
        },
        "metrics": metrics,
        "baseline": base_metrics,
        "horizon": horizon,
        "history": hist_payload,
        "trainingCurve": curve,
        "curveUnit": unit,
        "info": {k: v for k, v in info.items() if v is not None},
        "testStart": test_times[0].strftime("%Y-%m-%dT%H:%M:%S"),
        "testEnd": test_times[-1].strftime("%Y-%m-%dT%H:%M:%S"),
        "residualStd": round(float(base_sigma), 5),
    }
    emit(1.0, "done", "预测与评估完成")
    return result
