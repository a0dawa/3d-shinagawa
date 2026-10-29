# -*- coding: utf-8 -*-
"""data/gsipack.js と data/line.json を HTML に差し込む(マーカー間を置換)。
  使い方: python3 tools/embed_data.py [keikyu_shinagawa_3d.html]
  ・GSIPACK : /*@@GSIPACK_BEGIN@@*/ 〜 /*@@GSIPACK_END@@*/ の間を data/gsipack.js で置換(何度でも可)
  ・RAW.line: /*@@RAWLINE@@*/ があれば data/line.json の中心線(1行1要素)で置換(初回のみ)
  マーカーが想定数でなければ書き込む前に停止する。
"""
import json
import sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'keikyu_shinagawa_3d.html'
src = open(HTML, encoding='utf-8').read()
B, E = '/*@@GSIPACK_BEGIN@@*/', '/*@@GSIPACK_END@@*/'
if src.count(B) != 1 or src.count(E) != 1:
    raise SystemExit('MISMATCH: GSIPACK マーカーが1組ではない')
pack = open('data/gsipack.js', encoding='utf-8').read().strip()
a, b = src.index(B) + len(B), src.index(E)
src = src[:a] + pack + src[b:]
if '/*@@RAWLINE@@*/' in src:
    if src.count('/*@@RAWLINE@@*/') != 1:
        raise SystemExit('MISMATCH: RAWLINE マーカーが複数')
    L = json.load(open('data/line.json'))['line']
    rows = ',\n'.join('  [%.7f,%.7f]' % (la, lo) for la, lo in L)
    src = src.replace('/*@@RAWLINE@@*/', rows)
open(HTML, 'w', encoding='utf-8').write(src)
print('EMBED_OK (pack %d KB)' % (len(pack) // 1024))
