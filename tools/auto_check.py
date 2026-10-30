# -*- coding: utf-8 -*-
"""京王8000系:HTML内の"諸元表"を基準値と照合する(ソースレベルの検査)。③

  役割分担:
    auto_check.py      … HTMLに書かれた数値そのものを検査する。実行しないので速く、
                         表を書き換えた瞬間に落ちる。
    verify_car.js      … HTMLを実行して"出来上がったジオメトリ"を測る。
    verify_k8render.js … 実際に描いた画素を v4 の照合ツールで測る(帯・窓・前面)。
  三つあることで「表を直したのにモデルが追従していない」「モデルを直すために
  表を書き換えてしまった」「表も形も正しいのに塗り分けがずれている」を検出できる。

  基準の出典(2026-10 差し替え):
    reference/keio8000_v4/ref/keio8000_measured_v4.md
    (RailFile.jp 8714編成の山側・海側の編成写真を 60px/m で測った値と前面写真の実測)
    ※旧 [B] 写真実測・[D] 前面仕様書による車体は v4 に置き換えた。

  使い方: python3 tools/auto_check.py [keio_elevated_3d.html]
"""
import re
import sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'keio_elevated_3d.html'

# v4 の実測値[m](検証側が独立して持つ。HTML から読まない)
REF_V4 = {
    'LEN': 19.5, 'PITCH': 20.0, 'HWB': 1.385,
    'Z_BOT': 1.007, 'Z_FLR': 1.147, 'Z_SH0': 3.387, 'Z_CROWN': 3.72,
    'WZ0': 1.995, 'WZ1': 2.927, 'DWZ1': 2.908, 'DZ1': 3.061, 'DOOR_HW': 0.648,
    'RED_UP': [1.650, 1.853], 'BLUE': [1.573, 1.609], 'RED_LO': [1.266, 1.520],
    'MAKU': [3.198, 3.282], 'MAKU_END': 9.67, 'MAKU_CAB': 8.29, 'IVORY_X': 8.39,
    'CREW': [8.527, 9.01], 'WRAP_X': 9.31, 'BOGIE_X': 6.88, 'AC_TOP': 4.055,
    'DOORX': [-7.05, -2.35, 2.35, 7.05],
}
# 色(sRGB 0〜1)。v4 の材質の値
REF_COLOR = {
    'C_RED': (0.83, 0.02, 0.42),      # 京王レッド(帯)
    'C_BLUE': (0.11, 0.17, 0.42),     # 京王ブルー(細線)
    'C_IVORY': (0.90, 0.88, 0.80),    # 運転台部のアイボリー
}
REF_FORM = {'8714F': ['8714', '8014', '8064', '8114', '8164', '8514', '8564', '8214', '8264', '8764']}
REF_PANTO = [2, 4, 5, 8, 9]           # 新宿方から何両目(8714F で写真確認済み)


