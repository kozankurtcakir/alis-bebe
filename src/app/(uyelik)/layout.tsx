import Link from "next/link";
import { Suspense } from "react";

export default function MembershipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <Link href="/" className="font-baslik text-2xl font-bold">
        Aliş Bebe
      </Link>
      <div className="mt-8 space-y-6">
        <Suspense fallback={<p role="status">Yükleniyor…</p>}>
          {children}
        </Suspense>
      </div>
    </main>
  );
}
