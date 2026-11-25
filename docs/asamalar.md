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
| 7 | Üyelik ve sepet | Sepet birleşir; başkasının verisine erişim reddedilir | Tamam (25.11.2026); proje sahibi onayladı |
| 8 | Sipariş, EFT, kapıda ödeme, mağazadan teslim | Geçerli ve yasak tüm durum geçişleri testli | Tamam (25.11.2026); proje sahibi onayladı |
| 9 | Kart ödemesi | Başarılı, red, tekrar, gecikme, sahte bildirim testli | Tamam (25.11.2026); proje sahibi onayladı. Yalnızca sahte sağlayıcıyla denendi |
| 10 | Kargo | Çift gönderi yok; manuel yol çalışır | Bekliyor |
| 11 | İptal ve iade | İade ödeneni aşamaz; çift iade yok | Bekliyor |
| 12 | Raporlar ve ayarlar | Elle hesaplanan toplamla birebir | Bekliyor |
| 13 | Yayın hazırlığı | Uzman kontrolü tamam; kritik bulgu yok | Bekliyor |
| 14 | Yayın | Geri yükleme testi; gerçek sipariş ve iade başarılı | Bekliyor |

## Aşama 8 iş kararları (25.11.2026)

1. Siparişi Super Admin, Admin ve Order Manager onaylar. EFT'de tek kişi yeterli.
2. EFT 2 iş günü bekler; sonra sipariş iptal olur, stok serbest kalır.
3. Kapıda ödeme (limit, ek ücret, kuryeye kart) ve telefon doğrulaması ayarlanabilir; değerler yayına yakın belirlenir.
4. Kargo 200 TL; ara toplam 1.000 TL ve üzeriyse ücretsiz, hediye paketi hesaba katılmaz. Ayarlanabilir.
5. Değişim, kısmi iade, mağazadan teslim ve taksit ilk sürümde var.
6. İsteyen müşteriye sipariş başına 5 TL'ye hediye paketi. Kupon, kampanya ve yorum kapsam dışı.
7. Mağazadan teslimde kargo ücreti yok; EFT veya mağazada ödeme (nakit/POS). Tahsilat yazılmadan teslim edilmez. 7 gün sonra panelde uyarı, iptali personel yapar.
8. Fatura bireysel veya kurumsal (unvan, vergi dairesi, vergi no). T.C. kimlik no istenmez.
9. Siparişte e-posta zorunlu; misafirin gizli bağlantısı da oraya gider.

## Aşama 9 iş kararları (25.11.2026)

1. Sahte sağlayıcıyla başlandı; yalnızca bu bilgisayarda çalışır, deneme modu kapatılırsa açılamaz.
2. Kart siparişinde stok 30 dakika ayrılır; ayarlanabilir.
3. Yalnızca tek çekim; taksit altyapısı hazır, teklifler gelene kadar kapalı.
4. "Kartımı hatırla" ilk sürümde yok.
5. Çift ödeme kendiliğinden iade edilmez; panelde uyarı çıkar, iade Aşama 11'de.

## Proje sahibinin paralel işleri

- [ ] Node.js'i 24.16 veya üstüne güncelleme (aşağıdaki teknik borç)

- [ ] Kişisel bakım: hukukçuyla ürün güvenliği ve kozmetik mevzuatı. Netleşene kadar sistem bu ürünleri yayınlamaz.
- [ ] Mali müşavir: ürün türlerine göre KDV oranları (panelde hazır oran yok)
- [ ] Hukukçu: üstü çizili "eski fiyat" kuralı (indirimden önceki 30 günün en düşük fiyatı). Netleşene kadar panelde eski fiyat girilmemeli.
- [ ] Hukukçu: ticari ileti izni metni, KVKK aydınlatma metni, üyelik sözleşmesi. Gelene kadar sitedeki metinler taslaktır ve ileti gönderilmez.
- [ ] TÜRKPATENT marka araması, ardından `alisbebe.com` satın alma
- [ ] Hukukçu: yurt dışında veri barındırma (KVKK m.9), ETBİS, İYS, ürün güvenliği, cayma/iade
- [ ] Mali müşavir: şirket türü, e-Arşiv, KDV, TCKN, kapıda ödeme belgesi
- [ ] iyzico ve PayTR teklifi: komisyon, vade, kısmi iade, taksit, sabit IP
- [ ] Kargo teklifleri: API, test ortamı, kapıda tahsilat, iade kodu, sabit IP
- [ ] Ürün fotoğrafları: açık zemin, 4:5 oran

## Teknik borçlar

- Windows'ta Node 24.0–24.15, çok sayıda kısa bağlantıda iz bırakmadan çöküyor (nodejs/node#63620, kod 0xC0000409; 24.16'da düzeltildi, Linux'ta yok). 25.11.2026'da sunucu ve test süreci bu yüzden düştü; proje kodu içermeyen denemede de 3 turda 2 kez çöktü. Aşağıdaki "tarayıcı testleri ara sıra düşüyor" kaydının çökme kısmının nedeni de büyük olasılıkla budur.
- Gerçek kart sağlayıcısı seçilince: kendi test ortamında deneme, zamanlanmış ödeme sorgusu, CSP'de sağlayıcı adresleri, sağlayıcının bildirim biçimine göre boyut denetimi, süresi dolan ödeme sayfasının yenilenmesi (şimdilik açık denemenin sayfa adresi hiç yenilenmez). Bir günden eski sonuçsuz deneme kendiliğinden sorgulanmaz.
- Ödeme bildirimi adresine istek sınırı yok (Aşama 13); imzasız istek veritabanına ulaşmaz.
- Sahte sağlayıcının denemeleri bellektedir; sunucu yeniden başlarsa açık deneme sonuçlanmaz.
- Sipariş e-postaları bir sipariş işleminin ardından gönderilir. Süresi dolan siparişin iletisi sıradaki işleme kadar bekler; zamanlanmış gönderim gerçek e-posta sağlayıcısıyla kurulacak. Şimdilik yalnızca yerel test kutusuna gider.
- Misafir, farklı telefon ve e-postalarla çok sayıda sipariş açıp stok ayırtabilir; istek sınırı Aşama 13'te.
- Deneme modu; sözleşmeler taslakken veya kargo, hediye paketi ve kapıda ödeme KDV oranları girilmeden kapanmaz (hukukçu ve mali müşavir bekleniyor).
- Para iadesinin kendisi Aşama 11'de; o zamana kadar panelde "Para iadesi bekleyen" olarak görünür.
- Aynı sekmede ikinci sipariş testi, istek anahtarı sayfadan verilmeden önceki kodda da geçiyordu; yani o değişiklik önlemdir, gösterilmiş bir hatanın düzeltmesi değildir.
- Tarayıcı testleri yoğun bilgisayarda ara sıra düşüyor (25.11.2026: 5 saniye sınırı iki kez, test sürecinin çökmesi bir kez). Testler tek başına geçiyor; kesin neden bulunmadı. Çöken test temizliğini yapamaz, sahte ürünü kalır.
- Sepet açmaya istek sınırı yok (Aşama 13). Süresi dolan misafir sepetleri, yeni misafir sepeti açıldıkça 100'er silinir.
- Sepet birleşirken 50 çeşidi aşan misafir ürünleri eklenmez.
- Sepete 10 adede kadar ekleyerek düşük stok tahmin edilebilir; bilerek kabul edildi.
- İlçe elle yazılıyor; liste kargo aşamasında (Aşama 10) ele alınacak.
- Hesap silme Aşama 13'te, hukukçuyla.
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
