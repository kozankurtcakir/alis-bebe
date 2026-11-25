"use client";

import Link from "next/link";
import { useActionState } from "react";
import { setFavorite } from "./actions";

const className =
  "inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:underline";

/** `on` null ise kişi giriş yapmamıştır. */
export function FavoriteButton({
  slug,
  on,
}: {
  slug: string;
  on: boolean | null;
}) {
  const [state, action, pending] = useActionState(setFavorite, {});

  if (on === null) {
    return (
      <Link href={`/giris?sonra=/urun/${slug}`} className={className}>
        <Heart /> Favorilere ekle
      </Link>
    );
  }
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="on" value={String(!on)} />
      <button aria-disabled={pending} className={className}>
        <Heart filled={on} /> {on ? "Favorilerden çıkar" : "Favorilere ekle"}
      </button>
      {state.error && (
        <p role="alert" className="text-nar">
          {state.error}
        </p>
      )}
    </form>
  );
}

const Heart = ({ filled = false }: { filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className="size-6 stroke-nar stroke-2"
    fill={filled ? "#B93A4B" : "none"}
  >
    <path d="M12 20.5C5 15.5 3 12.2 3 8.8 3 6.1 5 4 7.6 4c1.8 0 3.4 1 4.4 2.6C13 5 14.6 4 16.4 4 19 4 21 6.1 21 8.8c0 3.4-2 6.7-9 11.7Z" />
  </svg>
);
