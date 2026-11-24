# Aliş Bebe

Bebek ve çocuk giyim e-ticaret platformu. Kurallar: [CLAUDE.md](CLAUDE.md), aşamalar: [docs/asamalar.md](docs/asamalar.md).

## Çalıştırma

Node.js 24 gerekir.

```bash
npm ci                            # paketleri kur
npx playwright install chromium   # test tarayıcısı (bir kez)
npm run db:start                  # yerel Supabase (Docker açık olmalı)
npm run db:env                    # .env.local dosyasını oluşturur (bir kez)
npm run dev                       # http://localhost:3000
```

## Komutlar

| Komut | Görev |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm test` | Birim testleri |
| `npm run test:e2e` | Tarayıcı testleri (önce `npm run build`) |
| `npm run check` | Bütün kontroller |
| `npm run format` | Kod biçimlendirme |
| `npm run db:start` / `npm run db:stop` | Yerel Supabase'i açar / kapatır (Docker açık olmalı) |
| `npm run db:test` | Veritabanı ve yetki testleri |
| `npm run db:reset` | Yerel veritabanını sıfırlar (**yerel veriyi siler**) |

Gizli anahtarlar `.env.local` dosyasında durur ve Git'e eklenmez. Örnek: `.env.example`.
