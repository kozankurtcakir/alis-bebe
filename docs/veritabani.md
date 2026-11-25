# Veritabanı şeması

Durum: taslak onaylandı. Aşama 2'de yalnızca o aşamanın tabloları kurulur; kalanlar kendi aşamasında eklenir.

## Genel kurallar

- Birincil anahtar `id uuid` (aksi yazmıyorsa). Zaman alanları `timestamptz`, UTC.
- Para `bigint`, kuruş. 249,90 TL = `24990`. KDV oranı baz puan: %10 = `1000`.
- `created_at`, `updated_at` her iş tablosunda vardır; aşağıda tekrar yazılmadı.
- Siparişte kullanılmış kayıt silinmez, `archived_at` ile arşivlenir.
- FK silme davranışı varsayılan olarak `RESTRICT`.
- Bütün FK sütunlarına indeks konur.
- `?` işareti alanın boş olabileceğini gösterir.

## Kullanıcı ve yetki (Aşama 2)

| Tablo | Alanlar | Kural |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `full_name`, `phone?`, `is_active` | Kullanıcı yalnızca kendi ad/telefonunu değiştirir |
| `roles` | `key`, `name` | Sabit 7 rol; Guest rol değildir |
| `permissions` | `key`, `description` | Örnek: `orders.approve` |
| `role_permissions` | `role_id`, `permission_id` | PK: ikisi birlikte |
| `user_roles` | `user_id`, `role_id`, `granted_by`, `granted_at` | PK: kullanıcı+rol; yalnızca fonksiyonla yazılır |
| `audit_logs` | `actor_id?`, `action`, `entity`, `entity_id`, `before?`, `after?`, `ip?` | Yalnızca ekleme; gizli veri yazılmaz |
| `addresses` | `user_id`, `title`, `recipient`, `phone`, `city`, `district`, `line`, `postal_code?`, `is_default` | Aşama 7; kullanıcı başına tek varsayılan, en fazla 10; il 81 ilden biri |

## Katalog (Aşama 3)

| Tablo | Alanlar | Kural |
|---|---|---|
| `categories` | `parent_id?`, `name`, `slug`, `sort_order`, `is_active` | `slug` benzersiz; döngü engellenir |
| `brands` | `name`, `slug` | Benzersiz |
| `colors` | `name`, `hex`, `slug`, `code` | Benzersiz; `code` SKU önerisinde kullanılır |
| `sizes` | `size_group`, `name`, `code`, `age_min_months?`, `age_max_months?`, `sort_order` | Grup: `baby`, `child`, `adult`, `volume`, `one_size` |
| `products` | `product_no`, `name`, `slug`, `description`, `product_type`, `audience`, `brand_id?`, `material`, `care?`, `gender`, `vat_bps`, `status`, `published_at?`, `archived_at?` | `status`: `draft`, `published`, `archived`; yalnızca `set_product_status` ile değişir. `product_type`: `clothing`, `personal_care` (yayınlanamaz) |
| `product_categories` | `product_id`, `category_id`, `is_primary` | Ürün başına tek ana kategori |
| `product_variants` | `product_id`, `color_id?`, `size_id?`, `sku`, `barcode?`, `price`, `compare_at_price?`, `desi?`, `is_active` | `(product, color, size)` ve `sku` benzersiz; barkod doluysa benzersiz ve metin |
| `variant_costs` | `variant_id`, `cost` | Yalnızca `costs.read` izni |
| `price_history` | `variant_id`, `old_price`, `new_price`, `changed_by`, `changed_at` | Tetikleyici yazar; yalnızca ekleme |
| `product_images` | `product_id`, `color_id?`, `path`, `width`, `height`, `alt`, `sort_order` | Alternatif metin zorunlu |
| `size_charts` | `name`, `category_id?`, `rows jsonb` | Boy/kilo tablosu |

Yayın şartı: açıklama, malzeme, ana kategori, aktif varyant (giyimde renk ve bedenli) ve görsel. Şart, yayındayken de işlem sonunda denetlenir. Ürün ve varyant silinmez. Katalog değişiklikleri `audit_logs`'a yazılır.

