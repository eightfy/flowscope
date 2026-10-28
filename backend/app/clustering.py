from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

from .data_store import Dataset
from .analytics import _f

PALETTE = ["#22d3ee", "#a78bfa", "#fb923c", "#34d399", "#f472b6", "#facc15", "#60a5fa", "#f87171"]


def _hour_matrix(ds: Dataset) -> tuple[np.ndarray, np.ndarray]:
    hours = ds.times.hour.to_numpy()
    counts = np.zeros(24)
    np.add.at(counts, hours, 1)
    sums = np.zeros((24, ds.n_regions))
    np.add.at(sums, hours, ds.values.astype(np.float64))
    return sums / np.maximum(counts, 1)[:, None], counts


def _cluster_name(profile: np.ndarray, weekend_ratio: float, cv: float, level_z: float) -> tuple[str, str]:
    peak = int(np.argmax(profile))
    night = float(profile[[0, 1, 2, 3, 4, 5]].mean())
    morning = float(profile[6:10].mean())
    midday = float(profile[10:16].mean())
    evening = float(profile[17:22].mean())
    amp = float(profile.max() - profile.min())
    if weekend_ratio > 1.15 and weekend_ratio > 1.0:
        return "周末休闲型", "周末流量显著高于工作日，常见于景区、商圈与休闲目的地。"
    if level_z > 0.8 and amp < 0.45:
        return "核心高负载型", "全天维持高位、波动较小，多为城市核心区或骨干枢纽。"
    if night > 0.85 and night > morning and night > midday:
        return "夜间活跃型", "夜间流量占比高，可能对应夜经济、交通枢纽或居住区夜间活动。"
    if evening > morning * 1.08 and evening > midday * 1.02:
        return "晚间生活型", "傍晚至夜间形成主峰，居住区与生活服务功能特征明显。"
    if morning > midday * 1.05 and evening > midday * 1.05:
        return "通勤双峰型", "早晚双峰、午间回落，典型职住通勤与商务办公节律。"
    if midday >= morning and midday >= evening:
        return "日间商务型", "日间持续高位，商业、办公与公共服务功能占主导。"
    if cv < 0.4 and amp < 0.35:
        return "平稳基荷型", "日内节律平缓，以稳定基础负载为主。"
    if night < 0.8 and morning > 1.0:
        return "早间通勤型", "清晨至上午快速抬升，通勤始发地与交通走廊特征明显。"
    return "混合功能型", "多种功能叠加，日内形态不呈现单一主导节律。"


