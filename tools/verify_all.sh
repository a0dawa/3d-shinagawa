#!/usr/bin/env bash
# 全チェックポイントを通しで実行する。どれか失敗したら止まる。
#   使い方: bash tools/verify_all.sh [keio_elevated_3d.html]
set -e
HTML="${1:-keio_elevated_3d.html}"
cd "$(dirname "$0")/.."

echo "[1/16] JS構文チェック ..."
python3 tools/check_syntax.py "$HTML"

echo "[2/16] スタブ実行(ReferenceError・初期化順序バグの検出) ..."
node tools/harness.js "$HTML"

echo "[3/16] 諸元表 ⇄ 実車実測値(ソースレベル) ..."
python3 tools/auto_check.py "$HTML"

echo "[4/16] 実ジオメトリ ⇄ 実車実測値(HTMLを実行して頂点を測定) ..."
node tools/verify_car.js "$HTML"

echo "[5/16] 自動運転(停止位置・停車時間・走行線) ..."
node tools/verify_run.js "$HTML"

echo "[6/16] 高架橋の桁幅・架線 ..."
node tools/verify_line.js "$HTML"

echo "[7/16] 街並みの配置・交差鉄道 ..."
node tools/verify_city.js "$HTML"

echo "[8/16] 照明と影 ..."
node tools/verify_light.js "$HTML"

echo "[9/16] 撮影モード(時刻・季節・カメラ) ..."
node tools/verify_cine.js "$HTML"

# ⑩ は実際に描いた画素を v4 の照合ツールで測る。ブラウザ(Playwright)と three.min.js が要るので、
#    環境変数 K8_PW(playwright-core のある node_modules)と K8_THREE を渡したときだけ走る。
echo "[10/16] 8000系の描画 ⇄ v4 の照合(側面45項目・前面14項目) ..."
node tools/verify_k8render.js --html "$HTML"

echo "[11/16] 駅の構造(建築限界・階段とEV・駅名標・公表デザインの要点・描画の数) ..."
node tools/verify_station.js "$HTML"

# ⑫ は実際に描いて描画の呼び出し・三角形・HTMLの大きさを予算と比べる(⑩と同じく K8_PW/K8_THREE が要る)
echo "[12/16] 描画の負荷 ⇄ 予算(tools/load_budget.json) ..."
node tools/measure_load.js --html "$HTML" --budget tools/load_budget.json

echo "[13/16] 軌道と分岐器(軌間・レールの高さ・まくらぎ・締結装置・分岐器の部品・道床・車止め) ..."
node tools/verify_track.js "$HTML"

echo "[14/16] 9000系の実ジオメトリ ⇄ 公表諸元(車体・扉間の窓・前面の非常扉・表示器・パンタ) ..."
node tools/verify_car9.js "$HTML"

echo "[15/16] 9000系の描画(帯・幕板・窓・前面のアイボリーと黒・灯火・表示器) ..."
node tools/verify_k9render.js --html "$HTML"

# ⑯ は航空写真を実際に描いて、地理院タイル(検証側が別に読む)と画素で位置を合わせる(⑩と同じく K8_PW/K8_THREE が要る。
#    地理院タイルに繋がらない環境では、繋がらないときの振る舞いだけを見て、位置合わせは SKIP)
echo "[16/16] 航空写真の描画(地理院タイルとの位置合わせ・繋がらないとき・ON/OFF) ..."
node tools/verify_ortho.js --html "$HTML"

echo ""
echo "==== ALL CHECKPOINTS PASSED ===="
