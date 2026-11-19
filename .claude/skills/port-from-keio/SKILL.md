---
name: port-from-keio
description: 3d-keio(京王線の3Dビューア)でできた進歩を、このリポジトリ(別の駅・路線の3Dモデル)へ移す手順。「京王の最新を取り込みたい」「3d-keio の○○をこっちにも」「京王で何が増えたか確かめたい」と言われたときに使う。
---

# 京王(上流)の進歩をこのリポジトリへ移す

上流は公開リポジトリ `a0dawa/3d-keio`(最新は作業ブランチ `claude/blender-files-push-65wzu0`。main に取り込み済みなら main でもよい。`UPSTREAM.json` の `upstream_branch`)。機能の目録は `reference/porting/features.json`、状況表の道具は `tools/upstream_status.py`。
このリポジトリの取り込みの記録は、ルートの `UPSTREAM.json`。

## 手順

1. **上流を用意する**:セッションに `a0dawa/3d-keio` を `add_repo`(読み取りで足りる)し、`git clone --depth 1 --branch <upstream_branch> https://github.com/a0dawa/3d-keio <作業フォルダ>`(1つずつ・時間に余裕を)。
   すでに `/home/user/3d-keio` などにあればそれを使う(`git -C … pull` で最新に)。
2. **状況を出す**:`python3 -I <3d-keio>/tools/upstream_status.py status . --keio <3d-keio>`
   取り込み済み/一部/未、先に要る物が済んでいる「次に移せる機能」、監査の後に京王で増えた機能が出る。
3. **移す機能を選ぶ**:利用者に指示があればそれ。無ければ「次に移せる機能」の先頭から。1回の作業は数項目まで。
   portable が **A**=そのまま移せる、**B**=線区のデータ(座標・寸法・資料)を作り直す、**C**=京王専用(移さない)。
4. **京王の実装を読む**:目録の `doc` の節を `<3d-keio>/CLAUDE.md` で読む(設計の理由と躓きが書いてある)。`since` のコミットの差分(`git -C <3d-keio> show <since>`)が移す範囲の目安。
   京王の識別子(駅名・s・off・京王の資料の値)をそのまま持ち込まない。**基準値は新しい線区の資料から検証側に書く**(HTML から読ませない)。
5. **移す**:このリポジトリの作業ルール(CLAUDE.md の厳密一致置換・チェックポイント)に従う。1回の編集ごとに、このリポジトリの検証(`verify_all` など)を通す。
   目録の `verify` に書いた京王の検証(例 ⑦⑯)は、このリポジトリで対応する検査を作る・移す(基準は検証側に)。
   エンジンを共有している線区(戸越公園など)は、エンジンの差し替えの前後で京王の出力が変わらないこと(指紋・回帰)も確かめる。
6. **記録する**:取り込んだら `UPSTREAM.json` の `audited`(今日)と `keio_commit`(取り込んだ時点の京王の `git rev-parse --short HEAD`)を更新し、
   この線区に要らない機能は `overrides` に `{"status":"n/a","note":"理由"}`、一部だけなら `partial` と note を書く。
   自動検出が見る文字列(`detect`)が取り込み先で名前を変えているときも overrides で手書きする。
7. **コミット**:作業ブランチへ。メッセージに「京王の <feature id> を取り込み」と書く。main へのマージは利用者の指示を待つ。

## 逆向き(このリポジトリの進歩を京王へ)
このリポジトリで見つけた躓き・直し方が京王にも効くなら、利用者に伝えて京王の `TEMPLATE.md` の躓き集と `features.json` へ足す相談をする
(勝手に京王へ書き込まない)。

## 注意
- 写真・発表資料の画像は同梱しない(測った値と測り方だけを書く)。PLATEAU の写真テクスチャだけは CC BY 4.0 なので可。出典を CREDITS に。
- 京王の履歴を書き換えると、目録の `since` が履歴に無くなる(`upstream_status.py check` が NG を出す)。そのときは日付で探して直す。
- 状況表の判定は文字列の有無なので、名前を変えて取り込んだ機能は未と出る。overrides で直す。