Mağaza (Aşama 6): `anon` hiçbir tabloyu okuyamaz. `shop_categories`, `shop_products`, `shop_facets` ve `shop_product` yalnızca yayındaki ürünün seçilmiş alanlarını verir; stok `in`, `low`, `out` olarak görünür. Kategori, kendisi ve bütün üstleri aktifse görünür. Arama `private.fold_tr` ile büyük/küçük harf, İ/I/ı/i ve aksan farkını kaldırır; panel araması da bunu kullanır. `published_at` ilk yayında yazılır.

## Stok (Aşama 4)

| Tablo | Alanlar | Kural |
|---|---|---|
| `inventory` | `variant_id` (PK), `on_hand`, `reserved`, `critical_level` | `CHECK (0 <= reserved AND reserved <= on_hand)` |
| `stock_movements` | `seq`, `variant_id`, `delta`, `on_hand_after`, `reason`, `note?`, `actor_id?`, `idempotency_key`, `reverses_id?` | Yalnızca ekleme; `idempotency_key` ve `reverses_id` benzersiz. `order_id?` Aşama 8'de eklenir |
| `stock_reservations` (Aşama 8) | `order_item_id`, `variant_id`, `quantity`, `expires_at?`, `status` | `status`: `active`, `consumed`, `released` |

Hareket nedenleri: `initial`, `purchase`, `adjustment`, `sale`, `cancel`, `return`, `damage`, `import`, `reversal`. Sayım `adjustment` olarak yazılır.

Stok yalnızca `adjust_stock`, `reverse_stock_movement` ve `private.apply_stock` üzerinden değişir; önce `private.lock_inventory` satırı kilitler. Kritik seviye varsayılanı 3'tür.

Değişmez eşitlikler:
- `on_hand` = o varyantın `stock_movements.delta` toplamı
- `reserved` = o varyantın `active` rezervasyon toplamı
- Satılabilir = `on_hand - reserved`. Müşteriye kesin sayı değil "var / az kaldı / yok" gösterilir.

## Excel (Aşama 5)

| Tablo | Alanlar | Kural |
|---|---|---|
| `import_jobs` | `kind`, `stock_mode?`, `file_name`, `file_hash`, `status`, `created_by`, `total`, `invalid`, `applied_at?` | Durum: `invalid`, `validated`, `applied`. Dosya saklanmaz; `stock_mode`: `purchase`, `adjustment` |
| `import_rows` | `job_id`, `row_no`, `raw jsonb`, `parsed jsonb`, `before jsonb`, `summary jsonb`, `errors jsonb`, `action`, `big_price_change` | Yalnızca ekleme. `action`: `create`, `update`, `skip`, `error`; `big_price_change` fiyatı %10 veya daha fazla değişen satır |

## Alışveriş (Aşama 7)

| Tablo | Alanlar | Kural |
|---|---|---|
| `carts` | `user_id?`, `token_hash?`, `expires_at?` | İlk ikisinden yalnızca biri dolu. Misafir: kodun SHA-256 özeti ve 30 gün; üye: süresiz |
| `cart_items` | `cart_id`, `variant_id`, `quantity` | Adet 1–10; varyant tekrarı yok; en fazla 50 çeşit; fiyat saklanmaz |
| `favorites` | `user_id`, `product_id` | PK: ikisi birlikte; en fazla 200 |

`carts`, `cart_items` ve `favorites` doğrudan okunamaz ve yazılamaz. Ziyaretçi `cart_count`, `cart_get`, `cart_add`, `cart_set` çağırır; üye ayrıca `cart_merge`, `set_favorite`, `is_favorite`, `list_favorites`, `save_address`, `delete_address`, `set_consent`. Üyenin kimliği yalnızca oturumdan alınır. `addresses` ve `consents` için yalnızca kendi satırını okuma izni vardır.

## Sipariş (Aşama 8)

