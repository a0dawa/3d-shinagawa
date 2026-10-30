# 開始アンカー〜終了アンカー(終了は残す)を切り取る。各アンカーは1回だけ出現すること(違えば書き込む前に停止)
import sys
def cut(src, a, b, repl=''):
    assert src.count(a)==1, ('MISMATCH start', src.count(a), a[:60])
    i=src.index(a); j=src.index(b, i)
    assert src.count(b)>=1
    return src[:i]+repl+src[j:]
def rep(src, a, b, n=1):
    assert src.count(a)==n, ('MISMATCH rep', src.count(a), a[:60])
    return src.replace(a,b)
