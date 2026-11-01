#!/usr/bin/env bash
# 全チェックポイントを通しで実行する(品川版)。どれか失敗したら止まる。
#   使い方: bash tools/verify_all.sh [keikyu_shinagawa_3d.html]
#
#   京王版から引き継いだ検証のうち、京王の駅・車両・交差鉄道・公表パースに依存するものは**未移植**で、
#   ここでは走らせない(末尾に一覧を出す)。移植したら下に足すこと。
set -e
HTML="${1:-keikyu_shinagawa_3d.html}"
cd "$(dirname "$0")/.."

echo "[1/11] JS構文チェック ..."
python3 tools/check_syntax.py "$HTML"

echo "[2/11] スタブ実行(ReferenceError・初期化順序バグの検出) ..."
node tools/harness.js "$HTML"

echo "[3/11] 線形・縦断・構造(曲線半径・勾配・構造の縁・JR と道路の桁下離隔・柱・停止位置) ..."
node tools/verify_geom.js "$HTML"

echo "[4/11] 京急2100形(車体・扉と窓・パンタ・編成) ..."
node tools/verify_car21.js "$HTML"

echo "[5/11] 自動運転(停車駅・停止位置・停車時間・曲線の制限速度・扉とホームドア) ..."
node tools/verify_run21.js "$HTML"

echo "[6/11] 軌道と分岐器(軌間=標準軌・まくらぎ・締結装置・分岐器の部品) ..."
node tools/verify_track.js "$HTML"

echo "[7/11] 照明と影 ..."
node tools/verify_light.js "$HTML"

echo "[8/11] 駅(建築限界・階段とEV・案内と発車標・駅名標・駅の要点・2面4線・ホームの人・乗り降り) ..."
node tools/verify_station.js "$HTML"

echo "[9/11] 撮影モード(時刻・季節・天候・夜の灯り・カメラ・到着と発車) ..."
node tools/verify_cine.js "$HTML"

# ⑩⑪ は実際に描いて測る(ブラウザ=Playwright と three.min.js r128 が要る)。環境変数 K8_PW(playwright-core のある
#    node_modules)・K8_THREE が無ければ、見つかる場所を使う(無ければ各ツールが SKIP を出す)
if [ -z "$K8_PW" ] && [ -d /opt/node-tools/node_modules/playwright-core ]; then export K8_PW=/opt/node-tools/node_modules; fi
if [ -z "$K8_THREE" ] && [ -f .work/node_modules/three/build/three.min.js ]; then export K8_THREE="$PWD/.work/node_modules/three/build/three.min.js"; fi
echo "[10/11] 描画の負荷 ⇄ 予算(tools/load_budget.json) ..."
node tools/measure_load.js --html "$HTML" --budget tools/load_budget.json

# ⑪ は航空写真を実際に描いて、地理院タイル(検証側が別に読む)と画素で位置を合わせる。繋がらない環境では振る舞いだけを見る
echo "[11/11] 航空写真の描画(地理院タイルとの位置合わせ・繋がらないとき・ON/OFF) ..."
node tools/verify_ortho.js --html "$HTML"

echo ""
echo "==== ALL CHECKPOINTS PASSED ===="
echo ""
echo "未移植(京王版の検証。品川版では走らせない):"
echo "  auto_check.py・verify_car.js・verify_k8render.js(京王8000系) / verify_car9.js・verify_k9render.js(京王9000系)"
echo "  verify_line.js(留置線) / verify_city.js(交差鉄道・京王の街の作り)"
