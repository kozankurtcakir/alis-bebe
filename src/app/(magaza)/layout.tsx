import Form from "next/form";
import Link from "next/link";
import { getCategories } from "@/modules/shop/queries";

// Sayfa bütünüyle hazır olunca gösterilir; içerik sonradan gelip sayfayı kaydırmaz.
export const instant = false;

export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = await getCategories();

  return (
    <>
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:m-3 focus:rounded-xl focus:bg-white focus:p-3"
      >
        İçeriğe geç
      </a>
      <header className="bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 pb-1">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-baslik text-2xl font-bold"
          >
            Aliş Bebe
          </Link>
          <Form
            action="/ara"
            role="search"
            className="order-last flex w-full min-w-0 gap-2 sm:order-none sm:w-auto sm:flex-1"
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ürün ara</span>
              <input
                type="search"
                name="q"
                placeholder="Ürün ara"
                maxLength={100}
                autoComplete="off"
                className="block min-h-11 w-full rounded-full border border-gri bg-white px-4 placeholder:text-gri"
              />
            </label>
            <button className="min-h-11 rounded-full bg-petrol px-5 font-semibold text-white hover:bg-petrol/90">
              Ara
            </button>
          </Form>
          <Link
            href="/hesap"
            className="ml-auto inline-flex min-h-11 items-center underline-offset-4 hover:underline"
          >
            Hesabım
          </Link>
        </div>
        <nav aria-label="Kategoriler" className="mx-auto max-w-6xl px-4 pb-2">
          <ul className="flex flex-wrap gap-x-6">
            {categories
              .filter((c) => c.parent_slug === null)
              .map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/kategori/${c.slug}`}
                    className="inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            <li>
              <Link
                href="/ara"
                className="inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline"
              >
                Tüm ürünler
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <main id="icerik" tabIndex={-1} className="min-h-[70vh] flex-1">
        {children}
      </main>
      <footer className="mt-16 bg-petrol text-white">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <p className="font-baslik text-xl font-bold">Aliş Bebe</p>
          <p>Eskişehir&apos;den Türkiye&apos;ye bebek, çocuk ve aile giyimi.</p>
        </div>
      </footer>
    </>
  );
}
