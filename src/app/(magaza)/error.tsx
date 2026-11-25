"use client";

export default function ShopError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-16">
      <h1 className="font-baslik text-3xl font-bold">Sayfa açılamadı</h1>
      <p>Geçici bir sorun oluştu. Biraz sonra yeniden deneyin.</p>
      <button
        type="button"
        onClick={retry}
        className="min-h-11 rounded-full bg-hardal px-6 font-semibold hover:bg-hardal/80"
      >
        Yeniden dene
      </button>
    </div>
  );
}
