const { Rug } = require('../src/physics.js');
const rug = new Rug({ nx: 30, ny: 43, sp: 14, cx: 700, cy: 400, z: 0, bounds: { x0: 0, y0: 0, x1: 1536, y1: 816 } });
rug.obstacles.push({ x: 700, y: 450, r: 30, h: 13 });
const dt = 1/60;
const stretch = () => { let m = 0; for (let e = 0; e < rug.cA.length; e++) { if (rug.cComp[e] !== 0) continue; const a=3*rug.cA[e], b=3*rug.cB[e]; const d=Math.hypot(rug.pos[b]-rug.pos[a],rug.pos[b+1]-rug.pos[a+1],rug.pos[b+2]-rug.pos[a+2]); m=Math.max(m, Math.abs(d/rug.cRest[e]-1)); } return m*100; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let worst = 0, t0 = Date.now(), frames = 0;
for (let round = 0; round < 12; round++) {
  // rastgele bir parçacık tut, sert hareket ettir
  const r0 = 1 + Math.floor(rnd() * 43), c0 = Math.floor(rnd() * 30);
  const ids = [], off = [];
  for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) if (r >= 1 && r <= 43 && c >= 0 && c < 30) ids.push(r * 30 + c);
  const i0 = 3 * (r0 * 30 + c0); const sx = rug.pos[i0], sy = rug.pos[i0 + 1], sz = rug.pos[i0 + 2];
  ids.forEach(i => off.push([rug.pos[3*i] - sx, rug.pos[3*i+1] - sy]));
  const g = { ids: Int32Array.from(ids), tx: new Float32Array(ids.length), ty: new Float32Array(ids.length), tz: new Float32Array(ids.length) };
  rug.grab = g;
  const ex = 200 + rnd() * 1100, ey = 100 + rnd() * 600, lift = rnd() < 0.5 ? 10 + rnd()*150 : 5;
  for (let f = 0; f < 50; f++) {
    const u = Math.min(1, f / 15); // hızlı: 15 karede
    ids.forEach((i, k) => { g.tx[k] = sx + (ex - sx) * u + off[k][0]; g.ty[k] = sy + (ey - sy) * u + off[k][1]; g.tz[k] = sz + (f < 40 ? lift : 0); });
    rug.step(dt); frames++;
    worst = Math.max(worst, stretch());
  }
  rug.grab = null;
  if (rnd() < 0.3) { for (let f = 0; f < 20; f++) { rug.dragDX = 15; rug.dragDY = -8; rug.step(dt); frames++; } }
  let mm; for (let f = 0; f < 90; f++) { mm = rug.step(dt); frames++; }
  const nan = rug.pos.some(v => !Number.isFinite(v));
  let maxZ = 0; for (let i = 0; i < rug.N; i++) maxZ = Math.max(maxZ, rug.pos[3*i+2]);
  console.log(`round ${round} lift ${lift.toFixed(0)} settledMove ${mm.toFixed(3)} stretchNow ${stretch().toFixed(1)}% maxZ ${maxZ.toFixed(1)} nan ${nan}`);
}
console.log('worst stretch during drag %', worst.toFixed(1), 'avg ms/frame', ((Date.now() - t0) / frames).toFixed(2));