def cluster(
    ds: Dataset,
    k: int = 4,
    method: str = "kmeans",
    use_profile: bool = True,
    use_weekend: bool = True,
    use_level: bool = True,
    use_variability: bool = True,
    auto_k: bool = False,
) -> dict[str, Any]:
    prof, _ = _hour_matrix(ds)
    means = ds.values.mean(axis=0).astype(float)
    stds = ds.values.std(axis=0).astype(float)
    cv = stds / np.maximum(means, 1e-9)
    wd = ds.times.weekday.to_numpy()
    weekend = wd >= 5
    weekday = ~weekend
    wk = ds.values[weekend].mean(axis=0) if weekend.any() else means
    wd_mean = ds.values[weekday].mean(axis=0) if weekday.any() else means
    weekend_ratio = wk / np.maximum(wd_mean, 1e-9)
    night_ratio = ds.values[(ds.times.hour < 6)].mean(axis=0) / np.maximum(means, 1e-9)
    peak_hour = np.argmax(prof, axis=0)

    # shape profile normalised by each region's own daily mean
    shape = prof / np.maximum(means, 1e-9)
    blocks: list[np.ndarray] = []
    names: list[str] = []
    weights: list[float] = []
    if use_profile:
        blocks.append(shape.T)
        names += [f"h{h:02d}" for h in range(24)]
        weights += [1.0] * 24
    if use_weekend:
        blocks.append(np.c_[np.log1p(weekend_ratio), night_ratio])
        names += ["周末比率", "夜间占比"]
        weights += [1.1, 0.8]
    if use_level:
        blocks.append(np.log1p(means).reshape(-1, 1))
        names += ["流量水平"]
        weights += [0.8]
    if use_variability:
        blocks.append(np.c_[cv, shape.max(axis=0)].reshape(-1, 2))
        names += ["波动系数", "峰值强度"]
        weights += [0.7, 0.7]

    if not blocks:
        raise ValueError("至少选择一类聚类特征")
    X = np.hstack(blocks)
    X = StandardScaler().fit_transform(X)
    weights_arr = np.array(weights, dtype=float)
    X = X * weights_arr
    X = StandardScaler().fit_transform(X)

    max_k = min(8, ds.n_regions - 1)
    curve: list[dict[str, Any]] = []
    for kk in range(2, max_k + 1):
        try:
            lab = KMeans(n_clusters=kk, n_init=8, random_state=42).fit_predict(X)
            score = silhouette_score(X, lab) if len(set(lab)) > 1 else -1
            curve.append({"k": kk, "score": _f(score, 4)})
        except Exception:
            continue
    if auto_k or k < 2:
        k = max(curve, key=lambda c: c["score"] or -1)["k"] if curve else 2
    k = int(max(2, min(k, max_k)))

    if method == "gmm":
        model = GaussianMixture(n_components=k, covariance_type="full", n_init=4, random_state=42).fit(X)
        labels = model.predict(X)
    elif method == "agglomerative":
        model = AgglomerativeClustering(n_clusters=k, linkage="ward").fit(X)
        labels = model.labels_
    else:
        model = KMeans(n_clusters=k, n_init=12, random_state=42).fit(X)
        labels = model.labels_
    labels = np.asarray(labels, dtype=int)
    if len(set(labels)) < 2:
        sil = 0.0
    else:
        sil = float(silhouette_score(X, labels))

    curve = [c for c in curve if c["k"] != k]
    curve.append({"k": k, "score": _f(sil, 4)})
    curve.sort(key=lambda c: c["k"])

    pca = PCA(n_components=2, random_state=42).fit(X)
    xy = pca.transform(X)
    level_z = (np.log1p(means) - np.log1p(means).mean()) / (np.log1p(means).std() + 1e-9)

    clusters = []
    name_counts: dict[str, int] = {}
    for c in range(k):
        mask = labels == c
        if not mask.any():
            continue
        cp = prof[:, mask].mean(axis=1)
        cp_norm = cp / max(cp.mean(), 1e-9)
        c_wr = float(weekend_ratio[mask].mean())
        c_cv = float(cv[mask].mean())
        c_lvl = float(means[mask].mean())
        c_lz = float(level_z[mask].mean())
        c_peak = int(np.argmax(cp_norm))
        base_name, desc = _cluster_name(cp_norm, c_wr, c_cv, c_lz)
        name_counts[base_name] = name_counts.get(base_name, 0) + 1
        name = base_name
        members = np.where(mask)[0]
        top_members = sorted(
            ({"id": ds.ids[i], "label": ds.label(ds.ids[i]), "mean": _f(means[i], 2)} for i in members),
            key=lambda r: r["mean"] or 0,
            reverse=True,
        )[:6]
        clusters.append(
            {
                "id": c,
                "name": name,
                "baseName": base_name,
                "color": PALETTE[c % len(PALETTE)],
                "size": int(mask.sum()),
                "share": _f(mask.mean() * 100, 2),
                "level": _f(c_lvl, 2),
                "levelZ": _f(c_lz, 3),
                "weekendRatio": _f(c_wr, 3),
                "nightRatio": _f(float(night_ratio[mask].mean()), 3),
                "cv": _f(c_cv, 3),
                "peakHour": c_peak,
                "profile": [_f(v, 4) for v in cp_norm],
                "rawProfile": [_f(v, 2) for v in cp],
                "description": desc,
                "topMembers": top_members,
            }
        )

    # Disambiguate repeated functional labels with a load-level prefix.
    repeated = {n for n, cnt in name_counts.items() if cnt > 1}
    used: dict[str, int] = {}
    for c in clusters:
        if c["baseName"] in repeated:
            lv = c["levelZ"]
            prefix = "高负载" if lv > 0.45 else "低负载" if lv < -0.45 else "中负载"
            c["name"] = f"{prefix}·{c['baseName']}"
        used[c["name"]] = used.get(c["name"], 0) + 1
        if used[c["name"]] > 1:
            c["name"] = f"{c['name']} {'ABCDEFGH'[used[c['name']] - 1]}"

    # feature mean by cluster, z-scored for the heatmap
    feat_means = []
    for j, nm in enumerate(names):
        col = X[:, j]
        feat_means.append(
            {
                "name": nm,
                "values": [_f(float(col[labels == c].mean()), 3) for c in range(k)],
            }
        )

    return {
        "dataset": ds.id,
        "k": k,
        "method": method,
        "silhouette": _f(sil, 4),
        "silhouetteCurve": curve,
        "labels": [
            {
                "id": rid,
                "label": ds.label(rid),
                "cluster": int(labels[i]),
                "mean": _f(means[i], 2),
            }
            for i, rid in enumerate(ds.ids)
        ],
        "clusters": clusters,
        "pca": [
            {
                "id": ds.ids[i],
                "label": ds.label(ds.ids[i]),
                "x": _f(xy[i, 0], 4),
                "y": _f(xy[i, 1], 4),
                "cluster": int(labels[i]),
                "mean": _f(means[i], 2),
            }
            for i in range(ds.n_regions)
        ],
        "explainedVariance": [_f(v, 4) for v in pca.explained_variance_ratio_],
        "features": feat_means,
        "featureNames": names,
        "nFeatures": len(names),
    }
