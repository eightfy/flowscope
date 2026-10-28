from __future__ import annotations

import copy
from typing import Any

ALGORITHMS: list[dict[str, Any]] = [
    {
        "id": "naive",
        "name": "朴素预测",
        "group": "基线模型",
        "tag": "Naive",
        "description": "用最后一个观测值作为未来所有时刻的预测，是最低参照线。",
        "params": [],
    },
    {
        "id": "seasonal_naive",
        "name": "季节朴素",
        "group": "基线模型",
        "tag": "Seasonal Naive",
        "description": "按一天前的同一时刻外推，能捕捉日内周期，是强基线。",
        "params": [
            {"key": "season", "label": "季节周期（步）", "type": "int", "default": "auto", "min": 2, "max": 2016, "step": 1, "help": "10 分钟数据一天 = 144 步；15 分钟 = 96 步。"},
        ],
    },
    {
        "id": "moving_average",
        "name": "移动平均",
        "group": "基线模型",
        "tag": "Moving Average",
        "description": "用最近窗口的均值作为稳定预测，适合平稳负载。",
        "params": [
            {"key": "window", "label": "平滑窗口", "type": "int", "default": 6, "min": 2, "max": 288, "step": 1},
        ],
    },
    {
        "id": "exp_smoothing",
        "name": "指数平滑",
        "group": "统计模型",
        "tag": "Exp. Smoothing",
        "description": "对历史观测做指数衰减加权，近期数据权重更高。",
        "params": [
            {"key": "alpha", "label": "平滑系数 α", "type": "float", "default": 0.25, "min": 0.01, "max": 0.99, "step": 0.01},
        ],
    },
    {
        "id": "holt_winters",
        "name": "Holt-Winters",
        "group": "统计模型",
        "tag": "ETS / Holt-Winters",
        "description": "三参数指数平滑，可分解水平、趋势与季节项，对日内周期效果好。",
        "params": [
            {"key": "season_length", "label": "季节周期（步）", "type": "int", "default": "auto", "min": 2, "max": 2016, "step": 1},
            {"key": "trend", "label": "趋势项", "type": "select", "default": "add", "options": [{"value": "add", "label": "加法"}, {"value": "none", "label": "无"}]},
            {"key": "seasonal", "label": "季节项", "type": "select", "default": "add", "options": [{"value": "add", "label": "加法"}, {"value": "mul", "label": "乘法"}, {"value": "none", "label": "无"}]},
            {"key": "damped", "label": "阻尼趋势", "type": "bool", "default": False},
        ],
    },
    {
        "id": "sarima",
        "name": "SARIMA",
        "group": "统计模型",
        "tag": "SARIMAX",
        "description": "自回归积分滑动平均模型，可显式建模季节性。季节阶数越高、训练越慢。",
        "params": [
            {"key": "p", "label": "AR 阶 p", "type": "int", "default": 2, "min": 0, "max": 6, "step": 1},
            {"key": "d", "label": "差分阶 d", "type": "int", "default": 1, "min": 0, "max": 2, "step": 1},
            {"key": "q", "label": "MA 阶 q", "type": "int", "default": 2, "min": 0, "max": 6, "step": 1},
            {"key": "P", "label": "季节 AR 阶 P", "type": "int", "default": 0, "min": 0, "max": 3, "step": 1},
            {"key": "D", "label": "季节差分 D", "type": "int", "default": 0, "min": 0, "max": 1, "step": 1},
            {"key": "Q", "label": "季节 MA 阶 Q", "type": "int", "default": 0, "min": 0, "max": 3, "step": 1},
            {"key": "m", "label": "季节周期 m", "type": "int", "default": 0, "min": 0, "max": 288, "step": 1, "help": "0 表示不启用季节项；启用 144/96 会明显变慢。"},
            {"key": "max_iter", "label": "最大迭代", "type": "int", "default": 50, "min": 10, "max": 300, "step": 10},
        ],
    },
    {
        "id": "ridge_ar",
        "name": "岭回归 AR",
        "group": "机器学习",
        "tag": "Ridge",
        "description": "用滞后窗口做线性自回归，L2 正则抑制过拟合，训练极快。",
        "params": [
            {"key": "alpha", "label": "正则强度 α", "type": "float", "default": 1.0, "min": 0.0001, "max": 1000, "step": 0.1},
        ],
    },
    {
        "id": "lasso_ar",
        "name": "Lasso AR",
        "group": "机器学习",
        "tag": "Lasso",
        "description": "带 L1 正则的线性自回归，会自动挑选重要滞后项，可解释性强。",
        "params": [
            {"key": "alpha", "label": "正则强度 α", "type": "float", "default": 0.01, "min": 0.00001, "max": 10, "step": 0.001},
        ],
    },
    {
        "id": "knn",
        "name": "K 近邻回归",
        "group": "机器学习",
        "tag": "KNN",
        "description": "在历史窗口中查找最相似的 K 个片段，以邻居下一步的走势做预测。",
        "params": [
            {"key": "k", "label": "邻居数 K", "type": "int", "default": 8, "min": 1, "max": 50, "step": 1},
            {"key": "weights", "label": "邻居权重", "type": "select", "default": "distance", "options": [{"value": "uniform", "label": "等权"}, {"value": "distance", "label": "距离加权"}]},
        ],
    },
    {
        "id": "random_forest",
        "name": "随机森林",
        "group": "机器学习",
        "tag": "Random Forest",
        "description": "多棵决策树集成，稳健、无需精细调参，可给出滞后特征重要性。",
        "params": [
            {"key": "n_estimators", "label": "树数量", "type": "int", "default": 160, "min": 20, "max": 600, "step": 10},
            {"key": "max_depth", "label": "最大深度", "type": "int", "default": 14, "min": 2, "max": 60, "step": 1},
            {"key": "min_samples_leaf", "label": "叶节点最小样本", "type": "int", "default": 2, "min": 1, "max": 30, "step": 1},
            {"key": "max_features", "label": "特征采样", "type": "select", "default": "sqrt", "options": [{"value": "sqrt", "label": "sqrt"}, {"value": "log2", "label": "log2"}, {"value": "1.0", "label": "全部"}]},
        ],
    },
    {
        "id": "extra_trees",
        "name": "极端随机树",
        "group": "机器学习",
        "tag": "Extra Trees",
        "description": "随机分裂阈值比随机森林更激进，方差更低、训练更快。",
        "params": [
            {"key": "n_estimators", "label": "树数量", "type": "int", "default": 180, "min": 20, "max": 600, "step": 10},
            {"key": "max_depth", "label": "最大深度", "type": "int", "default": 16, "min": 2, "max": 60, "step": 1},
            {"key": "min_samples_leaf", "label": "叶节点最小样本", "type": "int", "default": 2, "min": 1, "max": 30, "step": 1},
        ],
    },
    {
        "id": "gradient_boosting",
        "name": "梯度提升树",
        "group": "机器学习",
        "tag": "Gradient Boosting",
        "description": "逐步拟合残差的加法树模型，精度高，支持实时查看逐轮验证误差。",
        "params": [
            {"key": "n_estimators", "label": "迭代轮数", "type": "int", "default": 200, "min": 20, "max": 800, "step": 10},
            {"key": "learning_rate", "label": "学习率", "type": "float", "default": 0.06, "min": 0.005, "max": 0.5, "step": 0.005},
            {"key": "max_depth", "label": "树深度", "type": "int", "default": 3, "min": 2, "max": 10, "step": 1},
            {"key": "subsample", "label": "样本采样率", "type": "float", "default": 0.9, "min": 0.4, "max": 1.0, "step": 0.05},
        ],
    },
    {
        "id": "hist_gb",
        "name": "直方图提升树",
        "group": "机器学习",
        "tag": "HistGradientBoosting",
        "description": "LightGBM 风格的直方图分箱提升树，大样本下速度快、内存友好。",
        "params": [
            {"key": "max_iter", "label": "迭代轮数", "type": "int", "default": 220, "min": 20, "max": 800, "step": 10},
            {"key": "learning_rate", "label": "学习率", "type": "float", "default": 0.07, "min": 0.005, "max": 0.5, "step": 0.005},
            {"key": "max_leaf_nodes", "label": "最大叶节点", "type": "int", "default": 31, "min": 4, "max": 128, "step": 1},
            {"key": "l2_regularization", "label": "L2 正则", "type": "float", "default": 1.0, "min": 0.0, "max": 100, "step": 0.5},
        ],
    },
    {
        "id": "mlp",
        "name": "多层感知机",
        "group": "深度学习",
        "tag": "MLP Neural Net",
        "description": "全连接神经网络，逐 epoch 训练并实时回报训练/验证损失，支持早停。",
        "params": [
            {"key": "hidden", "label": "隐藏层结构", "type": "select", "default": "96,48", "options": [{"value": "64", "label": "64"}, {"value": "96,48", "label": "96 → 48"}, {"value": "128,64,32", "label": "128 → 64 → 32"}, {"value": "256,128", "label": "256 → 128"}]},
            {"key": "alpha", "label": "L2 正则", "type": "float", "default": 0.001, "min": 0.0, "max": 1.0, "step": 0.001},
            {"key": "lr", "label": "学习率", "type": "float", "default": 0.003, "min": 0.0001, "max": 0.05, "step": 0.0005},
            {"key": "epochs", "label": "最大轮数", "type": "int", "default": 80, "min": 5, "max": 300, "step": 5},
            {"key": "patience", "label": "早停耐心", "type": "int", "default": 12, "min": 3, "max": 50, "step": 1},
        ],
    },
    {
        "id": "svr",
        "name": "支持向量回归",
        "group": "机器学习",
        "tag": "SVR (RBF)",
        "description": "RBF 核支持向量回归，对小样本非线性关系表现稳健。",
        "params": [
            {"key": "C", "label": "惩罚系数 C", "type": "float", "default": 10.0, "min": 0.1, "max": 1000, "step": 0.5},
            {"key": "epsilon", "label": "容忍带 ε", "type": "float", "default": 0.02, "min": 0.001, "max": 1.0, "step": 0.001},
            {"key": "gamma", "label": "核宽度 γ", "type": "select", "default": "scale", "options": [{"value": "scale", "label": "scale"}, {"value": "auto", "label": "auto"}]},
        ],
    },
]

