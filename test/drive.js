// Betikli sürüş: HALI_SCRIPT=test/drive.js ile main tarafından yüklenir.
module.exports = async (win, app) => {
  const fs = require('fs');
  const path = require('path');
  const out = process.env.HALI_SHOTS || path.join(__dirname, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const wc = win.webContents;
  const { nativeImage } = require('electron');
  // Görüntüyü duvar kağıdı rengine benzer bir zemin üstüne birleştir (gölgeler görünsün)
  const shot = async (name) => {
    const img = await wc.capturePage();
    const { width, height } = img.getSize();
    const b = img.toBitmap();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = 4 * (y * width + x);
        const a = b[k + 3] / 255;
        const t = y / height;
        const bg = [150 - 40 * t, 125 - 30 * t, 95 - 20 * t]; // BGR: mavimsi duvar kağıdı
        b[k] = Math.min(255, b[k] + bg[0] * (1 - a));
        b[k + 1] = Math.min(255, b[k + 1] + bg[1] * (1 - a));
        b[k + 2] = Math.min(255, b[k + 2] + bg[2] * (1 - a));
        b[k + 3] = 255;
      }
    }
    const full = nativeImage.createFromBitmap(b, { width, height });
    fs.writeFileSync(path.join(out, name + '.png'), full.toPNG());
    fs.writeFileSync(path.join(out, name + '-yakin.png'), full.crop({ x: 480, y: 120, width: 820, height: 800 }).toPNG());
    console.log('shot', name);
  };
  const ev = (type, x, y, extra = {}) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const drag = async (x0, y0, x1, y1, steps, ms, mods = [], holdShot) => {
    ev('mouseMove', x0, y0, { modifiers: mods });
    ev('mouseDown', x0, y0, { modifiers: mods });
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      ev('mouseMove', x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, { modifiers: mods });
      await wait(ms / steps);
      if (holdShot && i === Math.round(steps / 2)) { await shot(holdShot); console.log('debug', JSON.stringify(await wc.executeJavaScript('window.__haliDebug()'))); }
    }
    await wait(250);
    ev('mouseUp', x1, y1, { modifiers: mods });
  };
  const [W, H] = win.getContentSize();
  const rugH = Math.min(H * 0.72, 680);
  const rugW = rugH * (371 / 539);
  const L = W / 2 - rugW / 2, T = H / 2 - rugH / 2;
  console.log('screen', W, H, 'rug', rugW.toFixed(0), rugH.toFixed(0));
  try {
    await wait(3500);
    await shot('01-serili');
    console.log('debug', JSON.stringify(await wc.executeJavaScript('window.__haliDebug && window.__haliDebug()')));
    // sol üst köşeyi tutup çaprazlama halının ortasına doğru katla
    await drag(L + 5, T + 5, W / 2 + 40, H / 2 + 30, 60, 1800, [], '02-kaldirildi');
    await wait(2500);
    await shot('03-katlandi');
    // Ctrl ile tüm halıyı kaydır
    await drag(W / 2 + 60, H / 2 + 150, W / 2 - 140, H / 2 + 120, 30, 900, ['control']);
    await wait(1500);
    await shot('04-kaydirildi');
    // halının içinden (alt kısım) tutup yukarı it: kırışık
    const L2 = L - 200, B2 = H / 2 + rugH / 2;
    await drag(L2 + rugW / 2, B2 - 90, L2 + rugW / 2, B2 - 260, 40, 1500, [], '05-itiliyor');
    await wait(2500);
    await shot('06-kirisik');
    // gizle / geri çıkar (attrib) uçtan uca
    const { execFileSync } = require('child_process');
    const tp = path.join(path.dirname(process.env.HALI_USERDATA), 'Gizlenecek');
    fs.mkdirSync(tp, { recursive: true });
    const attr = () => execFileSync('attrib', [tp]).toString().trim().slice(0, 12);
    console.log('önce', attr());
    const res = await wc.executeJavaScript('window.hali.hideItems(' + JSON.stringify([{ path: tp, x: 820, y: 700 }]) + ')');
    console.log('hide sonucu', res.items.length, 'başarısız', res.failed.length, 'attrib', attr());
    const ok = await wc.executeJavaScript('window.hali.restoreItem(' + JSON.stringify(tp) + ')');
    console.log('restore', ok, 'attrib', attr());
    await wait(9000);
    console.log('boşta', JSON.stringify(await wc.executeJavaScript('window.__haliDebug()')));
  } catch (e) {
    console.error('drive hata', e);
  }
  await wait(500);
  app.exit(0);
};
