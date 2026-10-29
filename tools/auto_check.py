# -*- coding: utf-8 -*-
"""京急2100形:モデル定数 ⇄ 公称諸元 の照合。

  HTML内の定数(LEN_CAB/LEN_MID/CW/C_ROOF/C_FLR/DOORW/DOORX)を読み取り、公称値と比較する。
  帯・窓・前面の高さ(WINB/WINT/WHB/WHT/FWB/FWT)は実車写真による実測が未実施のため
  「未検証」として値を表示するだけにする(写真を入手したら REF_PHOTO に実測値を入れて照合)。

  使い方: python3 tools/auto_check.py [keikyu_shinagawa_3d.html]
"""
import re
import sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'keikyu_shinagawa_3d.html'
TOL = 0.01
# 公称諸元[m](出典:検索で確認できた値。先頭車全長・中間車全長・車体幅・屋根高さ・床面高さ・扉幅)
REF = {'先頭車 全長': 18.17, '中間車 全長': 18.00, '車体幅': 2.78, '屋根高さ': 3.645, '床面高さ': 1.153, '扉幅': 1.20}
REF_PHOTO = {}   # 例: {'側窓 下端': 2.02} … 実車写真の実測値(未入手)


def g(src, pat):
    m = re.search(pat, src)
    if not m:
        print('NG: 定数が見つからない: %s' % pat)
        sys.exit(1)
    return float(m.group(1))


def main():
    src = open(HTML, encoding='utf-8').read()
    mdl = {
        '先頭車 全長': g(src, r'const LEN_CAB=([\d.]+)'),
        '中間車 全長': g(src, r'LEN_MID=([\d.]+)'),
        '車体幅': g(src, r'\bCW=([\d.]+)'),
        '屋根高さ': g(src, r'C_ROOF=([\d.]+)'),
        '床面高さ': g(src, r'C_FLR=([\d.]+)'),
        '扉幅': g(src, r'const DOORW=([\d.]+)'),
    }
    doors = re.search(r'DOORX=\[([^\]]*)\]', src).group(1).split(',')
    print('=== 京急2100形:モデル定数 ⇄ 公称諸元 ===')
    print('%-10s %8s %8s %8s  %s' % ('項目', '公称[m]', 'モデル[m]', '差[m]', '判定'))
    ng = 0
    for k, v in REF.items():
        d = mdl[k] - v
        ok = abs(d) <= TOL
        ng += 0 if ok else 1
        print('%-10s %8.3f %8.3f %8.3f  %s' % (k, v, mdl[k], d, 'OK' if ok else 'NG'))
    ok = len(doors) == 2
    ng += 0 if ok else 1
    print('%-10s %8s %8d %8s  %s' % ('片側扉数', '2', len(doors), '-', 'OK' if ok else 'NG'))
    print('\n--- 写真による照合が未実施の推定値(参考表示) ---')
    for name in ('WINB', 'WINT', 'WHB', 'WHT', 'FWB', 'FWT'):
        m = re.search(r'\b%s=([\d.]+)' % name, src)
        print('  %-5s = %s m  … 未検証(実車写真の提供待ち)' % (name, m.group(1) if m else '?'))
    for k, v in REF_PHOTO.items():
        print('  写真実測 %s = %.2f(照合ロジックは写真入手時に追加)' % (k, v))
    print('\nRESULT:', 'PASS(公称諸元 ±%.2fm 以内)' % TOL if ng == 0 else 'FAIL(%d項目NG)' % ng)
    sys.exit(1 if ng else 0)


if __name__ == '__main__':
    main()
