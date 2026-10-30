// 交差鉄道(井の頭線・世田谷線)の線形の検証側の実装(⑦⑪が使う)。モデルの xLineOf は使わない。
//   X=stub_three の返す物(LAT0・LON0・MLAT・MLON・prjXY を使う)、rl=RAW.rail.ino など(tr=2本の線路の中心の緯度・経度、南→北)
/* 交差鉄道の線形(検証側の実装):RAW.rail.*.tr(2本の線路の中心の緯度・経度、南→北)から、検証側の換算で世界座標の折れ線にし、
   2本の中ほどを中心線とする。u=中心線に沿う距離(北へ増える。井の頭線は京王線の中心線と交わる所・世田谷線は北の端が 0)。
   端の先は端の線分の向きに 200m 延ばす(モデルの説明どおり)。uv=最も近い線分への射影・dTrack=線路 k の折れ線までの距離 */
module.exports = function xCurve(X, rl, origin) {
  const W = (la, lo) => ({ x: (lo - X.LON0) * X.MLON, z: -(la - X.LAT0) * X.MLAT });
  const T = rl.tr.map((t) => { const q = []; for (let i = 0; i < t.length; i += 2) q.push(W(t[i], t[i + 1])); return q; });
  const n = T[0].length, P = T[0].map((a, i) => ({ x: (a.x + T[1][i].x) / 2, z: (a.z + T[1][i].z) / 2 })), U = [0];
  for (let i = 1; i < n; i++) U.push(U[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
  let o = U[n - 1];
  if (origin === 'cross') for (let i = 0; i < n - 1; i++) { const a = X.prjXY(P[i].x, P[i].z).off, b = X.prjXY(P[i + 1].x, P[i + 1].z).off;
    if ((a <= 0) !== (b <= 0)) { o = U[i] + (U[i + 1] - U[i]) * a / (a - b); break; } }
  for (let i = 0; i < n; i++) U[i] -= o;
  const dir = (a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z); return [(b.x - a.x) / l, (b.z - a.z) / l]; };
  const d0 = dir(P[0], P[1]), d1 = dir(P[n - 2], P[n - 1]);
  const S = [[P[0].x - d0[0] * 200, P[0].z - d0[1] * 200, P[0].x, P[0].z, U[0] - 200, U[0]]];
  for (let i = 0; i < n - 1; i++) S.push([P[i].x, P[i].z, P[i + 1].x, P[i + 1].z, U[i], U[i + 1]]);
  S.push([P[n - 1].x, P[n - 1].z, P[n - 1].x + d1[0] * 200, P[n - 1].z + d1[1] * 200, U[n - 1], U[n - 1] + 200]);
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const q of S) { bx0 = Math.min(bx0, q[0], q[2]); bx1 = Math.max(bx1, q[0], q[2]); bz0 = Math.min(bz0, q[1], q[3]); bz1 = Math.max(bz1, q[1], q[3]); }
  function uv(x, z) {
    if (x < bx0 - 70 || x > bx1 + 70 || z < bz0 - 70 || z > bz1 + 70) return { u: 0, n: 1e9 };
    let best = 1e18, u = 0, nn = 1e9;
    for (const q of S) { const dx = q[2] - q[0], dz = q[3] - q[1], l2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - q[0]) * dx + (z - q[1]) * dz) / l2)),
      px = q[0] + dx * t, pz = q[1] + dz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) { best = d2; u = q[4] + (q[5] - q[4]) * t; nn = ((x - px) * (-dz) + (z - pz) * dx) / Math.sqrt(l2); } }
    return best > 65 * 65 ? { u: 0, n: 1e9 } : { u: u, n: nn };
  }
  function dTrack(k, x, z) {
    let best = 1e18; const Q = T[k];
    for (let i = 0; i < Q.length - 1; i++) { const a = Q[i], b = Q[i + 1], dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2); }
    return Math.sqrt(best);
  }
  const uAtZ = (z) => { for (let i = 0; i < n - 1; i++) if ((P[i].z - z) * (P[i + 1].z - z) <= 0) return U[i] + (U[i + 1] - U[i]) * (P[i].z - z) / (P[i].z - P[i + 1].z); return NaN; };
  // 中心線の上の u の点(端の先は端の線分の向きに延ばす)と、線路 k の u での横の位置(中心線の点に最も近い線路の点の n)
  function pos(u) { let i = 0; while (i < n - 2 && U[i + 1] < u) i++; const t = (u - U[i]) / (U[i + 1] - U[i]);
    const dx = P[i + 1].x - P[i].x, dz = P[i + 1].z - P[i].z, l = Math.hypot(dx, dz);
    return { x: P[i].x + dx * t, z: P[i].z + dz * t, nx: -dz / l, nz: dx / l }; }   // n=uv の n の向き(北へ向かって右=東が+)
  function trackV(k, u) { const c = pos(u), Q = T[k]; let best = 1e18, bx = 0, bz = 0;
    for (let i = 0; i < Q.length - 1; i++) { const a = Q[i], b = Q[i + 1], dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / (dx * dx + dz * dz))),
      px = a.x + dx * t, pz = a.z + dz * t, d = (px - c.x) ** 2 + (pz - c.z) ** 2; if (d < best) { best = d; bx = px; bz = pz; } }
    return uv(bx, bz).n; }
  return { T: T, P: P, U: U, U0: U[0], U1: U[n - 1], uv: uv, dTrack: dTrack, uAtZ: uAtZ, W: W, pos: pos, trackV: trackV };
};
