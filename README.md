# Aliş Bebe

Bebek ve çocuk giyim e-ticaret platformu. Kurallar: [CLAUDE.md](CLAUDE.md), aşamalar: [docs/asamalar.md](docs/asamalar.md).

## Çalıştırma

Node.js 24 gerekir.

```bash
npm ci                            # paketleri kur
npx playwright install chromium   # test tarayıcısı (bir kez)
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

Gizli anahtarlar `.env.local` dosyasında durur ve Git'e eklenmez. Örnek: `.env.example`.
