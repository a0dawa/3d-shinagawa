#!/usr/bin/env bash
# 全チェックポイントを通しで実行する。どれか失敗したら止まる。
#   使い方: bash tools/verify_all.sh [keikyu_shinagawa_3d.html]
set -e
cd "$(dirname "$0")/.."
HTML="${1:-keikyu_shinagawa_3d.html}"

echo "[1/5] JS構文チェック ..."
python3 tools/check_syntax.py "$HTML"

echo "[2/5] スタブ実行(ReferenceError検出) ..."
node tools/harness.js "$HTML"

echo "[3/5] 数値検証(線形・縦断・離隔・自動運転) ..."
node tools/verify_geom.js "$HTML"

echo "[4/5] 2100形 公称諸元 ..."
python3 tools/auto_check.py "$HTML"

echo "[5/5] 前面テクスチャ = 実車写真 ..."
python3 tools/verify_face.py "$HTML"

echo ""
echo "==== ALL CHECKPOINTS PASSED ===="
