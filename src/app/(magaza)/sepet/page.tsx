import type { Metadata } from "next";
import { CartList } from "@/modules/cart/cart-list";
import { getCart } from "@/modules/cart/queries";

export const instant = false;
export const metadata: Metadata = { title: "Sepetim" };

export default async function CartPage() {
  const cart = await getCart();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <CartList cart={cart} />
    </div>
  );
}
