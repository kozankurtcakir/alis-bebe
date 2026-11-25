import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile, listAddresses } from "@/modules/account/queries";
import { getAccess } from "@/modules/auth/access";
import { getCart } from "@/modules/cart/queries";
import { CheckoutForm } from "@/modules/orders/checkout-form";
import { TestNotice } from "@/modules/orders/parts";
import { getCheckoutOptions } from "@/modules/orders/queries";

export const instant = false;
export const metadata: Metadata = {
  title: "Siparişi tamamla",
  robots: { index: false },
};

export default async function CheckoutPage() {
  const [cart, options, access] = await Promise.all([
    getCart(),
    getCheckoutOptions(),
    getAccess(),
  ]);
  if (cart.items.length === 0 || cart.items.some((i) => i.state !== "ok")) {
    redirect("/sepet");
  }
  const [profile, addresses] = access
    ? await Promise.all([getProfile(), listAddresses()])
    : [null, []];

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="font-baslik text-3xl font-bold">Siparişi tamamla</h1>
      {options.test_mode && <TestNotice />}
      <CheckoutForm
        cart={cart}
        options={options}
        orderKey={crypto.randomUUID()}
        member={
          access && profile
            ? {
                email: access.email,
                name: profile.full_name,
                phone: profile.phone,
                addresses,
              }
            : undefined
        }
      />
    </div>
  );
}
