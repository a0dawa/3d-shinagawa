# -*- coding: utf-8 -*-
"""HTML内の<script>を取り出して node --check で構文検査する。
   使い方: python3 tools/check_syntax.py [keio_elevated_3d.html]
"""
import re
import subprocess
import sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'keio_elevated_3d.html'
src = open(HTML, encoding='utf-8').read()
scripts = re.findall(r'<script>(.*?)</script>', src, re.S)
if not scripts:
    print('NO_SCRIPT'); sys.exit(1)
open('/tmp/_check.js', 'w').write(scripts[0])
r = subprocess.run(['node', '--check', '/tmp/_check.js'], capture_output=True, text=True)
if r.returncode == 0:
    print('SYNTAX_OK')
else:
    print('SYNTAX_ERROR')
    print(r.stderr)
    sys.exit(1)