ALGO_MAP = {a["id"]: a for a in ALGORITHMS}

AUTO_SEASON = {10: 144, 15: 96, 5: 288, 30: 48, 60: 24}


def resolve_params(algo_id: str, params: dict[str, Any] | None, interval_min: int) -> dict[str, Any]:
    algo = ALGO_MAP.get(algo_id)
    if not algo:
        raise ValueError(f"未知算法: {algo_id}")
    supplied = params or {}
    out: dict[str, Any] = {}
    for p in algo["params"]:
        key = p["key"]
        raw = supplied.get(key, p["default"])
        if raw == "auto" or (key in ("season", "season_length") and raw is None):
            raw = AUTO_SEASON.get(interval_min, 24)
        typ = p["type"]
        if typ == "bool":
            out[key] = bool(raw)
        elif typ == "int":
            out[key] = int(max(p.get("min", -10**9), min(p.get("max", 10**9), int(float(raw)))))
        elif typ == "float":
            out[key] = float(max(p.get("min", -1e18), min(p.get("max", 1e18), float(raw))))
        elif typ == "select":
            allowed = {o["value"] for o in p.get("options", [])}
            out[key] = raw if raw in allowed else p["default"]
        else:
            out[key] = raw
    return out


def registry(interval_min: int) -> list[dict[str, Any]]:
    items = copy.deepcopy(ALGORITHMS)
    for a in items:
        for p in a["params"]:
            if p.get("default") == "auto":
                p["default"] = AUTO_SEASON.get(interval_min, 24)
    return items
