# CLAUDE.md — Aliş Bebe E-Ticaret Platformu

Bu dosya projenin ana talimat dosyasıdır. Her oturumda önce bu dosya okunur ve kurallarına uyulur.

## Proje durumu

- **Genel onay:** Proje sahibi 24.11.2026'da mimariyi, veritabanı taslağını, akışları, 15 aşamayı, görsel yönü ve bütçeyi onayladı; aşamaların sırayla kurulmasını istedi.
- **Güncel aşama:** Aşama 0-6 tamam (25.11.2026); Aşama 7'nin tasarımı proje sahibinin onayını bekliyor. Ayrıntı: `docs/asamalar.md`.
- Bir karar kesinleştiğinde veya aşama bittiğinde bu bölüm, "Kararlar" bölümü ve `docs/asamalar.md` güncellenir.

## Belgeler

- `docs/veritabani.md`: ayrıntılı şema. Veritabanına dokunmadan önce oku.
- `docs/kurallar.md`: yetki listesi ve sipariş/ödeme/stok/iade kuralları. İlgili kodu yazmadan önce oku.
- `docs/asamalar.md`: aşamalar, tamamlanma kriterleri, açık sorular.
- `docs/taslaklar.html`: sayfa taslakları (tarayıcıda açılır).
- `AGENTS.md`: Next.js tarafından üretilir; Next kodu yazmadan önce `node_modules/next/dist/docs/` içindeki ilgili rehbere bak.

## Proje amacı

**Aliş Bebe**, Eskişehir'de fiziksel mağazası olan bir bebek/çocuk giyim işletmesidir. Amaç, Türkiye genelinde satış yapacak modern, güvenli, hızlı, mobil uyumlu ve ölçeklenebilir bir e-ticaret platformudur.

## Çalışma kuralları

Proje sahibi bilgisayar mühendisliği öğrencisidir ve web geliştirmede başlangıç seviyesindedir. İletişim dili Türkçedir.

1. Her işlemi adım adım açıkla; yeni terimleri ilk geçtiği yerde kısaca tanımla.
2. Bir aşamayı tamamlamadan sonrakine geçme.
3. Kod yazmadan önce mimariyi ve veritabanı tasarımını açıkla.
4. Önemli kararları proje sahibine sor; kendi başına kesinleştirme.
5. Gereksiz karmaşıklıktan kaçın.
6. Güvenlikten ödün verme.
7. Her aşamada test yap; sonucu olduğu gibi bildir.
8. Hata oluşursa önce nedenini açıkla, sonra çözüm öner.
9. Mevcut dosyaları incelemeden üzerine yazma veya silme.
10. Onay olmadan harici servislerde ücretli işlem yapma.
11. API anahtarlarını ve şifreleri kaynak koduna yazma.

## Teknoloji ve mimari (onaylandı)

- Next.js (App Router), TypeScript, Tailwind CSS
- Supabase: PostgreSQL, Authentication, Storage. Veri erişimi `supabase-js`; Prisma kullanılmaz.
- Git ve GitHub; yayında Vercel Pro ve Supabase Pro. **Yayına kadar geliştirme yereldir; Vercel Hobby kullanılmaz.**
- Test: Vitest (birim), pgTAP (veritabanı/RLS), Playwright (tarayıcı)
- **Modüler monolit:** tek uygulama; her modül kendi klasöründe, başka modülün tablosuna doğrudan yazmaz.

### Değişmez teknik kurallar
- Para kuruş cinsinden tam sayıdır; tarih UTC saklanır.
- Tarayıcıdan gelen fiyat, tutar ve yetki bilgisine güvenilmez.
- Stok, sipariş ve ödeme yazımı yalnızca atomik PostgreSQL fonksiyonlarıyla yapılır.
- Her tabloda RLS açıktır; izin ve red durumları birlikte test edilir.
- `service_role` anahtarı yalnızca sunucuda; webhook, misafir siparişi ve zamanlanmış görevlerde kullanılır.
- `stock_movements` ve `audit_logs` yalnızca eklenir. Stok hatası ters kayıtla düzeltilir.
- Ödeme ve kargo, `PaymentProvider` ve `ShippingProvider` arayüzlerinin arkasındadır.
- Geliştirmede yalnızca sahte test verisi kullanılır.

## Gereksinimler

### Müşteri tarafı
Ana sayfa, ürün listeleme, kategori/alt kategori, ürün arama, gelişmiş filtreleme ve sıralama, ürün detay, beden ve renk seçenekleri, sepet, üyelik ve misafir alışverişi, adres yönetimi, sipariş takibi, favoriler, iade ve iptal talepleri, mobil uyumlu tasarım.

### Ürün ve stok
- Ürünlerin beden ve renk varyantları vardır.
- Her varyantın kendi fiyatı, stok miktarı, SKU'su ve barkodu vardır.
- Stok varyant bazında takip edilir; her stok hareketi kayda geçer.
- Kritik stok uyarısı bulunur.
- Ürün manuel eklenebilir; Excel ile toplu ekleme ve güncelleme yapılabilir.
- Excel yüklemesi uygulanmadan önce doğrulama ve önizleme zorunludur.
- Ürün görselleri sisteme yüklenebilir.
- **İlk sürüm kapsam dışı:** fiziksel mağaza stok sistemi entegrasyonu. Yalnızca web sitesi stoğu takip edilir.

### Ödeme
Yöntemler: kredi/banka kartı, kapıda ödeme, havale/EFT.

