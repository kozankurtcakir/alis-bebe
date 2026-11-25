"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addToCart } from "./actions";

/** `variant` boşsa kişi henüz beden seçmemiştir. */
export function AddToCart({
  variant,
  soldOut,
}: {
  variant?: string;
  soldOut: boolean;
}) {
  const [state, action, pending] = useActionState(addToCart, {});
  const [missing, setMissing] = useState(false);
  const error = missing ? "Önce beden seçin." : state.error;

  return (
    <div className="space-y-3">
      <form
        action={action}
        onSubmit={(e) => {
          setMissing(!variant);
          if (!variant || pending) e.preventDefault();
        }}
      >
        <input type="hidden" name="variant" value={variant ?? ""} />
        <button
          disabled={soldOut}
          aria-disabled={pending}
          className="min-h-12 w-full rounded-full bg-hardal px-8 font-semibold hover:bg-hardal/80 disabled:bg-white disabled:text-gri"
        >
          {soldOut ? "Tükendi" : pending ? "Ekleniyor…" : "Sepete ekle"}
        </button>
      </form>
      {error && !pending && (
        <p role="alert" className="text-nar">
          {error}
        </p>
      )}
      <p role="status">
        {!error && state.ok && !pending && (
          <>
            {state.ok}{" "}
            <Link
              href="/sepet"
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              Sepete git
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
