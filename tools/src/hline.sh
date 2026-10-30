#!/bin/bash
# harness の eval 内の行番号 → HTML の行番号と内容
off=$(grep -n "^<script>$" keikyu_shinagawa_3d.html | head -1 | cut -d: -f1)
for n in "$@"; do l=$((n+off-1)); echo "HTML $l: $(sed -n "${l}p" keikyu_shinagawa_3d.html | cut -c1-220)"; done
