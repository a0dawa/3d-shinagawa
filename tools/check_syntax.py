# -*- coding: utf-8 -*-
"""HTML内の<script>を取り出して node --check で構文検査する。
   使い方: python3 tools/check_syntax.py [keikyu_shinagawa_3d.html]
"""
import re
import subprocess
import sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'keikyu_shinagawa_3d.html'
src = open(HTML, encoding='utf-8').read()
# 本体:2026-11 から <script id="keio-main" type="text/x-keio">(読み込み係が「//@@PART」の行で分けて実行する)。
# 全体と、片ごと(片は別のスクリプトとして実行されるので、それぞれが文法として閉じていること)を検査する
scripts = re.findall(r'<script id="keio-main" type="text/x-keio">(.*?)</script>', src, re.S) or re.findall(r'<script>(.*?)</script>', src, re.S)
if not scripts:
    print('NO_SCRIPT'); sys.exit(1)
parts = re.split(r'^//@@PART\s+\d+.*$', scripts[0], flags=re.M)
for k, code in enumerate([scripts[0]] + (parts if len(parts) > 1 else [])):
    open('/tmp/_check.js', 'w').write(code)
    r = subprocess.run(['node', '--check', '/tmp/_check.js'], capture_output=True, text=True)
    if r.returncode != 0:
        print('SYNTAX_ERROR' + ('' if k == 0 else '(片 %d/%d)' % (k - 1, len(parts))))
        print(r.stderr)
        sys.exit(1)
# 区切りの進み具合は増えていく(読み込み中…○○% が戻らない)
pc = [int(x) for x in re.findall(r'^//@@PART\s+(\d+)', scripts[0], flags=re.M)]
if any(b <= a for a, b in zip(pc, pc[1:])) or any(not (0 < x < 100) for x in pc):
    print('SYNTAX_ERROR(区切りの進み具合が増えていない: %s)' % pc); sys.exit(1)
print('SYNTAX_OK' + (' (%d片)' % len(parts) if len(parts) > 1 else ''))
