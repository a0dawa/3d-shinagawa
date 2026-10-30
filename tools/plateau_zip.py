# -*- coding: utf-8 -*-
"""PLATEAU の zip(G空間情報センター・assets.cms.plateau.reearth.io。1区市で 0.4〜1GB)から、要るファイルだけを
HTTP の範囲指定で取り出す(zip 全体は落とさない)。plateau_tex.py(写真)・plateau_dem.py(地形)が使う。

  ・目次(central directory)を末尾から読み、ファイルごとの位置・大きさ・圧縮の方式を得る(ZIP64 にも対応)
  ・read(e) はファイル1つを丸ごと、stream(e) は解凍しながら少しずつ返す(地形の GML は解凍で 0.1〜0.7GB あるので
    手元に置かずに流して読む)
  ・入力は外部のデータ:名前と大きさを読むだけで、中身は呼ぶ側が数として解釈する。'..' を含む名前は返さない
  ・証明書は既定の検証を使う(環境変数 SSL_CERT_FILE で証明書の束を渡せる)
"""
import os
import ssl
import struct
import urllib.request
import zlib

_CTX = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or None)


def rng(url, a, b=None, tries=4):
    """url の a〜b バイト(b=None で終わりまで、a<0 で末尾 -a バイト)"""
    h = {'Range': 'bytes=%d' % a} if a < 0 else {'Range': 'bytes=%d-%s' % (a, '' if b is None else b)}
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), context=_CTX, timeout=180) as r:
                return r.read()
        except OSError as e:          # 回線の切断は間を空けて取り直す
            err = e
            import time
            time.sleep(2 ** (k + 1))
    raise err


def listing(url):
    """zip の目次:[{n:名前, m:圧縮の方式, c:圧縮後の大きさ, u:元の大きさ, o:局所ヘッダの位置}]"""
    tail = rng(url, -131072)
    i = tail.rfind(b'PK\x05\x06')
    if i < 0:
        raise SystemExit('zip の終わりの印が無い: ' + url)
    cd_size, cd_off = struct.unpack_from('<II', tail, i + 12)
    j = tail.rfind(b'PK\x06\x07')                 # ZIP64 の位置の印
    if j >= 0:
        z64 = struct.unpack_from('<Q', tail, j + 8)[0]
        z = rng(url, z64, z64 + 55)
        cd_size, cd_off = struct.unpack_from('<QQ', z, 40)
    cd = rng(url, cd_off, cd_off + cd_size - 1)
    out, p = [], 0
    while p + 46 <= len(cd) and cd[p:p + 4] == b'PK\x01\x02':
        meth, = struct.unpack_from('<H', cd, p + 10)
        csz, usz = struct.unpack_from('<II', cd, p + 20)
        nl, el, cl = struct.unpack_from('<HHH', cd, p + 28)
        lho, = struct.unpack_from('<I', cd, p + 42)
        name = cd[p + 46:p + 46 + nl].decode('utf-8', 'replace')
        ex, q = cd[p + 46 + nl:p + 46 + nl + el], 0
        while q + 4 <= len(ex):
            hid, hl = struct.unpack_from('<HH', ex, q)
            if hid == 1:                               # ZIP64 の大きさ・位置
                vals, k = list(struct.unpack_from('<' + 'Q' * (hl // 8), ex, q + 4)), 0
                if usz == 0xFFFFFFFF:
                    usz = vals[k]; k += 1
                if csz == 0xFFFFFFFF:
                    csz = vals[k]; k += 1
                if lho == 0xFFFFFFFF:
                    lho = vals[k]; k += 1
            q += 4 + hl
        if '..' not in name:
            out.append({'n': name, 'm': meth, 'c': csz, 'u': usz, 'o': lho})
        p += 46 + nl + el + cl
    return out


def _data_start(url, e):
    h = rng(url, e['o'], e['o'] + 29)
    if h[:4] != b'PK\x03\x04':
        raise SystemExit('局所ヘッダが無い: ' + e['n'])
    nl, el = struct.unpack_from('<HH', h, 26)
    return e['o'] + 30 + nl + el


def read(url, e):
    a = _data_start(url, e)
    d = rng(url, a, a + e['c'] - 1)
    return zlib.decompress(d, -15) if e['m'] == 8 else d


def stream(url, e, chunk=16 << 20):
    """解凍しながら少しずつ返す(bytes の列)"""
    a = _data_start(url, e)
    z = zlib.decompressobj(-15) if e['m'] == 8 else None
    end = a + e['c']
    while a < end:
        b = min(end, a + chunk)
        d = rng(url, a, b - 1)
        a = b
        yield z.decompress(d) if z else d
    if z:
        yield z.flush()


def read_many(url, ents, gap=1 << 20, most=32 << 20):
    """近くにある複数のファイルをまとめて取り出す(間が gap 未満なら1回の要求に)。{名前: 中身}"""
    ents = sorted(ents, key=lambda e: e['o'])
    out, i = {}, 0
    while i < len(ents):
        j, a0 = i, ents[i]['o']
        a1 = a0 + 30 + 1024 + ents[i]['c']
        while j + 1 < len(ents) and ents[j + 1]['o'] - a1 < gap and ents[j + 1]['o'] + ents[j + 1]['c'] - a0 < most:
            j += 1
            a1 = max(a1, ents[j]['o'] + 30 + 1024 + ents[j]['c'])
        blk = rng(url, a0, a1)
        for e in ents[i:j + 1]:
            p = e['o'] - a0
            if blk[p:p + 4] != b'PK\x03\x04':
                raise SystemExit('局所ヘッダが無い: ' + e['n'])
            nl, el = struct.unpack_from('<HH', blk, p + 26)
            d = blk[p + 30 + nl + el:p + 30 + nl + el + e['c']]
            if len(d) != e['c']:
                raise SystemExit('足りない: ' + e['n'])
            out[e['n']] = zlib.decompress(d, -15) if e['m'] == 8 else d
        i = j + 1
    return out
