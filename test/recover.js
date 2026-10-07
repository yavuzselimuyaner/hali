// Gerçek kullanımda düğümlenmiş halı durumundan toparlanma testi
const { Rug } = require('../src/physics.js');
const s = require('./buzusmus.json').rug;
const rug = new Rug({ nx: s.nx, ny: s.ny, sp: s.sp, fringeLen: 16, cx: 0, cy: 0, bounds: { x0: 0, y0: 0, x1: 1920, y1: 1032 } });
console.log('restore', rug.restore(s));
const strain = () => { let m = 0; for (const e of rug.stretchIdx) { const a = 3 * rug.cA[e], b = 3 * rug.cB[e]; const d = Math.hypot(rug.pos[b] - rug.pos[a], rug.pos[b + 1] - rug.pos[a + 1], rug.pos[b + 2] - rug.pos[a + 2]); m = Math.max(m, Math.abs(d / rug.cRest[e] - 1)); } return m; };
const t0 = Date.now();
for (let f = 0; f <= 600; f++) {
  rug.step(1 / 60);
  if (f % 100 === 0) console.log(f, 'strain', strain().toFixed(3), 'mean', rug.meanMove.toFixed(3), 'pairs', rug.npairs);
}
console.log('ms/frame', ((Date.now() - t0) / 600).toFixed(1));
// en çok titreyen parçacıklar nerede?
const v = []; for (let i = 0; i < rug.N; i++) { const k = 3 * i; v.push([Math.hypot(rug.pos[k] - rug.prev[k], rug.pos[k + 1] - rug.prev[k + 1], rug.pos[k + 2] - rug.prev[k + 2]), i]); }
v.sort((a, b) => b[0] - a[0]);
for (const [sp, i] of v.slice(0, 8)) {
  let np = 0; for (let e = 0; e < rug.npairs; e++) if (rug.pairA[e] === i || rug.pairB[e] === i) np++;
  console.log('v', sp.toFixed(3), 'r', rug.row[i], 'c', rug.col[i], 'z', rug.pos[3 * i + 2].toFixed(1), 'pairs', np, 'nz', rug.nrm[3 * i + 2].toFixed(2));
}
let hist = [0, 0, 0, 0]; for (const [sp] of v) hist[sp < 0.01 ? 0 : sp < 0.05 ? 1 : sp < 0.2 ? 2 : 3]++;
console.log('hız dağılımı <.01 <.05 <.2 >=.2 :', hist.join(' '));
