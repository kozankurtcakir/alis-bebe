import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-16">
      <p className="font-semibold text-gri">404</p>
      <h1 className="font-baslik text-3xl font-bold">Sayfa bulunamadı</h1>
      <p>Aradığınız sayfa kaldırılmış veya adresi değişmiş olabilir.</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-semibold underline"
      >
        Ana sayfaya dön
      </Link>
    </div>
  );
}
