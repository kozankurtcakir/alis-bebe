# Aşamalar

Her aşamada ortak kriter: testler geçer, kritik güvenlik bulgusu kalmaz, gösterim yapılır, proje sahibi onaylar.

| # | Aşama | Bitti sayılması için | Durum |
|---|---|---|---|
| 0 | Kararlar, şema, taslaklar | Sorular 1–6 yanıtlı; şema ve taslaklar onaylı | Tamam (24.11.2026); taslaklar taslak olarak onaylandı, ileride geliştirilecek |
| 1 | Kurulum | Temiz kurulum çalışır; testler geçer; depoda gizli anahtar yok | Tamam (24.11.2026); GitHub gönderimi ve CI başarılı |
| 2 | Kimlik ve yetki | Her rol için izin/red testi; yetki yükseltme başarısız | Tamam (24.11.2026); proje sahibi denedi ve onayladı |
| 3 | Katalog paneli | Yinelenen SKU ve sahte görsel reddedilir | Tamam (24.11.2026); proje sahibi onayladı |
| 4 | Stok | 50 eşzamanlı istekte stok eksiye düşmez; hareket toplamı stoğa eşit | Tamam (24.11.2026); proje sahibi onayladı |
| 5 | Excel | Hatalı dosya veri değiştirmez; baştaki sıfır korunur | Tamam (25.11.2026); proje sahibi onayladı |
| 6 | Mağaza | "İ/ı" araması doğru; WCAG 2.2 AA; mobil LCP ≤ 2,5 sn hedefi | Tamam (25.11.2026); proje sahibi onayladı |
| 7 | Üyelik ve sepet | Sepet birleşir; başkasının verisine erişim reddedilir | Tasarım onayı bekliyor |
| 8 | Sipariş, EFT, kapıda ödeme | Geçerli ve yasak tüm durum geçişleri testli | Bekliyor |
| 9 | Kart ödemesi | Başarılı, red, tekrar, gecikme, sahte bildirim testli | Bekliyor |
| 10 | Kargo | Çift gönderi yok; manuel yol çalışır | Bekliyor |
| 11 | İptal ve iade | İade ödeneni aşamaz; çift iade yok | Bekliyor |
| 12 | Raporlar ve ayarlar | Elle hesaplanan toplamla birebir | Bekliyor |
| 13 | Yayın hazırlığı | Uzman kontrolü tamam; kritik bulgu yok | Bekliyor |
| 14 | Yayın | Geri yükleme testi; gerçek sipariş ve iade başarılı | Bekliyor |

## Açık iş soruları (Aşama 8'den önce)

1. Siparişi kim onaylayacak? EFT'de görev ayrılığı (iki kişi) uygulanacak mı?
2. EFT bekleme süresi, kapıda ödeme limiti ve ek ücreti? Kuryeye kartla ödeme?
3. Kargo ücreti ve ücretsiz kargo sınırı?
4. Değişim, kısmi iade, mağazadan teslim, taksit?
5. Hediye paketi veya notu? (Kupon, kampanya ve yorum şimdilik kapsam dışı.)

## Proje sahibinin paralel işleri

- [ ] Kişisel bakım: hukukçuyla ürün güvenliği ve kozmetik mevzuatı. Netleşene kadar sistem bu ürünleri yayınlamaz.
- [ ] Mali müşavir: ürün türlerine göre KDV oranları (panelde hazır oran yok)
- [ ] Hukukçu: üstü çizili "eski fiyat" kuralı (indirimden önceki 30 günün en düşük fiyatı). Netleşene kadar panelde eski fiyat girilmemeli.
- [ ] TÜRKPATENT marka araması, ardından `alisbebe.com` satın alma
- [ ] Hukukçu: yurt dışında veri barındırma (KVKK m.9), ETBİS, İYS, ürün güvenliği, cayma/iade
- [ ] Mali müşavir: şirket türü, e-Arşiv, KDV, TCKN, kapıda ödeme belgesi
- [ ] iyzico ve PayTR teklifi: komisyon, vade, kısmi iade, taksit, sabit IP
- [ ] Kargo teklifleri: API, test ortamı, kapıda tahsilat, iade kodu, sabit IP
- [ ] Ürün fotoğrafları: açık zemin, 4:5 oran

## Teknik borçlar

- Olmayan ürün ve kategori sayfası 200 durumuyla ve `noindex` ile döner (Next `cacheComponents` sınırı); gerçek 404 Aşama 13'te SEO ile ele alınacak.
- Arama sözcük başına bakar, yazım hatasını düzeltmez: "zıbınlar", adı "zıbın" olan ürünü bulmaz.
- Mağaza aramasına istek sınırı yok; yayın altyapısıyla konacak (Aşama 13).
- Ürün veya kategori adresi değişirse eski bağlantı çalışmaz; yönlendirme Aşama 13'te.
- Aynı ürünü iki kişi aynı anda düzenlerse son kaydeden geçerli olur; önceki değer işlem geçmişinde kalır.
- Depoya yükleme yetkisi olan personel, paneli atlayıp WebP diye işaretlenmiş başka içerik yükleyebilir; site bunu yalnızca görsel olarak sunar (`nosniff`).
- ESLint 9 destek dışı; Next eklentileri ESLint 10'u destekleyince yükseltilecek (yalnızca geliştirme aracı).
- CSP `script-src 'unsafe-inline'` içeriyor; Aşama 13'te sıkılaştırılacak.
- `icon.svg` geçicidir; logo kararıyla değişecek.
- GitHub deposu şimdilik herkese açık (proje sahibi 24.11.2026'da bilerek kabul etti); mümkün olunca özel yapılacak.
- Yerel Supabase portları `0.0.0.0` üzerinde açılıyor; Docker'ın gelen bağlantı izni kapatılmadan ortak ağda çalıştırılmaz.
- `audit_logs.ip` henüz doldurulmuyor; güvenilir istemci IP'si yayın altyapısıyla belirlenecek (Aşama 13).
- Giriş denemesi sınırı IP başına; istekler Next.js sunucusundan gideceği için yayında gerçek istemci IP'siyle çalışması sağlanacak (Aşama 13).
