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
| `preparing` | `shipped`, `cancelled` |
| `shipped` | `delivered`, `returned_to_sender` |
| `delivered`, `cancelled`, `returned_to_sender` | son durum |

Kart ve EFT `pending_payment` ile, kapıda ödeme telefon doğrulandıktan sonra `awaiting_approval` ile başlar. `awaiting_approval` durumuna kart/EFT ödemesi doğrulanmadan geçilemez.

**Ödeme:** `pending`, `paid`, `failed`, `cod_due`, `cod_collected`, `partially_refunded`, `refunded`

**Kargo:** `none`, `created`, `handed_over`, `in_transit`, `delivered`, `failed`, `returned`

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
- Bildirim gelmezse durum sağlayıcıdan sorgulanır.
- Rezervasyon bittikten sonra ödeme gelirse stok yeniden ayrılır; yoksa iade başlatılır ve uyarı verilir.
- Dekont kanıt değildir; paranın hesapta görülmesi gerekir. Eksik/fazla EFT incelemeye düşer.
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

`ShippingProvider` işlemleri: oluştur, etiket al, iptal et, durum sorgula, iade kodu üret, bildirim doğrula. İlk uygulama "Manuel". Arıza halinde artan aralıkla denenir, sonra manuel girişe düşülür.

## 7. Toplu inceleme ekranı

Sorunsuz siparişler birlikte seçilip onaylanabilir. Şunlar toplu onaya **girmez**: tutar uyuşmazlığı, doğrulanmamış telefon, limit üstü kapıda ödeme, stok uyarısı. Her sipariş için ayrı onay kaydı yazılır.
