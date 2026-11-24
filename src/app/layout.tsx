import type { Metadata } from "next";
import { Baloo_2, Figtree } from "next/font/google";
import "./globals.css";

// "latin-ext" Türkçe ğ, ş, ı, İ harfleri için gereklidir.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin", "latin-ext"],
});

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: { default: "Aliş Bebe", template: "%s | Aliş Bebe" },
  description: "Eskişehir'den Türkiye'ye bebek ve çocuk giyim.",
  // Site yayına hazır olana kadar arama motorlarına kapalı (Aşama 14'te kaldırılacak).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${figtree.variable} ${baloo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
