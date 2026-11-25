"use client";

export const PrintButton = () => (
  <button
    type="button"
    onClick={() => window.print()}
    className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane"
  >
    Yazdır
  </button>
);