- Kart ödemesi, ödeme sağlayıcısından sunucu tarafında doğrulanır.
- Havale/EFT siparişi, ödeme kontrol edilene kadar beklemede kalır.
- Kapıda ödeme siparişi yönetici onayına sunulur.
- **Tüm siparişler** hazırlanma aşamasına geçmeden önce yönetici tarafından incelenip onaylanır.
- Başarısız ödeme, iptal, iade ve stok işlemleri birbiriyle tutarlı yönetilir.
- Kart bilgileri kendi sistemimizde **kesinlikle saklanmaz**; güvenli ödeme sağlayıcısı kullanılır.
- Sağlayıcı seçilmedi (iyzico ve PayTR adaydır).

### Kargo
- Kargo API entegrasyonu planlanıyor; firma seçilmedi.
- Siparişe takip numarası eklenebilir, kargo durumu takip edilebilir.

### Yönetim paneli
Birden fazla personel kullanır. Modüller: genel istatistikler, ürün, kategori, varyant, stok, sipariş, müşteri, kargo, Excel içe aktarma, raporlama, kullanıcı ve rol yönetimi, işlem geçmişi, sistem ayarları.

Roller: Super Admin, Admin, Product Manager, Stock Manager, Order Manager, Customer Service, Customer, Guest.

Yetkilendirme yalnızca arayüzde değil, **sunucu ve veritabanı seviyesinde de** uygulanır.

### Güvenlik
- Güvenli kimlik doğrulama, rol tabanlı yetkilendirme, Supabase Row Level Security (RLS)
- Sunucu tarafında veri doğrulama, güvenli dosya yükleme
- SQL injection ve XSS önlemleri, hassas bilgilerin korunması
- İşlem kayıtları (audit log)
- Stok ve sipariş işlemlerinde atomik veritabanı işlemleri

### Tasarım
Modern ve profesyonel; bebek/çocuk giyim sektörüne uygun görsel dil; kullanıcı dostu; mobil öncelikli; hızlı yükleme; erişilebilirlik standartlarına uygun; sade yönetim paneli.

### Hukuk
KVKK, gizlilik, mesafeli satış sözleşmesi, ön bilgilendirme formu, iade ve iptal politikası, çerez yönetimi, ticari elektronik ileti izinleri, ETBİS ve ilgili yükümlülükler.

Altyapı bunları destekler; ancak hiçbir çıktı hukuki danışmanlık yerine geçmez. Hukuki metinler ve mevzuata bağlı kurallar yayından önce uzman kontrolüne sunulur. Mevzuata bağlı süre ve oranlar koda sabit yazılmaz, ayarlanabilir tutulur.

## Kararlar

### Kesinleşen
- İlk sürümde fiziksel mağaza stok entegrasyonu yok.
- Kart bilgisi saklanmaz.
- Her sipariş, hazırlanmadan önce yönetici onayından geçer. Panelde toplu inceleme ekranı bulunur; sistem kendiliğinden onay vermez.
- Web sitesine **ayrı stok** ayrılır.
- Ölçek: ayda yaklaşık 1.000 sipariş.
- Bütçe: temel altyapı yaklaşık 45–46 USD/ay; SMS, komisyon, vergi ve aşım hariç.
- Alan adı `alisbebe.com` (satın almayı proje sahibi yapar).
- GitHub deposu `kozankurtcakir/alis-bebe`; proje sahibinin kararıyla şimdilik herkese açık. Gizli bilgi ve gerçek veri commit edilmez.
- Sayfa taslakları taslak olarak onaylandı (24.11.2026); ileride geliştirilecek.
- Personel önce normal üye olur, sonra rol alır; davet sistemi yok. Rollerin izinleri ilk sürümde sabittir, migration ve testle değişir.
- İlk Super Admin komutla oluşturulur. İki adımlı doğrulamayı yalnızca Super Admin sıfırlar; yayında en az iki Super Admin bulunur.
- Ürün kapsamı: çocuk ve bebek giyim, yetişkin giyim (tişört, eşofman, şort, hırka), kadın takım ve kişisel bakım. Kişisel bakım, mevzuat netleşene kadar yayınlanamaz.
- SKU'yu sistem önerir, personel değiştirebilir. KDV oranı ürün başına elle girilir; hazır oran yoktur. Özgün fotoğraf saklanmaz.
- Stok: varsayılan kritik seviye 3; uyarı şimdilik panelde; ikinci kişi onayı yok; barkod okuyucu kullanılmayacak. Stok ayırma Aşama 8'de siparişle kurulur.
- Excel: tek hatalı satır bütün dosyayı durdurur; boş hücre değiştirmez; silme, yayınlama ve maliyet yüklenmez; dosya saklanmaz. Fiyatı %10 veya daha fazla değişen satır ayrıca onay ister. Uygulamayı yalnızca dosyayı yükleyen yapar.
- Mağaza: ziyaretçi tabloları okuyamaz, yalnızca `shop_*` fonksiyonlarını çağırır; SKU, barkod ve kesin stok verilmez. Fiyat ve stok önbelleğe alınmaz. Tükenen ürün listenin sonundadır.
- Sabit yayın tarihi yok; aşama bazlı ilerlenir.
- Geliştirme bilgisayarı: Windows 11, 16 GB RAM. Docker zorlanırsa ücretsiz bulut geliştirme projesine geçilir.
- Görsel yön: Odunpazarı evleri. Petrol `#17454F`, hardal `#F4B942` (üzerinde petrol yazı), nar `#B93A4B`, nane `#CFE8E1`, zemin `#F4F9F8`. Yazı tipi: Baloo 2 ve Figtree.

### Onay veya bilgi bekleyen
- Ödeme sağlayıcısı ve kargo firması
- Fatura (e-Arşiv), e-posta ve SMS çözümleri
- `docs/asamalar.md` içindeki açık iş soruları
- KVKK kapsamında yurt dışında veri barındırma konusunun uzmana danışılması
