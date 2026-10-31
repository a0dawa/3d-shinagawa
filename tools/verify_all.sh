#!/usr/bin/env bash
# 全チェックポイントを通しで実行する(品川版)。どれか失敗したら止まる。
#   使い方: bash tools/verify_all.sh [keikyu_shinagawa_3d.html]
#
#   京王版から引き継いだ検証のうち、京王の駅・車両・交差鉄道・公表パースに依存するものは**未移植**で、
#   ここでは走らせない(末尾に一覧を出す)。移植したら下に足すこと。
set -e
HTML="${1:-keikyu_shinagawa_3d.html}"
cd "$(dirname "$0")/.."

echo "[1/7] JS構文チェック ..."
python3 tools/check_syntax.py "$HTML"

echo "[2/7] スタブ実行(ReferenceError・初期化順序バグの検出) ..."
node tools/harness.js "$HTML"

echo "[3/7] 線形・縦断・構造(曲線半径・勾配・構造の縁・JR と道路の桁下離隔・柱・停止位置) ..."
node tools/verify_geom.js "$HTML"

echo "[4/7] 京急2100形(車体・扉と窓・パンタ・編成) ..."
node tools/verify_car21.js "$HTML"

echo "[5/7] 自動運転(停車駅・停止位置・停車時間・曲線の制限速度・扉とホームドア) ..."
node tools/verify_run21.js "$HTML"

echo "[6/7] 軌道と分岐器(軌間=標準軌・まくらぎ・締結装置・分岐器の部品) ..."
node tools/verify_track.js "$HTML"

echo "[7/7] 照明と影 ..."
node tools/verify_light.js "$HTML"

echo ""
echo "==== ALL CHECKPOINTS PASSED ===="
echo ""
echo "未移植(京王版の検証。品川版では走らせない):"
echo "  auto_check.py・verify_car.js・verify_k8render.js(京王8000系) / verify_car9.js・verify_k9render.js(京王9000系)"
echo "  verify_line.js(留置線) / verify_city.js・verify_station.js(京王の各駅・交差鉄道・公表パース)"
echo "  verify_cine.js(撮影モード:京王の停車駅・土地利用の面) / measure_load.js・verify_ortho.js(要ブラウザ。予算は京王版の値)"