| Tablo | Alanlar | Kural |
|---|---|---|
| `orders` | `order_no`, `user_id?`, `email`, `phone`, `payment_method`, `order_status`, `payment_status`, `shipment_status`, `subtotal`, `shipping_fee`, `cod_fee`, `discount`, `total`, `approved_by?`, `approved_at?`, `idempotency_key` | `total` = ara toplam + ücretler − indirim; `order_no` tahmin edilemez |
| `order_items` | `order_id`, `variant_id`, `name`, `sku`, `color`, `size`, `unit_price`, `vat_bps`, `quantity`, `cancelled_qty`, `returned_qty` | İptal + iade ≤ adet |
| `order_addresses` | `order_id`, `kind`, adres alanları, `company?`, `tax_office?`, `tax_no?` | Teslimat/fatura kopyası |
| `order_status_history` | `order_id`, `field`, `from`, `to`, `actor_id?`, `note?` | Yalnızca ekleme |
| `order_access_tokens` | `order_id`, `token_hash`, `expires_at` | Düz kod saklanmaz |
| `invoices` | `order_id`, `invoice_no`, `issued_at`, `file_path` | Özel depolama |

## Ödeme (Aşama 8–9)

| Tablo | Alanlar | Kural |
|---|---|---|
| `payments` | `order_id`, `provider`, `provider_ref?`, `amount`, `status`, `idempotency_key` | Kart numarası/CVV alanı yoktur |
| `payment_events` | `provider`, `event_id`, `payment_id?`, `payload jsonb`, `processed_at?` | `(provider, event_id)` benzersiz; hassas alanlar temizlenir |
| `bank_transfers` | `payment_id`, `receipt_path?`, `matched_by?`, `confirmed_by?`, `confirmed_at?` | Eşleştiren ile onaylayan farklı olur (ayarla değiştirilebilir) |
| `refunds` | `payment_id`, `return_request_id?`, `amount`, `status`, `requested_by`, `approved_by?`, `provider_ref?` | Toplam ≤ ödenen |
| `cod_settlements` | `shipment_id`, `expected`, `received?`, `received_at?`, `status` | Aşama 10 |

## Kargo (Aşama 10)

| Tablo | Alanlar | Kural |
|---|---|---|
| `shipments` | `order_id`, `provider`, `our_ref`, `provider_ref?`, `tracking_no?`, `label_path?`, `status` | `our_ref` benzersiz: çift gönderi engeli |
| `shipment_items` | `shipment_id`, `order_item_id`, `quantity` | Toplam ≤ sipariş adedi |
| `shipment_events` | `shipment_id`, `status`, `raw_code`, `raw jsonb`, `occurred_at` | Yalnızca ekleme |

## İptal ve iade (Aşama 11)

| Tablo | Alanlar | Kural |
|---|---|---|
| `cancellation_requests` | `order_id`, `reason`, `status`, `decided_by?` | Sipariş başına tek açık talep |
| `return_requests` | `order_id`, `reason`, `status`, `return_code?`, `received_at?` | |
| `return_items` | `return_request_id`, `order_item_id`, `quantity`, `inspection?` | `inspection`: `sellable`, `damaged`, `disputed` |

## Hukuk ve sistem

| Tablo | Alanlar | Aşama |
|---|---|---|
| `legal_documents` | `kind`, `version`, `body`, `published_at` | 8 |
| `order_legal_acceptances` | `order_id`, `document_id`, `rendered_body`, `accepted_at`, `ip` | 8 |
| `consents` | `seq`, `user_id`, `kind`, `granted`, `source`, `at` | 7; yalnızca ekleme, son kayıt geçerli |
| `outbox_jobs` | `kind`, `payload`, `status`, `attempts`, `run_after`, `dedupe_key` | 8 |
| `notifications` | `user_id?`, `kind`, `data`, `read_at?` | 8 |
| `settings` | `key`, `value jsonb`, `is_sensitive` | 12 (ihtiyaç olan anahtar daha önce eklenebilir) |

## Dosya depolama

| Bucket | Erişim | İçerik |
|---|---|---|
| `product-images` | Herkes okur | Depoda yalnızca WebP (en fazla 4 MB); JPEG, PNG ve WebP kabul edilip WebP olarak yeniden üretilir; SVG yasak |
| `documents` | Özel | Dekont, fatura, etiket; süreli bağlantı |
