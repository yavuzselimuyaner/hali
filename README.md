# Halı

Masaüstüne serilen, fiziği olan bir halı. Diğer pencerelerin altında, masaüstü
simgelerinin üstünde durur; halının olmadığı yerde tıklamalar masaüstüne geçer.

## Çalıştırma

- `baslat.vbs` dosyasına çift tıkla (konsol açmadan başlar), ya da `npm start`.
- Kapatmak: halıya veya sistem tepsisindeki halı simgesine sağ tık → **Kapat**.

## Kullanım

| Hareket | Ne olur |
|---|---|
| Köşeden / kenardan tutup sürükle | Köşe kalkar; halının üstüne götürüp bırakırsan katlanır |
| Ortadan tutup sürükle | Halı o noktadan çekilir; iterken kırışır, toplanır |
| Tutarken fare tekerleği | Elini yukarı/aşağı alır (kaldırma yüksekliği) |
| Ctrl + sürükle | Halıyı olduğu gibi kaydırır |
| Masaüstünden klasör/dosyayı halının üstüne bırak | Halının altına süpürülür: masaüstünden gizlenir, halıda tümsek olur |
| Halıyı kaldırınca/kaydırınca açığa çıkan simgeye çift tık | Masaüstüne geri çıkar |
| Açıktaki simgeyi sürükle | Zeminde taşınır (halının altına geri itilebilir) |
| Sağ tık | Halıyı düzelt, altındakilerin hepsini geri çıkar, Windows açılınca başlat, kapat |

Halının altına süpürmek dosyayı taşımaz veya silmez; sadece Windows'un "gizli"
özniteliğini açar (`attrib +h`). Geri çıkarınca kaldırılır. Explorer'da "gizli
öğeleri göster" açıksa simgeler soluk görünmeye devam eder.

Halının şekli ve altındakiler `%APPDATA%\hali\state.json` içinde saklanır.

## Halıyı değiştirmek

`src/hali.jpg` yerine başka bir halı fotoğrafı koy (üstten, kırpılmış). En-boy
oranı otomatik alınır. Daha yüksek çözünürlüklü fotoğraf daha keskin görünür.

## Testler

- `node test/fold.js` — fizik: köşe katlanıp yerinde kalıyor mu
- `node test/stress.js` — fizik: sert/rastgele çekişlerde kararlılık
- Betikli uygulama testi (ekran görüntüleri alır):
  `HALI_USERDATA=<geçici klasör> HALI_SCRIPT=test/drive.js node_modules/electron/dist/electron.exe .`
