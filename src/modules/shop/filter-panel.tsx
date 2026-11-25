"use client";

import { useId, useState } from "react";

/** Telefonda açılıp kapanır; geniş ekranda hep açıktır. */
export function FilterPanel({
  active,
  children,
}: {
  active: number;
  children: React.ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="min-h-11 w-full rounded-full border-2 border-petrol bg-white px-5 font-semibold lg:hidden"
      >
        Filtrele{active > 0 && ` (${active})`}
      </button>
      <div
        id={id}
        className={`${open ? "block" : "hidden"} mt-4 lg:mt-0 lg:block`}
      >
        {children}
      </div>
    </div>
  );
}
