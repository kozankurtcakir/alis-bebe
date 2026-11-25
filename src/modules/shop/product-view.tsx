"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { Price } from "./card";
import { pickVariant, uniqueBy } from "./selection";
import type { ShopProduct } from "./queries";

const stockLabels = { in: "Stokta", low: "Az kaldı", out: "Tükendi" } as const;

/** Görseller ile renk ve beden seçimi. Renk seçilince görseller de değişir. */
export function ProductView({
  product,
  children,
}: {
  product: Pick<ShopProduct, "name" | "brand" | "images" | "variants">;
  /** Seçimin altındaki sabit bilgiler. */
  children: React.ReactNode;
}) {
  const id = useId();
  const { variants } = product;
  const colors = uniqueBy(
    variants.flatMap((v) => (v.color ? [v.color] : [])),
    (c) => c.slug,
  );
  const [color, setColor] = useState(
    () =>
      (variants.find((v) => v.stock !== "out" && v.color) ?? variants[0])?.color
        ?.slug ?? null,
  );
  const [size, setSize] = useState<string | null>(null);

  const ofColor = variants.filter((v) => (v.color?.slug ?? null) === color);
  const sizes = ofColor.filter((v) => v.size !== null);
  const variant = pickVariant(ofColor, size);
  const cheapest = ofColor.reduce((a, b) => (b.price < a.price ? b : a));
  const shown = variant ?? cheapest;
  const stock =
    variant?.stock ??
    (ofColor.every((v) => v.stock === "out") ? "out" : undefined);

  const matching = product.images.filter(
    (i) => i.color === null || i.color === color,
  );
  // Seçilen rengin kendi görseli yoksa bütün görseller gösterilir.
  const images = matching.length > 0 ? matching : product.images;

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div
        key={color}
        role="region"
        aria-label="Ürün görselleri"
        tabIndex={0}
        className="flex snap-x snap-mandatory items-start gap-3 self-start overflow-x-auto rounded-2xl"
      >
        {images.map((image, i) => (
          <div
            key={image.path}
            className={`relative aspect-4/5 shrink-0 snap-start overflow-hidden rounded-2xl bg-white ${images.length > 1 ? "w-[92%]" : "w-full"}`}
          >
            <Image
              src={`/gorsel/${image.path}`}
              alt={image.alt}
              fill
              sizes="(min-width: 1024px) 540px, 100vw"
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : "auto"}
              className="object-contain"
            />
          </div>
        ))}
      </div>

      <div className="min-w-0 space-y-6">
        <div>
          {product.brand && <p className="text-gri">{product.brand}</p>}
          <h1 className="font-baslik text-3xl leading-tight font-bold break-words sm:text-4xl">
            {product.name}
          </h1>
          <div className="mt-2 text-xl">
            <Price
              price={shown.price}
              compareAt={shown.compare_at_price}
              from={!variant && ofColor.some((v) => v.price > shown.price)}
            />
          </div>
          <p className="text-sm text-gri">KDV dahil</p>
        </div>

        {colors.length > 0 && (
          <fieldset>
            <legend className="font-semibold">
              Renk: {colors.find((c) => c.slug === color)?.name}
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {colors.map((c) => (
                <label
                  key={c.slug}
                  title={c.name}
                  className="relative size-11 cursor-pointer rounded-full border-2 border-white outline-1 outline-gri has-checked:outline-3 has-checked:outline-petrol has-focus-visible:ring-4 has-focus-visible:ring-nar"
                  style={{ background: c.hex }}
                >
                  <input
                    type="radio"
                    name={`${id}-renk`}
                    value={c.slug}
                    checked={c.slug === color}
                    onChange={() => {
                      setColor(c.slug);
                      // Yeni renkte aynı beden yoksa veya tükendiyse seçim kalkar.
                      const same = variants.find(
                        (v) =>
                          v.color?.slug === c.slug && v.size?.code === size,
                      );
                      if (!same || same.stock === "out") setSize(null);
                    }}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                  <span className="sr-only">{c.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {sizes.length > 0 && (
          <fieldset>
            <legend className="font-semibold">Beden</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {sizes.map((v) => {
                const out = v.stock === "out";
                return (
                  <label
                    key={v.id}
                    className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 has-checked:border-petrol has-checked:bg-petrol has-checked:text-white has-focus-visible:ring-4 has-focus-visible:ring-nar ${out ? "border-gri/40 text-gri line-through" : "cursor-pointer border-gri bg-white"}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-beden`}
                      value={v.size!.code}
                      checked={v.size!.code === size}
                      disabled={out}
                      onChange={() => setSize(v.size!.code)}
                      className="absolute inset-0 size-full opacity-0 enabled:cursor-pointer"
                    />
                    {v.size!.name}
                    {out && <span className="sr-only"> (tükendi)</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <p role="status" className="font-semibold">
          {stock ? (
            <span
              className={`inline-block rounded-full px-4 py-1 ${stock === "low" ? "bg-hardal" : stock === "in" ? "bg-nane" : "bg-white"}`}
            >
              {stockLabels[stock]}
            </span>
          ) : (
            "Stok durumu için beden seçin."
          )}
        </p>

        <p className="rounded-2xl bg-nane p-4">
          İnternetten satış yakında başlıyor. Ürünlerimizi Eskişehir&apos;deki
          mağazamızda görebilirsiniz.
        </p>

        {children}
      </div>
    </div>
  );
}
