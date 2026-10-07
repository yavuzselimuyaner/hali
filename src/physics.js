// Halı fiziği: XPBD (küçük alt adımlı) kumaş simülasyonu.
// Dünya koordinatları: x sağa, y aşağı (ekran pikseli), z zeminden yukarı (izleyiciye doğru).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RugPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 1800; // px/s²

  class Rug {
    constructor(o) {
      const nx = (this.nx = o.nx);
      const ny = (this.ny = o.ny);
      this.sp = o.sp;
      this.fringeLen = o.fringeLen || 14;
      const nr = (this.nr = ny + 2); // ilk ve son satır saçak
      const N = (this.N = nx * nr);

      this.pos = new Float32Array(N * 3);
      this.prev = new Float32Array(N * 3);
      this.w = new Float32Array(N).fill(1);
      this.isFringe = new Uint8Array(N);
      this.row = new Int16Array(N);
      this.col = new Int16Array(N);
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nx; c++) {
          const i = r * nx + c;
          this.row[i] = r;
          this.col[i] = c;
          this.isFringe[i] = r === 0 || r === nr - 1 ? 1 : 0;
        }
      }

      this.substeps = o.substeps || 15;
      this.R = this.sp * 1.2; // kendi kendine çarpışma yarıçapı (yatay)
      this.T = o.thickness || 7; // katlar arası kalınlık (dikey)
      this.mu = 0.9; // zemin sürtünmesi
      this.muSelf = 0.8; // halı-halı sürtünmesi
      this.damp = 0.998;
      this.maxHandSpeed = 1400; // tutulan noktanın en yüksek hızı (px/s)
      this.contactDamp = 0.85; // katlar temas ederken alt adım başına hız çarpanı
      this.colStiff = 0.5; // çarpışma düzeltmesinin bir alt adımda uygulanan oranı
      this.colMaxCorr = 1.5; // kendi-kendine çarpışmada alt adım başına en fazla itme (px)
      this.vSep = 0.15; // temas sonrası en fazla ayrılma hızı (px/alt adım)
      this.bendCompliance = o.bendCompliance != null ? o.bendCompliance : 3e-6;
      this.grabCompliance = 2e-5;
      this.obstacles = []; // halının altındaki eşyalar: {x, y, r, h}
      this.grab = null; // {ids, tx, ty, tz}
      this.dragDX = 0;
      this.dragDY = 0;
      this.bounds = o.bounds || null; // {x0, y0, x1, y1}

      this.layoutFlat(o.cx, o.cy, o.z || 0, o.angle || 0);
      this.buildConstraints();

      let hs = 1;
      while (hs < N * 2) hs <<= 1;
      this.hashMask = hs - 1;
      this.cellStart = new Int32Array(hs + 1);
      this.cellEntries = new Int32Array(N);
      this.cellOf = new Int32Array(N);
      this.active = new Int32Array(N);
      this.nrm = new Float32Array(N * 3);
      this.contact = new Uint8Array(N);
      // çift → taraf hafızası: iki tablolu açık adresleme (biri önceki tur, biri bu tur)
      this.htBits = 17;
      this.htKeys = [new Int32Array(1 << this.htBits).fill(-1), new Int32Array(1 << this.htBits).fill(-1)];
      this.htVals = [new Int8Array(1 << this.htBits), new Int8Array(1 << this.htBits)];
      this.htCur = 0;
      this.pairA = new Int32Array(4096);
      this.pairB = new Int32Array(4096);
      this.pairS = new Int8Array(4096);
      this.pairSlot = new Int32Array(4096);
      this.npairs = 0;
    }

    localXY(r, c) {
      const wd = (this.nx - 1) * this.sp;
      const hd = (this.ny - 1) * this.sp;
      const x = c * this.sp - wd / 2;
      let y;
      if (r === 0) y = -hd / 2 - this.fringeLen;
      else if (r === this.nr - 1) y = hd / 2 + this.fringeLen;
      else y = (r - 1) * this.sp - hd / 2;
      return [x, y];
    }

    layoutFlat(cx, cy, z, angle) {
      const cs = Math.cos(angle);
      const sn = Math.sin(angle);
      for (let r = 0; r < this.nr; r++) {
        for (let c = 0; c < this.nx; c++) {
          const [lx, ly] = this.localXY(r, c);
          const k = 3 * (r * this.nx + c);
          this.pos[k] = this.prev[k] = cx + lx * cs - ly * sn;
          this.pos[k + 1] = this.prev[k + 1] = cy + lx * sn + ly * cs;
          this.pos[k + 2] = this.prev[k + 2] = z;
        }
      }
    }

    buildConstraints() {
      const nx = this.nx;
      const nr = this.nr;
      const A = [];
      const B = [];
      const K = [];
      const add = (a, b, k) => {
        A.push(a);
        B.push(b);
        K.push(k);
      };
      const id = (r, c) => r * nx + c;
      const rug = (r) => r >= 1 && r <= this.ny;
      const STRETCH = 0;
      const SHEAR = 1e-7;
      const FRINGE_SIDE = 2e-4;
      const BEND = this.bendCompliance;
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nx; c++) {
          if (c + 1 < nx) add(id(r, c), id(r, c + 1), rug(r) ? STRETCH : FRINGE_SIDE);
          if (r + 1 < nr) add(id(r, c), id(r + 1, c), STRETCH);
          if (rug(r) && rug(r + 1) && c + 1 < nx) {
            add(id(r, c), id(r + 1, c + 1), SHEAR);
            add(id(r, c + 1), id(r + 1, c), SHEAR);
          }
          if (rug(r) && c + 2 < nx) add(id(r, c), id(r, c + 2), BEND);
          if (rug(r) && r + 2 < nr && rug(r + 2)) add(id(r, c), id(r + 2, c), BEND);
        }
      }
      this.cA = Int32Array.from(A);
      this.cB = Int32Array.from(B);
      this.cComp = Float32Array.from(K);
      this.cRest = new Float32Array(A.length);
      // sadece esnemez (yapısal) kısıtlar: çarpışmadan sonra tekrar çözülür
      this.stretchIdx = Int32Array.from(K.map((k, e) => (k === 0 ? e : -1)).filter((e) => e >= 0));
      // Dinlenme boyları düz yerleşimden (açıdan bağımsız)
      for (let e = 0; e < A.length; e++) {
        const [ax, ay] = this.localXY(this.row[A[e]], this.col[A[e]]);
        const [bx, by] = this.localXY(this.row[B[e]], this.col[B[e]]);
        this.cRest[e] = Math.hypot(bx - ax, by - ay);
      }
    }

    floorH(x, y) {
      let hg = 0;
      const obs = this.obstacles;
      for (let k = 0; k < obs.length; k++) {
        const o = obs[k];
        const dx = x - o.x;
        const dy = y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < o.r * o.r) {
          const t = Math.sqrt(d2) / o.r;
          const v = o.h * 0.5 * (1 + Math.cos(Math.PI * t));
          if (v > hg) hg = v;
        }
      }
      return hg;
    }

    step(dt) {
      const n = this.substeps;
      const h = dt / n;
      const ih2 = 1 / (h * h);
      const N = this.N;
      const p = this.pos;
      const q = this.prev;
      const gdt2 = G * h * h;
      const maxD = this.R * 0.2;
      const damp = this.damp;
      const cdamp = this.contactDamp;
      const contact = this.contact;
      const ddx = this.dragDX / n;
      const ddy = this.dragDY / n;
      this.dragDX = this.dragDY = 0;
      let maxMove = 0;
      let sumMove = 0;

      for (let s = 0; s < n; s++) {
        for (let i = 0; i < N; i++) {
          const k = 3 * i;
          // halı üst üste yığıldığı yerde (katlar temas ediyor) hareket hızla söner
          const dmp = contact[i] ? cdamp : damp;
          contact[i] = 0;
          let vx = (p[k] - q[k]) * dmp;
          let vy = (p[k + 1] - q[k + 1]) * dmp;
          let vz = (p[k + 2] - q[k + 2]) * dmp;
          const v2 = vx * vx + vy * vy + vz * vz;
          if (v2 > maxD * maxD) {
            const f = maxD / Math.sqrt(v2);
            vx *= f;
            vy *= f;
            vz *= f;
          }
          if (s === n - 1) {
            if (v2 > maxMove) maxMove = v2;
            sumMove += Math.sqrt(v2);
          }
          // Ctrl ile sürükleme: önceki konum da kaydırılır, böylece hız eklenmez
          q[k] = p[k] + ddx;
          q[k + 1] = p[k + 1] + ddy;
          q[k + 2] = p[k + 2];
          p[k] += vx + ddx;
          p[k + 1] += vy + ddy;
          p[k + 2] += vz - gdt2;
        }
        this.solveDistances(ih2);
        if (this.grab) this.solveGrab(ih2, h);
        this.selfCollide(s);
        // Çarpışma itmeleri iplikleri gerebilir; gerilmeyi bir kez daha toparla
        if (this.npairs) this.solveDistances(ih2, this.stretchIdx);
        this.solveFloor(h);
      }
      this.meanMove = (sumMove / N) * n; // kare başına ortalama yer değiştirme (px)
      return Math.sqrt(maxMove) * n + Math.hypot(ddx, ddy) * n;
    }

    solveDistances(ih2, only) {
      const p = this.pos;
      const w = this.w;
      const A = this.cA;
      const B = this.cB;
      const L = this.cRest;
      const K = this.cComp;
      const M = only ? only.length : A.length;
      for (let t = 0; t < M; t++) {
        const e = only ? only[t] : t; // yön sabit kalmalı: her adımda yön değiştirmek sahte enerji pompalar
        const a = A[e];
        const b = B[e];
        const wa = w[a];
        const wb = w[b];
        const ws = wa + wb;
        if (ws === 0) continue;
        const ka = 3 * a;
        const kb = 3 * b;
        const dx = p[kb] - p[ka];
        const dy = p[kb + 1] - p[ka + 1];
        const dz = p[kb + 2] - p[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) continue;
        const s = (d - L[e]) / (ws + K[e] * ih2) / d;
        p[ka] += wa * s * dx;
        p[ka + 1] += wa * s * dy;
        p[ka + 2] += wa * s * dz;
        p[kb] -= wb * s * dx;
        p[kb + 1] -= wb * s * dy;
        p[kb + 2] -= wb * s * dz;
      }
    }

    solveGrab(ih2, h) {
      const g = this.grab;
      const p = this.pos;
      const w = this.w;
      const alpha = this.grabCompliance * ih2;
      const n = g.ids.length;
      if (!g.cx) {
        // tutulan nokta bulunduğu yerden başlar, hedefe sınırlı hızla gider
        g.cx = new Float32Array(n);
        g.cy = new Float32Array(n);
        g.cz = new Float32Array(n);
        for (let k = 0; k < n; k++) {
          const kk = 3 * g.ids[k];
          g.cx[k] = p[kk];
          g.cy[k] = p[kk + 1];
          g.cz[k] = p[kk + 2];
        }
      }
      const maxStep = this.maxHandSpeed * h;
      for (let k = 0; k < n; k++) {
        let dx = g.tx[k] - g.cx[k];
        let dy = g.ty[k] - g.cy[k];
        let dz = g.tz[k] - g.cz[k];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxStep) {
          const f = maxStep / d;
          dx *= f;
          dy *= f;
          dz *= f;
        }
        g.cx[k] += dx;
        g.cy[k] += dy;
        g.cz[k] += dz;
        const i = g.ids[k];
        const kk = 3 * i;
        const f = w[i] / (w[i] + alpha);
        p[kk] -= f * (p[kk] - g.cx[k]);
        p[kk + 1] -= f * (p[kk + 1] - g.cy[k]);
        p[kk + 2] -= f * (p[kk + 2] - g.cz[k]);
      }
    }

    hash(x, y, z) {
      return (Math.imul(x, 92837111) ^ Math.imul(y, 689287499) ^ Math.imul(z, 283923481)) & this.hashMask;
    }

    computeNormals() {
      const nx = this.nx;
      const ny = this.ny;
      const p = this.pos;
      const out = this.nrm;
      for (let r = 1; r <= ny; r++) {
        const ru = r > 1 ? r - 1 : r;
        const rd = r < ny ? r + 1 : r;
        for (let c = 0; c < nx; c++) {
          const cl = c > 0 ? c - 1 : c;
          const cr = c < nx - 1 ? c + 1 : c;
          const a = 3 * (r * nx + cl);
          const b = 3 * (r * nx + cr);
          const u = 3 * (ru * nx + c);
          const d = 3 * (rd * nx + c);
          const ax = p[b] - p[a];
          const ay = p[b + 1] - p[a + 1];
          const az = p[b + 2] - p[a + 2];
          const bx = p[d] - p[u];
          const by = p[d + 1] - p[u + 1];
          const bz = p[d + 2] - p[u + 2];
          const x = ay * bz - az * by;
          const y = az * bx - ax * bz;
          const z = ax * by - ay * bx;
          const l = Math.sqrt(x * x + y * y + z * z) || 1;
          const k = 3 * (r * nx + c);
          out[k] = x / l;
          out[k + 1] = y / l;
          out[k + 2] = z / l;
        }
      }
    }

    // Aday çiftleri topla. Her çift için "a, b'nin yüzeyinin hangi tarafında" bilgisi
    // ilk karşılaşmada kaydedilir ve çift uzaklaşana kadar korunur. Böylece katlar
    // yer değiştiremez, halı kendi içinden geçip düğümlenmez.
    buildPairs() {
      const N = this.N;
      const p = this.pos;
      const fr = this.isFringe;
      const lift = this.T * 0.45;
      const act = this.active;
      const row = this.row;
      const col = this.col;
      const Rd = this.R + this.R * 0.2 * 3; // etkileşim + 3 alt adımlık en yüksek hareket payı
      const Rd2 = Rd * Rd;
      const inv = 1 / Rd;
      const nrm = this.nrm;
      const bits = this.htBits;
      const mask = (1 << bits) - 1;
      const maxPairs = 1 << (bits - 1);
      const oldK = this.htKeys[this.htCur];
      const oldV = this.htVals[this.htCur];
      const nextK = this.htKeys[1 - this.htCur];
      const nextV = this.htVals[1 - this.htCur];
      let np = 0;

      let na = 0;
      for (let i = 0; i < N; i++) if (!fr[i] && p[3 * i + 2] > lift) act[na++] = i;
      if (na === 0 && this.npairs === 0) return; // halı düz: tablolar zaten boş
      nextK.fill(-1);
      if (na > 0) {
        const start = this.cellStart;
        const entries = this.cellEntries;
        const cellOf = this.cellOf;
        start.fill(0);
        for (let i = 0; i < N; i++) {
          if (fr[i]) {
            cellOf[i] = -1;
            continue;
          }
          const k = 3 * i;
          const hc = this.hash(Math.floor(p[k] * inv), Math.floor(p[k + 1] * inv), Math.floor(p[k + 2] * inv));
          cellOf[i] = hc;
          start[hc]++;
        }
        for (let k = 1; k < start.length; k++) start[k] += start[k - 1];
        for (let i = 0; i < N; i++) if (cellOf[i] >= 0) entries[--start[cellOf[i]]] = i;

        for (let t = 0; t < na; t++) {
          const i = act[t];
          const ki = 3 * i;
          const cx = Math.floor(p[ki] * inv);
          const cy = Math.floor(p[ki + 1] * inv);
          const cz = Math.floor(p[ki + 2] * inv);
          const ri = row[i];
          const ci = col[i];
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              for (let oz = -1; oz <= 1; oz++) {
                const hc = this.hash(cx + ox, cy + oy, cz + oz);
                const e1 = start[hc + 1];
                for (let e = start[hc]; e < e1; e++) {
                  const j = entries[e];
                  if (j === i) continue;
                  const kj = 3 * j;
                  if (j < i && p[kj + 2] > lift) continue; // ikisi de aktifse bir kez
                  const dr = ri - row[j];
                  const dc = ci - col[j];
                  if (dr <= 2 && dr >= -2 && dc <= 2 && dc >= -2) continue;
                  const dx = p[ki] - p[kj];
                  const dy = p[ki + 1] - p[kj + 1];
                  const dz = p[ki + 2] - p[kj + 2];
                  if (dx * dx + dy * dy + dz * dz >= Rd2) continue;
                  const a = i < j ? i : j;
                  const b = i < j ? j : i;
                  const key = a * N + b;
                  // bu turda zaten eklendi mi (hash çakışmasıyla ikinci kez gelebilir)
                  let slot = Math.imul(key, 0x9e3779b1) >>> (32 - bits);
                  while (nextK[slot] !== -1 && nextK[slot] !== key) slot = (slot + 1) & mask;
                  if (nextK[slot] === key) continue;
                  if (np >= maxPairs) continue;
                  // önceki turdan taraf bilgisi
                  let side = 0;
                  let os = Math.imul(key, 0x9e3779b1) >>> (32 - bits);
                  while (oldK[os] !== -1) {
                    if (oldK[os] === key) {
                      side = oldV[os];
                      break;
                    }
                    os = (os + 1) & mask;
                  }
                  if (side === 0) {
                    const ka = 3 * a;
                    const kb = 3 * b;
                    const dn =
                      (p[ka] - p[kb]) * nrm[kb] + (p[ka + 1] - p[kb + 1]) * nrm[kb + 1] + (p[ka + 2] - p[kb + 2]) * nrm[kb + 2];
                    side = dn >= 0 ? 1 : -1;
                  }
                  nextK[slot] = key;
                  nextV[slot] = side;
                  if (np >= this.pairA.length) this.growPairs();
                  this.pairA[np] = a;
                  this.pairB[np] = b;
                  this.pairS[np] = side;
                  this.pairSlot[np] = slot;
                  np++;
                }
              }
            }
          }
        }
      }
      this.htCur = 1 - this.htCur;
      this.npairs = np;
    }

    growPairs() {
      const n = this.pairA.length * 2;
      const a = new Int32Array(n);
      const b = new Int32Array(n);
      const s = new Int8Array(n);
      const t = new Int32Array(n);
      a.set(this.pairA);
      b.set(this.pairB);
      s.set(this.pairS);
      t.set(this.pairSlot);
      this.pairA = a;
      this.pairB = b;
      this.pairS = s;
      this.pairSlot = t;
    }

    selfCollide(s) {
      this.computeNormals();
      if (s % 3 === 0) this.buildPairs();
      const np = this.npairs;
      if (!np) return;
      const p = this.pos;
      const q = this.prev;
      const w = this.w;
      const nrm = this.nrm;
      const R = this.R;
      const R2 = R * R;
      const T = this.T;
      const mu = this.muSelf;
      const vSep = this.vSep;
      const A = this.pairA;
      const B = this.pairB;
      const S = this.pairS;
      for (let e = 0; e < np; e++) {
        const a = A[e];
        const b = B[e];
        const ka = 3 * a;
        const kb = 3 * b;
        const dx = p[ka] - p[kb];
        const dy = p[ka + 1] - p[kb + 1];
        const dz = p[ka + 2] - p[kb + 2];
        const side = S[e];
        // iki parçacığın (aynı yöne çevrilmiş) normallerinin ortalaması: kat çizgisinde
        // tek bir normal alt adımlar arasında hızla döner ve itme yönünü savurur
        let nx = nrm[kb];
        let ny = nrm[kb + 1];
        let nz = nrm[kb + 2];
        const al = nx * nrm[ka] + ny * nrm[ka + 1] + nz * nrm[ka + 2] >= 0 ? 1 : -1;
        nx += al * nrm[ka];
        ny += al * nrm[ka + 1];
        nz += al * nrm[ka + 2];
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-6) continue;
        nx *= side / nl;
        ny *= side / nl;
        nz *= side / nl;
        const dn = dx * nx + dy * ny + dz * nz;
        const tx = dx - dn * nx;
        const ty = dy - dn * ny;
        const tz = dz - dn * nz;
        const dt2 = tx * tx + ty * ty + tz * tz;
        if (dt2 >= R2) continue;
        if (dn < 0) {
          // Çift kayıtlı tarafın ötesine geçmiş (dolanma ya da gürültü). Geri itmeye
          // çalışmak katları birbirine düşürür ve enerji pompalar; belirgin bir geçişse
          // yeni düzeni kabul et.
          if (dn < -0.5 * T && dt2 < 0.5 * R2) {
            S[e] = -side;
            this.htVals[this.htCur][this.pairSlot[e]] = -side;
          }
          continue;
        }
        const req = T * Math.sqrt(1 - dt2 / R2);
        if (dn >= req) continue;
        const wa = w[a];
        const wb = w[b];
        const ws = wa + wb;
        if (ws === 0) continue;
        const corr = Math.min((req - dn) * this.colStiff, this.colMaxCorr) / ws;
        this.contact[a] = 1;
        this.contact[b] = 1;
        p[ka] += wa * corr * nx;
        p[ka + 1] += wa * corr * ny;
        p[ka + 2] += wa * corr * nz;
        p[kb] -= wb * corr * nx;
        p[kb + 1] -= wb * corr * ny;
        p[kb + 2] -= wb * corr * nz;
        const rx = p[ka] - q[ka] - (p[kb] - q[kb]);
        const ry = p[ka + 1] - q[ka + 1] - (p[kb + 1] - q[kb + 1]);
        const rz = p[ka + 2] - q[ka + 2] - (p[kb + 2] - q[kb + 2]);
        const rn = rx * nx + ry * ny + rz * nz;
        // esnek olmayan temas: itme düzeltmesi ayrılma hızına dönüşüp sektirmesin
        if (rn > vSep) {
          const ex = (rn - vSep) / ws;
          q[ka] += wa * ex * nx;
          q[ka + 1] += wa * ex * ny;
          q[ka + 2] += wa * ex * nz;
          q[kb] -= wb * ex * nx;
          q[kb + 1] -= wb * ex * ny;
          q[kb + 2] -= wb * ex * nz;
        }
        // katlar arası Coulomb sürtünmesi: kayma, itme miktarının mu katıyla sınırlı
        let fx = rx - rn * nx;
        let fy = ry - rn * ny;
        let fz = rz - rn * nz;
        const ft = Math.sqrt(fx * fx + fy * fy + fz * fz);
        const lim = mu * (req - dn);
        if (ft > lim) {
          const k = lim / ft;
          fx *= k;
          fy *= k;
          fz *= k;
        }
        p[ka] -= (wa / ws) * fx;
        p[ka + 1] -= (wa / ws) * fy;
        p[ka + 2] -= (wa / ws) * fz;
        p[kb] += (wb / ws) * fx;
        p[kb + 1] += (wb / ws) * fy;
        p[kb + 2] += (wb / ws) * fz;
      }
    }

    solveFloor(h) {
      const N = this.N;
      const p = this.pos;
      const q = this.prev;
      const dv = this.mu * G * h;
      const b = this.bounds;
      const hasObs = this.obstacles.length > 0;
      for (let i = 0; i < N; i++) {
        const k = 3 * i;
        const hg = hasObs ? this.floorH(p[k], p[k + 1]) : 0;
        if (p[k + 2] < hg) {
          p[k + 2] = hg;
          if (p[k + 2] - q[k + 2] > this.vSep) q[k + 2] = p[k + 2] - this.vSep;
          const dx = p[k] - q[k];
          const dy = p[k + 1] - q[k + 1];
          const v = Math.sqrt(dx * dx + dy * dy) / h;
          if (v <= dv) {
            p[k] = q[k];
            p[k + 1] = q[k + 1];
          } else {
            const f = dv / v;
            p[k] -= dx * f;
            p[k + 1] -= dy * f;
          }
        }
        if (b) {
          if (p[k] < b.x0) p[k] = b.x0;
          else if (p[k] > b.x1) p[k] = b.x1;
          if (p[k + 1] < b.y0) p[k + 1] = b.y0;
          else if (p[k + 1] > b.y1) p[k + 1] = b.y1;
        }
      }
    }

    // Halının yönü: orta satırın soldan sağa vektörü
    angle() {
      const r = (this.nr / 2) | 0;
      const a = 3 * (r * this.nx);
      const b = 3 * (r * this.nx + this.nx - 1);
      return Math.atan2(this.pos[b + 1] - this.pos[a + 1], this.pos[b] - this.pos[a]);
    }

    centroid() {
      let x = 0;
      let y = 0;
      for (let i = 0; i < this.N; i++) {
        x += this.pos[3 * i];
        y += this.pos[3 * i + 1];
      }
      return [x / this.N, y / this.N];
    }

    // Halı ışınlandığında (düzeltme, yükleme) eski kat bilgisi geçersizdir
    // Hızları sıfırla (uykuya geçerken: uyanınca birikmiş titreşim boşalmasın)
    freeze() {
      this.prev.set(this.pos);
    }

    resetContacts() {
      this.htKeys[0].fill(-1);
      this.htKeys[1].fill(-1);
      this.npairs = 0;
      this.grab = null;
    }

    serialize() {
      return { nx: this.nx, ny: this.ny, sp: this.sp, pos: Array.from(this.pos, (v) => Math.round(v * 10) / 10) };
    }

    restore(s) {
      if (!s || s.nx !== this.nx || s.ny !== this.ny || s.sp !== this.sp || !Array.isArray(s.pos) || s.pos.length !== this.pos.length) return false;
      if (!s.pos.every(Number.isFinite)) return false;
      this.pos.set(s.pos);
      this.prev.set(s.pos);
      this.resetContacts();
      return true;
    }
  }

  return { Rug, G };
});
