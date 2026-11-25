# Yetki ve iş akışı kuralları

## 1. Yetkiler

`Kullanıcı → user_roles → roles → role_permissions → permissions`

Kod rol adını değil izni sorar: "`orders.approve` izni var mı?" Kontrol üç katmanda yapılır: arayüz (kolaylık), sunucu, veritabanı.

SA: Super Admin, A: Admin, PM: Product Manager, SM: Stock Manager, OM: Order Manager, CS: Customer Service.

| İzin | SA | A | PM | SM | OM | CS |
|---|---|---|---|---|---|---|
| `dashboard.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `catalog.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `catalog.write` | ✓ | ✓ | ✓ | | | |
| `prices.write` | ✓ | ✓ | ✓ | | | |
| `costs.read` | ✓ | ✓ | | | | |
| `costs.write` | ✓ | ✓ | | | | |
| `stock.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `stock.adjust` | ✓ | ✓ | | ✓ | | |
| `import.products` | ✓ | ✓ | ✓ | | | |
| `import.stock` | ✓ | ✓ | | ✓ | | |
| `orders.read` | ✓ | ✓ | | | ✓ | ✓ |
| `orders.note` | ✓ | ✓ | | | ✓ | ✓ |
| `orders.approve` | ✓ | ✓ | | | ✓ | |
| `orders.cancel` | ✓ | ✓ | | | ✓ | |
| `transfers.match` | ✓ | ✓ | | | ✓ | |
| `transfers.confirm` | ✓ | ✓ | | | | |
| `refunds.request` | ✓ | ✓ | | | ✓ | |
| `refunds.approve` | ✓ | ✓ | | | | |
| `returns.open` | ✓ | ✓ | | | ✓ | ✓ |
| `returns.receive` | ✓ | ✓ | | ✓ | ✓ | |
| `returns.decide` | ✓ | ✓ | | | ✓ | |
| `shipping.read` | ✓ | ✓ | | | ✓ | ✓ |
| `shipping.write` | ✓ | ✓ | | | ✓ | |
| `cod.reconcile` | ✓ | ✓ | | | | |
| `customers.read` | ✓ | ✓ | | | ✓ | ✓ |
| `customers.export` | ✓ | ✓ | | | | |
| `reports.products` | ✓ | ✓ | ✓ | | | |
| `reports.stock` | ✓ | ✓ | | ✓ | | |
| `reports.orders` | ✓ | ✓ | | | ✓ | |
| `staff.manage` | ✓ | ✓ | | | | |
| `roles.manage` | ✓ | | | | | |
| `settings.basic` | ✓ | ✓ | | | | |
| `settings.critical` | ✓ | | | | | |
| `audit.read` | ✓ | ✓ | | | | |

Ek kurallar:
- OM ve CS müşteri verisini yalnızca sipariş bağlamında görür; toplu indiremez.
- Admin, Super Admin veya Admin atayamaz ve bu hesapları değiştiremez.
- Kimse kendi rolünü değiştiremez. Son Super Admin kaldırılamaz veya pasifleştirilemez.
- Personel izinleri yalnızca iki adımlı doğrulamalı oturumda (`aal2`) geçerlidir.
- Customer yalnızca kendi verisini görür. Guest, siparişine gizli kodla erişir.

## 2. Durumlar

**Sipariş**

| Durum | Geçebileceği |
|---|---|
| `pending_payment` | `awaiting_approval`, `cancelled` |
| `awaiting_approval` | `approved`, `cancelled` |
| `approved` | `preparing`, `cancelled` |
| `preparing` | kargoda `shipped`, mağazadan teslimde `ready_for_pickup`; `cancelled` |
| `ready_for_pickup` | `delivered` (ödeme alınmışsa), `cancelled` |
| `shipped` | `delivered`, `returned_to_sender` |
| `delivered`, `cancelled`, `returned_to_sender` | son durum |

Kart ve EFT `pending_payment` ile, kapıda ödeme ve mağazada ödeme `awaiting_approval` ile başlar. `awaiting_approval` durumuna kart/EFT ödemesi doğrulanmadan geçilemez. Ayar açıksa kapıda ödeme, telefon doğrulanmadan onaylanamaz.

Tek istisna: süresi dolduğu için iptal olan (`cancel_code = expired`) siparişin tam parası sonradan onaylanır ve stok yeterse sipariş `awaiting_approval` durumuna döner; stok yoksa veya tutar eksikse `refund_pending` olur.

**Ödeme:** `pending`, `failed` (kart reddedildi; yeniden denenebilir), `review`, `paid`, `cancelled`, `cod_due`, `cod_collected`, `refund_pending`, `partially_refunded`, `refunded`

**Kargo (siparişte):** `none`, `created`, `handed_over`, `in_transit`, `delivered`, `failed`, `returned`. `in_transit` ve `failed` firma bağlantısıyla kullanılacak.

**Gönderi:** `created` → `handed_over` veya `cancelled`; `handed_over` → `delivered` veya `returned`. Son üçü değişmez. Kargolu sipariş `shipped`, `delivered` ve `returned_to_sender` durumlarına yalnızca gönderisiyle birlikte geçer.

## 3. Stok

| Olay | `on_hand` | `reserved` |
|---|---|---|
| Sepete ekleme | – | – |
| Sipariş oluşturma | – | + adet |
| Yönetici onayı | − adet | − adet |
| Onay öncesi iptal / süre bitimi | – | − adet |
| Onay sonrası, kargo öncesi iptal | + adet | – |
| İade kontrolü: `sellable` | + adet | – |
| İade kontrolü: `damaged`, `disputed` | – | – |

Satırlar her zaman `variant_id` sırasıyla kilitlenir. Rezervasyon süresi (ayarlanabilir): kart 30 dk, EFT 2 iş günü, kapıda ödeme karar verilene kadar.

## 4. Ödeme

- Tutarı sunucu hesaplar. Tarayıcının "başarılı" sayfasına dönmesi ödeme kanıtı değildir.
- Bildirim imzası, tutar ve para birimi doğrulanır; aynı olay bir kez işlenir.
- Bildirim gelmezse durum sağlayıcıdan sorgulanır: müşteri dönünce, personel isteyince ve sipariş işlemlerinin ardından.
- Kart bilgisi yalnızca sağlayıcının sayfasına girilir. İmzasız bildirim veritabanına ulaşmaz ve saklanmaz.
- Açık kart denemesi varken yenisi açılmaz; sipariş başına en fazla 10 deneme.
- Tutarı veya para birimi farklı kart ödemesi `review` olur; süre bitiminde iptal edilmez, personel karar verir.
- Aynı siparişe ikinci kez gelen para kendiliğinden iade edilmez; panelde uyarı çıkar (`refund_due`), iade Aşama 11'de.
- Rezervasyon bittikten sonra ödeme gelirse stok yeniden ayrılır; yoksa iade başlatılır ve uyarı verilir.
- Dekont kanıt değildir; paranın hesapta görülmesi gerekir. Eksik/fazla EFT incelemeye düşer.
- EFT'de bir kişi eşleştirip onaylayabilir; iki ayrı kişi şartı ayarla açılır. Yalnızca onaylanan havaleler toplanır.
- Parası bankada görülen sipariş süre bitiminde iptal olmaz. Ödenmiş veya parası görülmüş sipariş iptal edilirse `refund_pending` olur; iadenin kendisi Aşama 11'dedir.
- Aynı telefon, e-posta veya üyelikle en fazla 3 ödenmemiş sipariş (ayarlanabilir).
- Mağazada tahsilat `ready_for_pickup` durumunda yazılır; yazılmadan teslim edilmez. `pickup_days` dolunca panelde uyarı çıkar, sistem kendiliğinden iptal etmez.
- Kapıda teslim, tahsilat sayılmaz; firma ödemesi `cod_settlements` ile eşleştirilir.

## 5. İptal ve iade

| Zaman | Süreç |
|---|---|
| Ödeme öncesi | Hemen iptal |
| Onay bekliyor | İptal, varsa tam iade |
| Onaylandı / hazırlanıyor | Talep, personel kararı, ters stok kaydı, iade |
| Kargoda | Geri dönüş; ürün gelmeden stoğa eklenmez |
| Teslim edildi | Talep, iade kodu, teslim alma, kontrol, sonuç |

Para iadesi önce `pending` yazılır, sonra sağlayıcıya gönderilir. Cevap gelmezse yeniden göndermeden önce **durum sorgulanır**. Cayma süresi ve iade kargo ücreti hukukçuyla kesinleşir; ayarlanabilir tutulur.

## 6. Kargo

- İlk sürümde yalnızca "Manuel" sağlayıcı var: gönderi firmada elle açılır, takip numarası panele yazılır. Firma seçilince `ShippingProvider` arayüzüne etiket, iptal, durum sorgusu, iade kodu ve bildirim doğrulama eklenir; arıza halinde artan aralıkla denenir, sonra manuel girişe düşülür.
- Sipariş başına iptal edilmemiş tek gönderi olur; yinelenen istek aynı gönderiyi döndürür. Bölünmüş gönderi ilk sürümde yok.
- "Kargoya verildi" için firma ve takip numarası zorunludur. Numara kargodayken düzeltilebilir; eski ve yeni değer geçmişte kalır. Aynı firmada aynı numara iptal edilmemiş iki gönderide kullanılamaz.
- Sipariş iptal edilirse yola çıkmamış gönderi de iptal olur; yola çıkan sipariş iptal edilemez.
- Geri dönen ürün kendiliğinden stoğa girmez; kontrolü Aşama 11'dedir. Kapıda ödemede dönen siparişten para beklenmez; önceden ödenmişse para kaydı durur.
- Kapıda ödemede teslimle birlikte firmadan beklenen tutar yazılır. Gelen parayı yalnızca `cod.reconcile` izni olan yazar; kayıt silinmez, eksi tutarla düzeltilir. Eksik veya fazla para panelde uyarıda kalır.
- Firmaları `settings.basic` izni olan ekler ve kapatır; firma silinmez. Takip adresi `https://` ile başlar ve `{no}` içerir.
- Müşteri, paket yola çıkınca firma, takip numarası ve bağlantıyı görür; "Kargoya verildi" e-postasında da yazar.

## 7. Toplu inceleme ekranı

Sorunsuz siparişler birlikte seçilip onaylanabilir. Şunlar toplu onaya **girmez**: tutar uyuşmazlığı, iade edilecek para, doğrulanmamış telefon, limit üstü kapıda ödeme, stok uyarısı. Her sipariş için ayrı onay kaydı yazılır.
