const houses = [
  { wall: "#F4B942", roof: "#B93A4B" },
  { wall: "#CFE8E1", roof: "#17454F" },
  { wall: "#B93A4B", roof: "#17454F" },
  { wall: "#17454F", roof: "#B93A4B" },
  { wall: "#F4B942", roof: "#17454F" },
];

/** Odunpazarı evlerinden esinlenen süs çizimi. */
function Houses() {
  return (
    <svg
      viewBox="0 0 500 150"
      aria-hidden="true"
      className="w-full max-w-2xl self-center"
    >
      {houses.map(({ wall, roof }, i) => (
        <g key={i} transform={`translate(${i * 100} 0)`}>
          <rect x="8" y="55" width="84" height="95" fill={wall} />
          <path d="M0 57 50 20l50 37Z" fill={roof} />
          <rect x="20" y="70" width="22" height="26" rx="3" fill="#F4F9F8" />
          <rect x="58" y="70" width="22" height="26" rx="3" fill="#F4F9F8" />
          <path d="M39 150v-28a11 11 0 0 1 22 0v28Z" fill={roof} />
        </g>
      ))}
    </svg>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col justify-between gap-16 px-5 pt-20 sm:pt-28">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-baslik text-2xl font-bold">Aliş Bebe</p>
        <h1 className="mt-6 font-baslik text-4xl leading-tight font-bold text-balance sm:text-6xl">
          Minik gardıroplar hazırlanıyor
        </h1>
        <p className="mx-auto mt-5 max-w-md text-lg text-gri">
          Eskişehir&apos;deki mağazamızın bebek ve çocuk giyim ürünleri yakında
          Türkiye&apos;nin her yerinde.
        </p>
      </div>
      <Houses />
    </main>
  );
}
