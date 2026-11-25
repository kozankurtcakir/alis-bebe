import Link from "next/link";

export function Breadcrumb({
  items,
}: {
  items: { name: string; slug: string }[];
}) {
  return (
    <nav aria-label="Sayfa yolu">
      <ol className="flex flex-wrap items-center gap-x-2 text-gri">
        <li>
          <Link href="/" className={linkClass}>
            Ana sayfa
          </Link>
        </li>
        {items.map((c) => (
          <li key={c.slug} className="flex items-center gap-x-2">
            <span aria-hidden>/</span>
            <Link href={`/kategori/${c.slug}`} className={linkClass}>
              {c.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const linkClass = "inline-flex min-h-11 items-center underline";