def main():
    src = open(HTML, encoding='utf-8').read()
    ng = 0

    def row(label, want, got, ok):
        nonlocal ng
        ng += 0 if ok else 1
        print('%-22s %22s %22s  %s' % (label, want, got, 'OK' if ok else 'NG'))

    print('=== 京王8000系(v4):諸元表 ⇄ 実測値(ソースレベル) ===')
    print('%-22s %22s %22s  %s' % ('項目', '実測', 'モデル', '判定'))
    # K8 表の中身(1か所に集約されていること)
    m = re.search(r'const K8=\{([\s\S]*?)\n\};', src)
    if not m:
        print('NG: K8 表が見つからない')
        sys.exit(1)
    k8 = m.group(1)
    for key, want in REF_V4.items():
        mm = re.search(r'\b%s:(\[[^\]]*\]|-?[\d.]+)' % key, k8)
        if not mm:
            row(key, str(want), 'なし', False)
            continue
        txt = mm.group(1)
        got = [float(v) for v in txt.strip('[]').split(',')] if txt.startswith('[') else float(txt)
        if isinstance(want, list):
            ok = isinstance(got, list) and len(got) == len(want) and all(abs(a - b) < 1e-9 for a, b in zip(got, want))
        else:
            ok = not isinstance(got, list) and abs(got - want) < 1e-9
        row(key, str(want), str(got), ok)

    # 軌間(レールの敷設と車輪位置が同じ定数から決まる)
    mm = re.search(r'const GAUGE=([\d.]+);', src)
    row('軌間(レール内面間)', '1.372', mm.group(1) if mm else 'なし', bool(mm) and abs(float(mm.group(1)) - 1.372) < 1e-9)

    # 帯の色(シェーダの定数は k8lin(sRGB) で書く)
    for key, (r, g, b) in REF_COLOR.items():
        mm = re.search(r"'#define %s '\+c3\(k8lin\(([^)]*)\)\)" % key, src)
        got = tuple(float(v) for v in mm.group(1).split(',')) if mm else None
        ok = got is not None and all(abs(a - b2) < 1e-9 for a, b2 in zip(got, (r, g, b)))
        row('色 ' + key, '%.2f,%.2f,%.2f' % (r, g, b), ('%.2f,%.2f,%.2f' % got) if got else 'なし', ok)

    # 編成(車番の並び・パンタの位置)
    mm = re.search(r"'8714F':\{cars:\[([^\]]*)\],\s*panto:\[([^\]]*)\]", src)
    cars = [c.strip().strip("'") for c in mm.group(1).split(',')] if mm else []
    panto = [int(v) for v in mm.group(2).split(',')] if mm else []
    row('8714F の車番', ' '.join(REF_FORM['8714F'][:3]) + '…', ' '.join(cars[:3]) + '…', cars == REF_FORM['8714F'])
    row('パンタ(新宿方から)', str(REF_PANTO), str(panto), panto == REF_PANTO)

    # 前面の輪郭・開口の作り方が v4 と同じこと(関数がそろっている)
    for label, pat in (
        ('断面 prof_rows', r'const K8_ROWS=\(function\(\)'),
        ('前面の平面形 nose_x', r'function k8nose\(z,s,hw\)'),
        ('開口の一覧 side_windows', r'function k8SideWindows\(cab\)'),
        ('塗り分けはシェーダ', r'const K8_FRAG_MAIN='),
    ):
        found = re.search(pat, src) is not None
        row(label, 'あり', 'あり' if found else 'なし', found)

    # ---- 色管理:著作値(sRGB)→リニア→トーンマッピング→sRGB出力 の経路 ----
    # 変換を通し忘れた色はその面だけ不自然に明るくなる。ソースで漏れを探す。
    for label, pat in (
        ('sRGBで出力する', r'renderer\.outputEncoding\s*=\s*THREE\.sRGBEncoding'),
        ('トーンマッピング', r'renderer\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping'),
        ('露出を指定', r'renderer\.toneMappingExposure\s*=\s*TONE_EXPO'),
        ('sRGB→リニアの式', r'v<=0\.04045\)\?v/12\.92:Math\.pow\(\(v\+0\.055\)/1\.055,2\.4\)'),
    ):
        found = re.search(pat, src) is not None
        ng += 0 if found else 1
        print('%-18s %14s %14s %8s  %s' % (label, 'あり', 'あり' if found else 'なし', '-',
                                           'OK' if found else 'NG'))

    # 材質を工場(mkMat)経由にせず、16進の色を直接書いている箇所が無いこと
    direct = re.findall(
        r'new THREE\.(?:Mesh\w*Material|LineBasicMaterial|SpriteMaterial|PointsMaterial)\('
        r'[^)]*?(?:color|emissive)\s*:\s*0x', src)
    ng += 0 if not direct else 1
    print('%-18s %14s %14s %8s  %s' % ('色の素通しが無い', '0箇所',
                                       '%d箇所' % len(direct), '-',
                                       'OK' if not direct else 'NG'))
    # 色を持つテクスチャは canvasTex を通す(encoding の指定漏れを防ぐ)
    ctex = len(re.findall(r'new THREE\.CanvasTexture\(', src))
    ok = (ctex == 1) and ('t.encoding=THREE.sRGBEncoding' in src)
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('テクスチャの色空間', 'canvasTexに集約',
                                       'canvasTexに集約' if ok else '%d箇所が直接生成' % ctex,
                                       '-', 'OK' if ok else 'NG'))
    # 頂点カラー・インスタンスカラーもリニアへ変換していること(車両は k8lin を通す)
    ok = ('const k8lin=(r,g,b)=>[s2l(r),s2l(g),s2l(b)]' in src and 'setHex(' not in src)
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('頂点/インスタンス色', 'リニアへ変換',
                                       'リニアへ変換' if ok else '未変換あり', '-',
                                       'OK' if ok else 'NG'))

    # 曲線追従の直方体(cbox)に上面と下面の両方があること。
    # 下面が無いと、駅の上屋を下から見たときに何も無いように見える(運転モードで発覚)。
    cb = re.search(r'function cbox\(([\s\S]*?)\n\}', src)
    ok = bool(cb) and cb.group(1).count('strip(') == 4
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('cboxの面の数', '4面(上下+側面2)',
                                       '%d面' % (cb.group(1).count('strip(') if cb else 0),
                                       '-', 'OK' if ok else 'NG'))

    # 客用扉:戸は外板の内側を戸袋へ滑る。シェーダで「隙間=穴」「戸袋窓の奥=戸」を描く。
    # 戸と一緒に扉窓のガラスも動く(頂点シェーダ)。
    ok = ('inGap' in src) and ('behindLeaf' in src) and ('function k8DoorGlassMat' in src)
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('客用扉の開閉', '隙間=穴/戸袋の戸',
                                       '隙間=穴/戸袋の戸' if ok else '未対応', '-',
                                       'OK' if ok else 'NG'))
    # ガラスは乗算(v4 の透過の色を掛ける)。加算や半透明だと白い背景が白いまま透ける
    ok = re.search(r'glass:mkMat\([\s\S]{0,200}?blending:THREE\.MultiplyBlending', src) is not None
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('窓ガラス', '乗算で色を掛ける',
                                       '乗算' if ok else '別の合成', '-', 'OK' if ok else 'NG'))
    # 開く面(ホーム側)は姿勢から計算すること(符号を決め打つと左右が逆になる)
    ok = 'localZSign(' in src
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('開く面の判定', '姿勢から計算',
                                       '姿勢から計算' if ok else '決め打ち', '-',
                                       'OK' if ok else 'NG'))

    # 表示器の文字の枠(利用者指示:v4 の 幅0.86・高さ0.70 から15%大きく)。基準は v4 の値を検証側で持つ
    m = re.search(r'const K8_LED_TXT=\[0\.86\*([\d.]+),0\.70\*([\d.]+)\]', src)
    ok = m is not None and abs(float(m.group(1)) - 1.15) < 1e-9 and abs(float(m.group(2)) - 1.15) < 1e-9
    side = len(re.findall(r'w\*0\.(?:22|62)\*1\.15,h\*0\.(?:70|62)\*1\.15', src)) == 2
    ok = ok and side
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('表示器の文字', 'v4×1.15(前面・側面)',
                                       ('×%s/×%s' % (m.group(1), m.group(2)) if m else '無い') + ('' if side else ' 側面×'),
                                       '-', 'OK' if ok else 'NG'))

    # 8000系の前面の文字はさらに1.10倍、種別の2文字は間を空ける、スカートの切り欠きは v4 の1.2倍(利用者指示)
    m2 = re.search(r'const K8_FRONT_TXT=([\d.]+);', src)
    # 切り欠きの幅は 9000系と共通の SKIRT_OPEN(2026-10-11 利用者指示:9000系の脇から10cm ずつ狭く、下端は0.92倍)。深さは v4 の1.2倍
    m3 = re.search(r'const K8_SKIRT_NOTCH=\[SKIRT_OPEN\[0\](),0\.60\*([\d.]+)\]', src)
    m4 = re.search(r'const SKIRT_OPEN=\[0\.55\*1\.225-0\.10,0\.92\];', src)
    sp = "k[0]+'  '+k[1]" in src
    ok = (m2 is not None and abs(float(m2.group(1)) - 1.10) < 1e-9 and m3 is not None
          and m4 is not None and abs(float(m3.group(2)) - 1.2) < 1e-9 and sp)
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('前面の文字・切り欠き', '×1.10・×1.2・字間',
                                       ('×%s' % m2.group(1) if m2 else '無い') + ('/×%s' % m3.group(2) if m3 else '/無い') + ('・開口' if m4 else '・開口なし') + ('・字間' if sp else '・字間なし'),
                                       '-', 'OK' if ok else 'NG'))

    # 行先「新宿」は形式によらず「新  宿」(利用者指示)。表記の関数と、前面(8000系・9000系)・側面の3か所で通すこと
    fd = "d==='新宿'?'新  宿':d" in src
    uses = len(re.findall(r'k8DestTxt\((?:o\.sign\.)?dest\)', src))
    ok = fd and uses == 3
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('行先「新  宿」', '表記・3か所', ('表記' if fd else '表記なし') + '・%dか所' % uses,
                                       '-', 'OK' if ok else 'NG'))

    # クレジット:画面に PLATEAU・線路の位置の出典を出し、CREDITS.txt に PLATEAU・three.js・地理院のベクトルタイルの表記があること
    import os
    cp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'CREDITS.txt')   # リポジトリの直下
    cr = open(cp, encoding='utf-8').read() if os.path.exists(cp) else ''
    # 2026-10-27:井の頭線・世田谷線の線路の位置(地理院のベクトルタイルを加工した数値)の出典も画面と CREDITS.txt に
    onscreen = "(CC BY 4.0)を加工" in src and '建物・道路・土地利用' in src and '地理院タイル(ベクトルタイル)を加工' in src
    ok = onscreen and all(k in cr for k in ('Project PLATEAU', 'CC BY 4.0', 'three.js', 'MIT', 'ベクトルタイル'))
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('クレジット', '画面+CREDITS', ('画面' if onscreen else '画面なし') + ('・CREDITS' if cr else '・CREDITSなし'),
                                       '-', 'OK' if ok else 'NG'))

    # 旧「写真転写方式」の残骸が無いこと
    dead = [s for s in ('FTEX', 'FRONT_TEX', 'FACEMAT', 'buildCarGeo', 'carColor') if s in src]
    ok = not dead
    ng += 0 if ok else 1
    print('%-18s %14s %14s %8s  %s' % ('旧写真転写方式の残存', 'なし',
                                       'なし' if ok else ','.join(dead), '-', 'OK' if ok else 'NG'))

    print('\nRESULT:', 'PASS' if ng == 0 else 'FAIL(%d項目NG)' % ng)
    sys.exit(1 if ng else 0)


if __name__ == '__main__':
    main()
