const { Rug } = require('../src/physics.js');
const rug = new Rug({ nx: 35, ny: 50, sp: 12, cx: 700, cy: 400, z: 0, bounds: { x0: 0, y0: 0, x1: 1536, y1: 816 } });
const dt = 1 / 60;
const bad = () => rug.pos.some((v) => !Number.isFinite(v));
let t0 = Date.now();
for (let f = 0; f < 60; f++) rug.step(dt);
console.log('settle ms/frame', (Date.now() - t0) / 60, 'maxZ', Math.max(...rug.pos.filter((_, i) => i % 3 === 2)).toFixed(2));
// sol üst köşeyi 3x3 tut
const ids = [], off = [];
for (let r = 1; r <= 2; r++) for (let c = 0; c <= 1; c++) ids.push(r * rug.nx + c);
const c0 = 3 * ids[0];
const sx = rug.pos[c0], sy = rug.pos[c0 + 1];
const g = { ids: Int32Array.from(ids), tx: new Float32Array(ids.length), ty: new Float32Array(ids.length), tz: new Float32Array(ids.length) };
ids.forEach((i, k) => off.push([rug.pos[3 * i] - sx, rug.pos[3 * i + 1] - sy]));
rug.grab = g;
// hedef: halının ortasına doğru (çapraz katlama)
const ex = 700, ey = 400;
t0 = Date.now();
const F = 120;
for (let f = 0; f < F; f++) {
  const u = Math.min(1, f / 90);
  const mx = sx + (ex - sx) * u, my = sy + (ey - sy) * u;
  const lift = Math.min(60, f * 2) * (u < 1 ? 1 : 1 - (f - 90) / 30);
  ids.forEach((i, k) => { g.tx[k] = mx + off[k][0]; g.ty[k] = my + off[k][1]; g.tz[k] = 12 + lift; });
  rug.step(dt);
  if (f%15==0) console.log('f',f,'target',mx.toFixed(0),my.toFixed(0),(12+lift).toFixed(0),'corner',rug.pos[c0].toFixed(1),rug.pos[c0+1].toFixed(1),rug.pos[c0+2].toFixed(1));
}
console.log('drag ms/frame', ((Date.now() - t0) / F).toFixed(2), 'nan', bad());
rug.grab = null;
t0 = Date.now();
let mm;
for (let f = 0; f < 240; f++) mm = rug.step(dt);
console.log('after release ms/frame', ((Date.now() - t0) / 240).toFixed(2), 'lastMove', mm.toFixed(3), 'nan', bad());
const zc = rug.pos[3 * ids[0] + 2];
console.log('corner pos', rug.pos[3*ids[0]].toFixed(1), rug.pos[3*ids[0]+1].toFixed(1), 'z', zc.toFixed(2));
// alttaki kat: köşe xy'sine en yakın, alt kattaki (z<3) parçacık
let zs = [];
for (let i = 0; i < rug.N; i++) if (rug.pos[3*i+2] > rug.T*0.6 && !rug.isFringe[i]) zs.push(i);
console.log('particles on upper layer', zs.length, 'of', rug.N);
// kat yerinde mi? 2 sn daha
for (let f = 0; f < 120; f++) mm = rug.step(dt);
console.log('2s later corner', rug.pos[3*ids[0]].toFixed(1), rug.pos[3*ids[0]+1].toFixed(1), 'z', rug.pos[3*ids[0]+2].toFixed(2), 'move', mm.toFixed(3));
// gerilme kontrolü
let maxStr = 0; for (let e = 0; e < rug.cA.length; e++) { if (rug.cComp[e] !== 0) continue; const a=3*rug.cA[e], b=3*rug.cB[e]; const d=Math.hypot(rug.pos[b]-rug.pos[a],rug.pos[b+1]-rug.pos[a+1],rug.pos[b+2]-rug.pos[a+2]); maxStr=Math.max(maxStr, Math.abs(d/rug.cRest[e]-1)); }
console.log('max stretch %', (maxStr*100).toFixed(2));
