const { Rug } = require('../src/physics.js');
const rug = new Rug({ nx: 30, ny: 43, sp: 14, cx: 700, cy: 400, z: 0, bounds: { x0: 0, y0: 0, x1: 1536, y1: 816 } });
const stretch = () => { let m = 0; for (let e = 0; e < rug.cA.length; e++) { if (rug.cComp[e] !== 0) continue; const a=3*rug.cA[e], b=3*rug.cB[e]; const d=Math.hypot(rug.pos[b]-rug.pos[a],rug.pos[b+1]-rug.pos[a+1],rug.pos[b+2]-rug.pos[a+2]); m=Math.max(m, Math.abs(d/rug.cRest[e]-1)); } return m*100; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const r0 = 1 + Math.floor(rnd() * 43), c0 = Math.floor(rnd() * 30);
const ids = [], off = [];
for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) if (r >= 1 && r <= 43 && c >= 0 && c < 30) ids.push(r * 30 + c);
const i0 = 3 * (r0 * 30 + c0); const sx = rug.pos[i0], sy = rug.pos[i0 + 1], sz = rug.pos[i0 + 2];
ids.forEach(i => off.push([rug.pos[3*i] - sx, rug.pos[3*i+1] - sy]));
const g = { ids: Int32Array.from(ids), tx: new Float32Array(ids.length), ty: new Float32Array(ids.length), tz: new Float32Array(ids.length) };
rug.grab = g;
const ex = 200 + rnd() * 1100, ey = 100 + rnd() * 600, lift = 5;
console.log('grab', r0, c0, 'from', sx.toFixed(0), sy.toFixed(0), 'to', ex.toFixed(0), ey.toFixed(0));
for (let f = 0; f < 140; f++) {
  const u = Math.min(1, f / 15);
  if (f === 50) rug.grab = null;
  ids.forEach((i, k) => { g.tx[k] = sx + (ex - sx) * u + off[k][0]; g.ty[k] = sy + (ey - sy) * u + off[k][1]; g.tz[k] = sz + lift; });
  const mm = rug.step(1/60);
  let mz = 0, xmin=1e9, xmax=-1e9; for (let i=0;i<rug.N;i++){ mz=Math.max(mz,rug.pos[3*i+2]); xmin=Math.min(xmin,rug.pos[3*i]); xmax=Math.max(xmax,rug.pos[3*i]); }
  if (f % 5 === 0) console.log(f, 'move', mm.toFixed(1), 'str', stretch().toFixed(1), 'maxZ', mz.toFixed(0), 'pairs', rug.npairs, 'x', xmin.toFixed(0), xmax.toFixed(0));
}
for (let f = 0; f < 300; f++) rug.step(1/60);
{ let m=0, mi=0; for (let i=0;i<rug.N;i++){ const k=3*i; const v=Math.hypot(rug.pos[k]-rug.prev[k],rug.pos[k+1]-rug.prev[k+1],rug.pos[k+2]-rug.prev[k+2]); if(v>m){m=v;mi=i;} }
  const inPair = []; for (let e=0;e<rug.npairs;e++) if (rug.pairA[e]===mi||rug.pairB[e]===mi) inPair.push(rug.pairA[e]===mi?rug.pairB[e]:rug.pairA[e]);
  console.log('after 5s more: maxv/substep', m.toFixed(3), 'particle r', rug.row[mi], 'c', rug.col[mi], 'fringe', rug.isFringe[mi], 'pos', Array.from(rug.pos.slice(3*mi,3*mi+3)).map(v=>v.toFixed(1)).join(','), 'pairs', rug.npairs, 'partners', inPair.length);
  let cnt=0; for (let i=0;i<rug.N;i++){ const k=3*i; if (Math.hypot(rug.pos[k]-rug.prev[k],rug.pos[k+1]-rug.prev[k+1],rug.pos[k+2]-rug.prev[k+2])>0.05) cnt++; } console.log('particles moving >0.05/substep', cnt);
}
