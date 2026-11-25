import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/modules/shop/breadcrumb";
import { ProductView } from "@/modules/shop/product-view";
import { getProduct } from "@/modules/shop/queries";

export const instant = false;

export async function generateMetadata({
  params,
}: PageProps<"/urun/[slug]">): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  if (!product) return { title: "Ürün bulunamadı" };
  return {
    title: product.name,
    description: product.description.replace(/\s+/g, " ").slice(0, 160),
  };
}

export default async function ProductPage({
  params,
}: PageProps<"/urun/[slug]">) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <Breadcrumb items={product.categories} />
      <ProductView
        product={{
          name: product.name,
          brand: product.brand,
          images: product.images,
          variants: product.variants,
        }}
      >
        <Section title="Açıklama">
          <p className="break-words whitespace-pre-line">
            {product.description}
          </p>
        </Section>
        <Section title="Malzeme">
          <p className="break-words whitespace-pre-line">{product.material}</p>
        </Section>
        {product.care && (
          <Section title="Bakım">
            <p className="break-words whitespace-pre-line">{product.care}</p>
          </Section>
        )}
        {product.size_charts.map((chart) => (
          <details key={chart.name}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold underline">
              Beden tablosu: {chart.name}
            </summary>
            <SizeChart name={chart.name} rows={chart.rows} />
          </details>
        ))}
      </ProductView>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-baslik text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** İlk satır başlıktır; her satırın ilk hücresi bedeni yazar. */
function SizeChart({ name, rows }: { name: string; rows: string[][] }) {
  const [head = [], ...body] = rows;
  return (
    <div
      role="region"
      aria-label={`${name} tablosu`}
      tabIndex={0}
      className="overflow-x-auto rounded-xl bg-white"
    >
      <table className="w-full text-left">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i} scope="col" className="px-3 py-2">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i} className="border-t border-gri/30">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-3 py-2">
                    {cell}
                  </th>
                ) : (
                  <td key={j} className="px-3 py-2">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
