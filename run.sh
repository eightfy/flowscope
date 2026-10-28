#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${PORT:-8000}"

if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "[FlowScope] 创建 Python 环境…"
  "$PYTHON_BIN" -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r backend/requirements.txt
fi

if [ ! -f "prepared/datasets.json" ]; then
  echo "[FlowScope] 预处理数据…"
  .venv/bin/python scripts/prepare_data.py
fi

if [ ! -f "frontend/dist/index.html" ]; then
  echo "[FlowScope] 构建前端…"
  (cd frontend && npm install --cache .npm-cache --no-audit --no-fund && npm run build)
fi

echo ""
echo "  FlowScope 已启动"
echo "  → http://127.0.0.1:${PORT}"
echo "  API 文档: http://127.0.0.1:${PORT}/docs"
echo ""

exec .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port "${PORT}"
