'use strict';
// Halının çizimi (WebGL2) ve fare/sürükle-bırak etkileşimi.
(async function main() {
  const api = window.hali;
  const { Rug } = window.RugPhysics;

  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: true, // uykudayken de imlecin altındaki pikseli okuyabilmek için
  });
  if (!gl) {
    console.error('WebGL2 yok');
    return;
  }

  // ---------- sabitler
  const SP = 14; // parçacık aralığı (px)
  const F = 2600; // perspektif: kamera yüksekliği (px)
  const SMZ = 400; // gölge haritasında yükseklik ölçeği
  const LX = 0.45; // ışık yönü: yükseklik başına gölge kayması
  const LY = 0.6;
  const STEP = 1 / 60;

  // uyku: halı durulunca simülasyon ve çizim durur
  let awake = true;
  let calm = 0;
  let idle = 0;
  const perf = { n: 0, sum: 0 };
  function wake() {
    awake = true;
    calm = 0;
    idle = 0;
  }

  let W = innerWidth;
  let H = innerHeight;
  let DPR = devicePixelRatio || 1;

  // ---------- gölgelendiriciler
  const COMMON = `#version 300 es
precision highp float;
uniform vec2 uScreen;
uniform float uF;
vec4 project(vec3 p) {
  vec2 C = uScreen * 0.5;
  float w = (uF - p.z) / uF;
  vec2 rel = (p.xy - C) / C;
  rel.y = -rel.y;
  return vec4(rel, clamp(-p.z / 800.0, -1.0, 1.0) * w, w);
}
`;
  const SHADOW_LOOKUP = `
uniform sampler2D uSM;
uniform vec2 uSMTexel;
const float SMZ = ${SMZ}.0;
// p noktasının üstünde (ışık yönünde) halı var mı: 0..1
float occlusion(vec3 p, float lo, float hi) {
  vec2 q = p.xy + (p.z + 3.0) * vec2(${LX}, ${LY});
  vec2 uv = vec2(q.x / uScreen.x, 1.0 - q.y / uScreen.y);
  float me = p.z + 3.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++) {
      float h = texture(uSM, uv + vec2(float(i), float(j)) * uSMTexel * 1.5).r * SMZ;
      s += smoothstep(lo, hi, h - me);
    }
  return s / 9.0;
}
`;

  const RUG_VS = `${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUV;
layout(location = 3) in float aFr;
out vec3 vNor;
out vec2 vUV;
out float vFr;
out vec3 vWorld;
void main() {
  gl_Position = project(aPos);
  vNor = aNor;
  vUV = aUV;
  vFr = aFr;
  vWorld = aPos;
}`;
  const RUG_FS = `${COMMON}${SHADOW_LOOKUP}
in vec3 vNor;
in vec2 vUV;
in float vFr;
in vec3 vWorld;
uniform sampler2D uTex;
out vec4 o;
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(-${LX}, -${LY}, 1.0));
  float dif = max(dot(n, L), 0.0);
  float sh = occlusion(vWorld, 5.0, 14.0);
  float light = 0.2 + 1.0 * dif * (1.0 - 0.5 * sh) - 0.08 * sh; // düz yüzeyde ≈ 1
  if (vFr > 0.001) {
    // saçak: ince ipler
    float s = vUV.x * 95.0;
    float id = floor(s);
    float fx = fract(s);
    float strand = smoothstep(0.08, 0.28, fx) * (1.0 - smoothstep(0.52, 0.72, fx));
    float len = 0.72 + 0.28 * hash1(id);
    if (strand < 0.4 || vFr > len) discard;
    o = vec4(vec3(0.93, 0.9, 0.83) * light, 1.0);
    return;
  }
  vec3 col;
  if (gl_FrontFacing) {
    col = texture(uTex, vUV).rgb;
    // hav dokusu: hafif tane
    col *= 0.97 + 0.06 * hash1(floor(vUV.x * 900.0) + floor(vUV.y * 1300.0) * 17.0);
  } else {
    // halının arkası: desen bulanık, soluk, düğüm ızgarası
    vec3 t = texture(uTex, vUV, 0.8).rgb;
    float lum = dot(t, vec3(0.3, 0.59, 0.11));
    col = mix(vec3(lum), t, 0.72) * 0.8 + 0.1;
    float kx = abs(sin(vUV.x * 3.14159 * 140.0));
    float ky = abs(sin(vUV.y * 3.14159 * 200.0));
    col *= 0.93 + 0.07 * kx * ky;
  }
  o = vec4(col * light, 1.0);
}`;

  const SM_VS = `${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 3) in float aFr;
out float vH;
out float vFr;
void main() {
  vec2 q = aPos.xy + (aPos.z + 3.0) * vec2(${LX}, ${LY});
  vec2 rel = q / uScreen * 2.0 - 1.0;
  rel.y = -rel.y;
  gl_Position = vec4(rel, 0.0, 1.0);
  vH = aPos.z + 3.0;
  vFr = aFr;
}`;
  const SM_FS = `${COMMON}
in float vH;
in float vFr;
out vec4 o;
void main() {
  if (vFr > 0.001) discard;
  o = vec4(vH / ${SMZ}.0, 0.0, 0.0, 1.0);
}`;

  const QUAD_VS = `${COMMON}
layout(location = 4) in vec2 aCorner;
uniform vec4 uRect;
uniform float uZ;
out vec2 vUV;
out vec2 vFloor;
void main() {
  vec2 t = aCorner * 0.5 + 0.5;
  vec2 p = uRect.xy + t * uRect.zw;
  gl_Position = project(vec3(p, uZ));
  vUV = t;
  vFloor = p;
}`;
  const FLOOR_FS = `${COMMON}${SHADOW_LOOKUP}
uniform float uDpr;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uScreen.y - gl_FragCoord.y / uDpr);
  vec2 uv = vec2(p.x / uScreen.x, 1.0 - p.y / uScreen.y);
  float h0 = texture(uSM, uv).r * SMZ;
  float r = 1.0 + h0 * 0.05;
  float s = 0.0;
  for (int i = -2; i <= 2; i++)
    for (int j = -2; j <= 2; j++) {
      float h = texture(uSM, uv + vec2(float(i), float(j)) * uSMTexel * r).r * SMZ;
      s += smoothstep(0.5, 8.0, h);
    }
  s /= 25.0;
  float a = s * mix(0.5, 0.28, clamp(h0 / 160.0, 0.0, 1.0));
  o = vec4(0.0, 0.0, 0.0, a);
}`;
  const ITEM_FS = `${COMMON}${SHADOW_LOOKUP}
in vec2 vUV;
in vec2 vFloor;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uShade;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.02) discard;
  float sh = occlusion(vec3(vFloor, -3.0), 6.0, 14.0) * uShade;
  c.rgb *= 1.0 - 0.45 * sh;
  o = c * uAlpha;
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  const progRug = program(RUG_VS, RUG_FS);
  const progSM = program(SM_VS, SM_FS);
  const progFloor = program(QUAD_VS, FLOOR_FS);
  const progItem = program(QUAD_VS, ITEM_FS);

  // ---------- doku
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = 'hali.jpg';
  });
  const rugTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, rugTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

  // ---------- halı
  const saved = await api.getState();
  const rugH = Math.min(H * 0.72, 680);
  const rugW = rugH * (img.naturalWidth / img.naturalHeight);
  const nx = Math.round(rugW / SP) + 1;
  const ny = Math.round(rugH / SP) + 1;
  const rug = new Rug({ nx, ny, sp: SP, fringeLen: 16, cx: W / 2, cy: H / 2, z: 40, bounds: { x0: 0, y0: 0, x1: W, y1: H } });
  if (!rug.restore(saved.rug)) rug.layoutFlat(W / 2, H / 2, 40, 0); // ilk açılışta yukarıdan serilir

  const N = rug.N;
  const nr = rug.nr;
  const normals = new Float32Array(N * 3);
  const uvs = new Float32Array(N * 2);
  const fr = new Float32Array(N);
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nx; c++) {
      const i = r * nx + c;
      uvs[2 * i] = c / (nx - 1);
      uvs[2 * i + 1] = Math.min(1, Math.max(0, (r - 1) / (ny - 1)));
      fr[i] = r === 0 || r === nr - 1 ? 1 : 0;
    }
  }
  const idx = [];
  for (let r = 0; r < nr - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const indexCount = idx.length;

  const rugVAO = gl.createVertexArray();
  gl.bindVertexArray(rugVAO);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rug.pos.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const norBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
  gl.bufferData(gl.ARRAY_BUFFER, normals.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  const frBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, frBuf);
  gl.bufferData(gl.ARRAY_BUFFER, fr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ---------- gölge haritası (yükseklik, ışık yönünde zemine izdüşüm)
  const smTex = gl.createTexture();
  const smFbo = gl.createFramebuffer();
  let smW = 0;
  let smH = 0;
  function setupShadowMap() {
    smW = Math.max(16, Math.round(W / 2));
    smH = Math.max(16, Math.round(H / 2));
    gl.bindTexture(gl.TEXTURE_2D, smTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, smW, smH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, smFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, smTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize() {
    W = innerWidth;
    H = innerHeight;
    DPR = devicePixelRatio || 1;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    rug.bounds = { x0: 0, y0: 0, x1: W, y1: H };
    setupShadowMap();
    wake();
  }

  // ---------- halının altındaki eşyalar
  const items = [];
  const ITEM_W = 96;
  const ITEM_H = 92;
  function makeItemTexture(item) {
    const s = 2;
    const cv = document.createElement('canvas');
    cv.width = ITEM_W * s;
    cv.height = ITEM_H * s;
    const g = cv.getContext('2d');
    g.scale(s, s);
    const drawLabel = () => {
      g.font = '12px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.shadowColor = 'rgba(0,0,0,0.9)';
      g.shadowBlur = 3;
      g.shadowOffsetY = 1;
      g.fillStyle = '#fff';
      const lines = wrapText(g, item.name, ITEM_W - 8, 2);
      lines.forEach((ln, k) => g.fillText(ln, ITEM_W / 2, 56 + k * 15));
    };
    const upload = () => {
      if (!item.tex) item.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, item.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      wake();
    };
    drawLabel();
    if (item.icon === 'folder') {
      drawFolderIcon(g, ITEM_W / 2 - 24, 4, 48);
      upload();
    } else upload();
    if (item.icon && item.icon !== 'folder') {
      const im = new Image();
      im.onload = () => {
        g.save();
        g.shadowColor = 'transparent';
        g.drawImage(im, ITEM_W / 2 - 24, 4, 48, 48);
        g.restore();
        upload();
      };
      im.src = item.icon;
    }
  }
  // Windows 11 tarzı sarı klasör
  function drawFolderIcon(g, x, y, s) {
    const u = s / 48;
    g.save();
    g.translate(x, y);
    g.scale(u, u);
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    const rr = (x0, y0, w, h, r) => {
      g.beginPath();
      g.moveTo(x0 + r, y0);
      g.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
      g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
      g.arcTo(x0, y0 + h, x0, y0, r);
      g.arcTo(x0, y0, x0 + w, y0, r);
      g.closePath();
    };
    // arka kapak ve sekme
    g.fillStyle = '#e8a33c';
    g.beginPath();
    g.moveTo(4, 12);
    g.arcTo(4, 8, 8, 8, 3);
    g.lineTo(18, 8);
    g.lineTo(22, 12);
    g.lineTo(42, 12);
    g.arcTo(44, 12, 44, 14, 2);
    g.lineTo(44, 38);
    g.lineTo(4, 38);
    g.closePath();
    g.fill();
    g.shadowColor = 'transparent';
    // kağıt
    g.fillStyle = '#f4f4f4';
    rr(8, 14, 32, 18, 1.5);
    g.fill();
    // ön kapak
    const grd = g.createLinearGradient(0, 17, 0, 40);
    grd.addColorStop(0, '#ffd56b');
    grd.addColorStop(1, '#f5b93f');
    g.fillStyle = grd;
    rr(4, 17, 40, 23, 3);
    g.fill();
    g.restore();
  }
  function wrapText(g, text, maxW, maxLines) {
    const out = [];
    let cur = '';
    for (const ch of text) {
      if (g.measureText(cur + ch).width > maxW && cur) {
        out.push(cur);
        cur = ch;
        if (out.length === maxLines) break;
      } else cur += ch;
    }
    if (out.length < maxLines && cur) out.push(cur);
    else if (out.length === maxLines && cur) {
      let last = out[maxLines - 1];
      while (last && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last + '…';
    }
    return out;
  }
  function addItem(it, grow) {
    const item = { path: it.path, name: it.name, x: it.x, y: it.y, icon: it.icon, tex: null, grow };
    items.push(item);
    makeItemTexture(item);
    syncObstacles();
  }
  function removeItem(item) {
    const k = items.indexOf(item);
    if (k >= 0) items.splice(k, 1);
    if (item.tex) gl.deleteTexture(item.tex);
    syncObstacles();
    wake();
  }
  function syncObstacles() {
    rug.obstacles = items.map((it) => ({ x: it.x, y: it.y, r: 36, h: 20 * it.grow }));
  }
  for (const it of saved.items || []) addItem(it, 1);

  // ---------- yardımcılar: izdüşüm ve seçme
  const sx = new Float32Array(N);
  const sy = new Float32Array(N);
  function projectAll() {
    const cx = W / 2;
    const cy = H / 2;
    const p = rug.pos;
    for (let i = 0; i < N; i++) {
      const s = F / (F - p[3 * i + 2]);
      sx[i] = cx + (p[3 * i] - cx) * s;
      sy[i] = cy + (p[3 * i + 1] - cy) * s;
    }
  }
  // ekran noktası -> verilen yükseklikteki dünya noktası
  function unproject(x, y, z) {
    const s = (F - z) / F;
    return [W / 2 + (x - W / 2) * s, H / 2 + (y - H / 2) * s];
  }
  // İmlecin altındaki en üstteki halı noktası
  function pickRug(x, y) {
    projectAll();
    const p = rug.pos;
    let best = null;
    for (let r = 1; r < ny; r++) {
      for (let c = 0; c < nx - 1; c++) {
        const a = r * nx + c;
        const tris = [
          [a, a + 1, a + nx],
          [a + 1, a + nx + 1, a + nx],
        ];
        for (const [i0, i1, i2] of tris) {
          const x0 = sx[i0], y0 = sy[i0], x1 = sx[i1], y1 = sy[i1], x2 = sx[i2], y2 = sy[i2];
          if (x < Math.min(x0, x1, x2) || x > Math.max(x0, x1, x2) || y < Math.min(y0, y1, y2) || y > Math.max(y0, y1, y2)) continue;
          const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
          if (Math.abs(den) < 1e-6) continue;
          const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
          const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
          const l2 = 1 - l0 - l1;
          if (l0 < -0.01 || l1 < -0.01 || l2 < -0.01) continue;
          const z = l0 * p[3 * i0 + 2] + l1 * p[3 * i1 + 2] + l2 * p[3 * i2 + 2];
          if (!best || z > best.z) {
            const near = l0 >= l1 && l0 >= l2 ? i0 : l1 >= l2 ? i1 : i2;
            best = { z, idx: near };
          }
        }
      }
    }
    return best;
  }
  function pickItem(x, y) {
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (x > it.x - 40 && x < it.x + 40 && y > it.y - 28 && y < it.y + 60) return it;
    }
    return null;
  }

  // ---------- etkileşim
  let mode = null; // 'grab' | 'slide' | 'item'
  let grab = null;
  let dragItem = null;
  let mouse = { x: 0, y: 0 };
  let lastSlide = null;

  function startGrab(hit, e) {
    const r0 = rug.row[hit.idx];
    const c0 = rug.col[hit.idx];
    const ids = [];
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (r >= 1 && r <= ny && c >= 0 && c < nx) ids.push(r * nx + c);
      }
    }
    const p = rug.pos;
    const k0 = 3 * hit.idx;
    const off = ids.map((i) => [p[3 * i] - p[k0], p[3 * i + 1] - p[k0 + 1]]);
    const edge = Math.min(c0, nx - 1 - c0, r0 - 1, ny - r0);
    const liftTarget = edge <= 1 ? 60 : edge <= 3 ? 40 : 24;
    // imleç ile tutulan nokta arasındaki fark korunur (tutulan nokta zıplamasın)
    const [hx, hy] = unproject(e.clientX, e.clientY, p[k0 + 2]);
    grab = {
      ids: Int32Array.from(ids),
      off,
      baseZ: p[k0 + 2],
      lift: 0,
      liftTarget,
      dx: p[k0] - hx,
      dy: p[k0 + 1] - hy,
    };
    rug.grab = { ids: grab.ids, tx: new Float32Array(ids.length), ty: new Float32Array(ids.length), tz: new Float32Array(ids.length) };
    updateGrabTargets();
  }
  function updateGrabTargets() {
    if (!grab || !rug.grab) return;
    grab.lift += (grab.liftTarget - grab.lift) * 0.18;
    const z = grab.baseZ + grab.lift;
    const [hx, hy] = unproject(mouse.x, mouse.y, z);
    const g = rug.grab;
    for (let k = 0; k < grab.ids.length; k++) {
      g.tx[k] = hx + grab.dx + grab.off[k][0];
      g.ty[k] = hy + grab.dy + grab.off[k][1];
      g.tz[k] = z;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    mouse = { x: e.clientX, y: e.clientY };
    const hit = pickRug(e.clientX, e.clientY);
    if (hit) {
      if (e.ctrlKey) {
        mode = 'slide';
        lastSlide = { x: e.clientX, y: e.clientY };
      } else {
        mode = 'grab';
        startGrab(hit, e);
      }
    } else {
      const it = pickItem(e.clientX, e.clientY);
      if (!it) return;
      mode = 'item';
      dragItem = { item: it, dx: it.x - e.clientX, dy: it.y - e.clientY };
    }
    canvas.setPointerCapture(e.pointerId);
    setInteractive(true);
    wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (!mode) return;
    if (mode === 'slide') {
      rug.dragDX += e.clientX - lastSlide.x;
      rug.dragDY += e.clientY - lastSlide.y;
      lastSlide = { x: e.clientX, y: e.clientY };
    } else if (mode === 'item') {
      dragItem.item.x = Math.min(W - 10, Math.max(10, e.clientX + dragItem.dx));
      dragItem.item.y = Math.min(H - 10, Math.max(10, e.clientY + dragItem.dy));
      syncObstacles();
    }
    wake();
  });
  function endPointer(e) {
    if (!mode) return;
    if (mode === 'grab') {
      rug.grab = null;
      grab = null;
    } else if (mode === 'item') {
      const it = dragItem.item;
      api.moveItem(it.path, it.x, it.y);
      dragItem = null;
    }
    mode = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* zaten bırakıldı */
    }
    wake();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (mode !== 'grab' || !grab) return;
      grab.liftTarget = Math.min(260, Math.max(4, grab.liftTarget - e.deltaY * 0.15));
      wake();
    },
    { passive: true }
  );

  canvas.addEventListener('dblclick', async (e) => {
    if (pickRug(e.clientX, e.clientY)) return;
    const it = pickItem(e.clientX, e.clientY);
    if (!it) return;
    if (await api.restoreItem(it.path)) removeItem(it);
  });

  window.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const onRug = pickRug(e.clientX, e.clientY);
    const it = onRug ? null : pickItem(e.clientX, e.clientY);
    if (it) {
      const choice = await api.itemMenu(it.path);
      if (choice === 'restore') {
        if (await api.restoreItem(it.path)) removeItem(it);
      } else if (choice === 'open') api.openItem(it.path);
    } else {
      await api.rugMenu();
    }
  });

  // Masaüstünden sürüklenen klasör/dosyalar: halının üstüne bırakılınca altına süpürülür
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    // 'copy': Explorer kaynağı silmesin (taşıma etkisi kaynağın silinmesine yol açabilir)
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    const list = paths.map((p, k) => ({ path: p, x: e.clientX + (k % 4) * 30 - 15, y: e.clientY + Math.floor(k / 4) * 30 }));
    const res = await api.hideItems(list);
    for (const it of res.items) addItem(it, 0);
    if (res.failed.length) toast(`${res.failed.length} öğe gizlenemedi (izin yok olabilir)`, e.clientX, e.clientY);
    wake();
  });

  function toast(text, x, y) {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = `position:fixed;left:${x + 12}px;top:${y + 12}px;padding:6px 10px;border-radius:6px;background:rgba(20,20,20,.85);color:#fff;font:12px "Segoe UI",sans-serif;pointer-events:none;transition:opacity .4s`;
    document.body.appendChild(d);
    setTimeout(() => (d.style.opacity = '0'), 2200);
    setTimeout(() => d.remove(), 2700);
  }

  api.onCommand((cmd) => {
    if (cmd === 'flatten') {
      let a = rug.angle();
      if (Math.abs(a) < 0.2) a = 0;
      let [cx, cy] = rug.centroid();
      const hw = rugW / 2 + 10;
      const hh = rugH / 2 + 26;
      cx = Math.min(W - hw, Math.max(hw, cx));
      cy = Math.min(H - hh, Math.max(hh, cy));
      rug.layoutFlat(cx, cy, 30, a);
      rug.resetContacts();
      mode = null;
      grab = null;
      wake();
    } else if (cmd === 'items-cleared') {
      for (const it of [...items]) removeItem(it);
    }
  });

  // ---------- tıklanabilirlik: imlecin altında halı/eşya pikseli var mı
  let cursor = { x: -1, y: -1 };
  let cursorDirty = true;
  let interactive = false;
  const px = new Uint8Array(4);
  api.onCursor((p) => {
    cursor = p;
    cursorDirty = true;
  });
  function setInteractive(on) {
    if (on === interactive) return;
    interactive = on;
    api.setInteractive(on);
  }
  function hitTest() {
    if (mode) return setInteractive(true);
    if (cursor.x < 0 || cursor.y < 0 || cursor.x >= W || cursor.y >= H) return setInteractive(false);
    const x = Math.floor(cursor.x * DPR);
    const y = canvas.height - 1 - Math.floor(cursor.y * DPR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    setInteractive(px[3] > 140);
  }

  // ---------- çizim
  function computeNormals() {
    const p = rug.pos;
    for (let r = 0; r < nr; r++) {
      const ru = r > 0 ? r - 1 : r;
      const rd = r < nr - 1 ? r + 1 : r;
      for (let c = 0; c < nx; c++) {
        const cl = c > 0 ? c - 1 : c;
        const cr = c < nx - 1 ? c + 1 : c;
        const a = 3 * (r * nx + cl);
        const b = 3 * (r * nx + cr);
        const u = 3 * (ru * nx + c);
        const d = 3 * (rd * nx + c);
        const ax = p[b] - p[a], ay = p[b + 1] - p[a + 1], az = p[b + 2] - p[a + 2];
        const bx = p[d] - p[u], by = p[d + 1] - p[u + 1], bz = p[d + 2] - p[u + 2];
        const k = 3 * (r * nx + c);
        normals[k] = ay * bz - az * by;
        normals[k + 1] = az * bx - ax * bz;
        normals[k + 2] = ax * by - ay * bx;
      }
    }
  }

  function setCommon(prog) {
    gl.useProgram(prog.p);
    if (prog.u.uScreen) gl.uniform2f(prog.u.uScreen, W, H);
    if (prog.u.uF) gl.uniform1f(prog.u.uF, F);
    if (prog.u.uSM) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, smTex);
      gl.uniform1i(prog.u.uSM, 1);
      gl.uniform2f(prog.u.uSMTexel, 1 / smW, 1 / smH);
    }
  }

  function drawItem(it, alpha, shade) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.uniform1i(progItem.u.uTex, 0);
    gl.uniform4f(progItem.u.uRect, it.x - ITEM_W / 2, it.y - 28, ITEM_W, ITEM_H);
    gl.uniform1f(progItem.u.uZ, -1);
    gl.uniform1f(progItem.u.uAlpha, alpha);
    gl.uniform1f(progItem.u.uShade, shade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function render() {
    computeNormals();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rug.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);

    // 1) gölge haritası
    gl.bindFramebuffer(gl.FRAMEBUFFER, smFbo);
    gl.viewport(0, 0, smW, smH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    setCommon(progSM);
    gl.bindVertexArray(rugVAO);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    gl.blendEquation(gl.FUNC_ADD);

    // 2) ekran
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // zemine düşen gölge (sadece halının çevresinde)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zMax = 0;
    const p = rug.pos;
    for (let i = 0; i < N; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z > zMax) zMax = z;
    }
    const m = 30 + zMax * 0.6;
    const scX = Math.max(0, Math.floor((x0 - m) * DPR));
    const scY = Math.max(0, Math.floor((H - (y1 + m)) * DPR));
    const scW = Math.min(canvas.width, Math.ceil((x1 + m) * DPR)) - scX;
    const scH = Math.min(canvas.height, Math.ceil((H - (y0 - m)) * DPR)) - scY;
    if (scW > 0 && scH > 0) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(scX, scY, scW, scH);
      setCommon(progFloor);
      gl.uniform1f(progFloor.u.uDpr, DPR);
      gl.uniform4f(progFloor.u.uRect, 0, 0, W, H);
      gl.uniform1f(progFloor.u.uZ, 0);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
    }

    // zemindeki eşyalar (halının altında kalanlar derinlik testiyle gizlenir)
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    setCommon(progItem);
    gl.bindVertexArray(quadVAO);
    for (const it of items) if (it.tex && !(dragItem && dragItem.item === it)) drawItem(it, 1, 1);

    // halı
    gl.disable(gl.BLEND);
    gl.frontFace(gl.CW); // yukarı bakan yüz = halının önü
    setCommon(progRug);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rugTex);
    gl.uniform1i(progRug.u.uTex, 0);
    gl.bindVertexArray(rugVAO);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);

    // sürüklenen eşya: en üstte, yarı saydam
    if (dragItem && dragItem.item.tex) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      setCommon(progItem);
      gl.bindVertexArray(quadVAO);
      drawItem(dragItem.item, 0.8, 0);
    }
    gl.bindVertexArray(null);
  }

  // ---------- döngü
  let acc = 0;
  let last = performance.now();
  function physicsStep() {
    if (mode === 'grab') updateGrabTargets();
    let growing = false;
    for (const it of items) {
      if (it.grow < 1) {
        it.grow = Math.min(1, it.grow + 0.06);
        growing = true;
      }
    }
    if (growing) syncObstacles();
    const t0 = performance.now();
    const move = rug.step(STEP);
    perf.n++;
    perf.sum += performance.now() - t0;
    if (!mode && !growing && (move < 0.6 || rug.meanMove < 0.04)) calm++;
    else calm = 0;
    idle = mode || growing ? 0 : idle + 1;
    // Durulunca ya da 3 sn dokunulmayınca (çok buruşmuş halı hafifçe titreşip durabilir) dondur
    if (calm > 90 || idle > 180) {
      awake = false;
      rug.freeze();
      api.saveRug(rug.serialize());
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (awake) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 2) {
        physicsStep();
        acc -= STEP;
        n++;
        if (!awake) break;
      }
      if (n === 2) acc = 0; // yetişemiyorsak yavaşla, birikme yapma
      render();
      cursorDirty = true;
    } else acc = 0;
    if (cursorDirty) {
      hitTest();
      cursorDirty = false;
    }
  }

  // test betiği (test/drive.js) için durum özeti
  window.__haliDebug = () => {
    const out = {};
    gl.bindFramebuffer(gl.FRAMEBUFFER, smFbo);
    out.fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    const buf = new Uint8Array(smW * smH * 4);
    gl.readPixels(0, 0, smW, smH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let mx = 0, nz = 0;
    for (let i = 0; i < buf.length; i += 4) { if (buf[i] > mx) mx = buf[i]; if (buf[i]) nz++; }
    out.smMax = mx; out.smNonZero = nz; out.sm = [smW, smH];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    out.glError = gl.getError();
    out.physMs = perf.n ? +(perf.sum / perf.n).toFixed(2) : 0;
    perf.n = perf.sum = 0;
    out.items = items.length; out.obstacles = rug.obstacles; out.awake = awake;
    out.mode = mode; out.interactive = interactive; out.calm = calm; out.idle = idle;
    out.meanMove = rug.meanMove; out.pairs = rug.npairs; out.W = W; out.H = H; out.DPR = DPR;
    let st = 0;
    for (let e = 0; e < rug.cA.length; e++) {
      const a = 3 * rug.cA[e], b = 3 * rug.cB[e];
      const d = Math.hypot(rug.pos[b] - rug.pos[a], rug.pos[b + 1] - rug.pos[a + 1], rug.pos[b + 2] - rug.pos[a + 2]);
      st = Math.max(st, Math.abs(d / rug.cRest[e] - 1));
    }
    out.maxStrain = +st.toFixed(3);
    return out;
  };
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})().catch((e) => console.error(e));
