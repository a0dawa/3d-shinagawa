# -*- coding: utf-8 -*-
"""京急2100形 前面:実車写真 ⇄ モデル の照合(写真テクスチャ方式)。

  京王版と同じく「実車正面写真を車体座標へ実寸展開したテクスチャ(定数 FTEX)」で前面を作る方式に
  移行したときに使う。現在は写真が未入手のため、前面は頂点カラーの推定形状で描いている。
  FTEX が HTML に無い場合は SKIP と表示して終了コード0で抜ける(未検証であることを明示する)。

  使い方: python3 tools/verify_face.py [keikyu_shinagawa_3d.html]
"""
import re
import sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'keikyu_shinagawa_3d.html'
src = open(HTML, encoding='utf-8').read()
if not re.search(r'const FTEX=\{', src):
    print('SKIP: 前面の写真テクスチャ(FTEX)が未導入。前面は推定形状(未検証)')
    sys.exit(0)
print('FTEX あり:京王版 verify_face.py の照合ロジックを2100形の基準値で移植すること')
sys.exit(1)
