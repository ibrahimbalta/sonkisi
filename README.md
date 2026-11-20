# 👑 SON KİŞİ — 50 Kişilik Online Multiplayer Parti Oyunu

> **Herkes elenir, bir kişi kazanır!**

**SON KİŞİ**, mobil (Android / iPhone) ve bilgisayar tarayıcılarında oynanabilen, gerçek zamanlı **50 kişilik** online multiplayer parti / hayatta kalma oyunudur.

## Mimari & Teknolojiler

- **Frontend (`client/`):** Phaser 3, TypeScript, Vite, Web Audio API (prosedürel ses efektleri), Mobil Sanal Joystick + WASD / Yön Tuşları
- **Multiplayer Sunucu (`server/`):** Node.js, TypeScript, Colyseus (gerçek zamanlı sunucu-yetkili fizik, 50 kişilik oda kapasitesi, otomatik yeniden bağlanma, özel oda kodları)
- **Ortak Tanımlar (`shared/`):** Arena boyutları, renkler, 12 karakter, tepki emojileri, istemci/sunucu mesaj tipleri
- **Veritabanı & Kimlik Doğrulama (`supabase/`):** Supabase Auth, kullanıcı profilleri, maç sonuçları, Günlük / Haftalık / Genel / En Çok Kazanan / En Yüksek Seri sıralama görünümleri (`supabase/schema.sql`)

---

## Hızlı Kurulum ve Çalıştırma

### 1. Bağımlılıkları yükleyin

```bash
npm run install:all
```

### 2. Multiplayer Sunucuyu Başlatın (Terminal 1)

```bash
npm run dev:server
```

Sunucu varsayılan olarak `ws://localhost:2567` adresinde çalışır. Sağlık ve anlık oyuncu sayısı kontrolü: `http://localhost:2567/health`

### 3. Oyun İstemcisini Başlatın (Terminal 2)

```bash
npm run dev:client
```

Tarayıcıda `http://localhost:5173` adresini açın. Aynı Wi-Fi ağındaki telefonunuzdan da bilgisayarınızın yerel IP adresiyle (`http://<BILGISAYAR_IP>:5173`) doğrudan bağlanıp test edebilirsiniz!

---

## Nasıl Test Edilir?

- **Genel Oda (`OYNA`):** Gerçek 50 kişilik eşleştirme odasına bağlanır. En az **10 gerçek oyuncu** olduğunda geri sayım otomatik başlar (yerel test için `server/.env` içinde `MIN_PLAYERS=2` ayarlanabilir).
- **Arkadaşlarınla Oyna (`Özel Oda`):** 6 haneli oda kodu ve paylaşılabilir davet bağlantısı (`?room=KOD`) üretir. Oda sahibi istediği an (2+ arkadaşla veya tek kişilik arena testi için) **Oyunu Başlat** butonuna basabilir.
- **Sahte oyuncu (bot) veya sahte sıralama verisi kullanılmaz.**

---

## Supabase Entegrasyonu (Bulut Hesap & Dünya Sıralaması)

Oyun Supabase olmadan da **Misafir Modu** ile tam fonksiyonel olarak oynanabilir. Bulut hesaplar ve gerçek **Dünya Sıralaması** için:

1. [Supabase](https://supabase.com) üzerinde ücretsiz bir proje oluşturun.
2. SQL Editor bölümünde `supabase/schema.sql` dosyasının tamamını çalıştırın.
3. `client/.env.example` dosyasını `client/.env` olarak kopyalayıp proje bilgilerinizi girin:

```env
VITE_SERVER_URL=ws://localhost:2567
VITE_SUPABASE_URL=https://PROJE-ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

---

## Yayınlama (Production Deployment)

1. **Multiplayer Sunucu (`server/`):** Render, Railway veya Fly.io üzerinde Node.js servisi olarak yayınlayın (`npm --prefix server run build` ve `npm --prefix server start`).
2. **Frontend (`client/`):** Vercel, Netlify veya Cloudflare Pages üzerinde yayınlayın ve `VITE_SERVER_URL=wss://sunucu-adresiniz.com` ile Supabase ortam değişkenlerini tanımlayın.

---

## Açıkça Belirtilen Dış Bağımlılıklar

- **Supabase Anahtarları:** `client/.env` tanımlanmadıkça hesap oluşturma ve Dünya Sıralaması pasif kalır (sahte veri gösterilmez, yerine yerel oturum istatistikleri gösterilir).
- **İnternet Üzerinden Oynama:** Yerel geliştirme ortamında sunucu `localhost:2567` üzerinde çalışır; tüm dünyadan oyuncuların bağlanabilmesi için `server/` projesinin herkese açık bir WebSocket sunucusuna deploy edilmesi gerekir.
