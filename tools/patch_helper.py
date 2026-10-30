# -*- coding: utf-8 -*-
"""パッチ適用のヘルパー。厳密一致置換で、失敗時は書き込む前に停止する。

  from tools.patch_helper import Patcher
  p = Patcher('keio_elevated_3d.html')
  p.rep('置換前の厳密一致文字列', '置換後')      # 1回だけ出現する前提。違えば例外
  p.insert_before('アンカー', '挿入するコード')
  p.save()                                        # ここで初めてファイルへ書き込む

  重要:
    - rep() は出現回数を検査し、想定と違えば MISMATCH で停止(部分適用を防ぐ)
    - すべての編集が成功してから save() する(書き込み後にassertする事故を防ぐ)
    - 再開時は grep で適用済みマーカーを確認し、未適用分だけ流す
"""


class Patcher:
    def __init__(self, path):
        self.path = path
        self.src = open(path, encoding='utf-8').read()

    def rep(self, old, new, count=1):
        n = self.src.count(old)
        if n != count:
            raise AssertionError('MISMATCH(%d!=%d): %s' % (n, count, old[:70]))
        self.src = self.src.replace(old, new)
        return self

    def insert_before(self, anchor, text):
        i = self.src.index(anchor)          # 見つからなければ例外
        self.src = self.src[:i] + text + self.src[i:]
        return self

    def insert_after(self, anchor, text):
        i = self.src.index(anchor) + len(anchor)
        self.src = self.src[:i] + text + self.src[i:]
        return self

    def cut(self, start_anchor, end_anchor):
        a = self.src.index(start_anchor)
        b = self.src.index(end_anchor, a)
        self.src = self.src[:a] + self.src[b:]
        return self

    def has(self, s):
        return s in self.src

    def save(self):
        open(self.path, 'w', encoding='utf-8').write(self.src)
        return self
