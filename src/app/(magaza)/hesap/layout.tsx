import Link from "next/link";

export const instant = false;

const links = [
  { href: "/hesap", label: "Bilgilerim" },
  { href: "/hesap/siparisler", label: "Siparişlerim" },
  { href: "/hesap/adresler", label: "Adreslerim" },
  { href: "/hesap/favoriler", label: "Favorilerim" },
  { href: "/hesap/izinler", label: "İleti izinleri" },
];

/** Giriş kontrolü her sayfanın kendisindedir; düzen her gezinmede yeniden çalışmaz. */
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <nav aria-label="Hesabım">
        <ul className="flex flex-wrap gap-x-6">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="inline-flex min-h-11 items-center underline"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
