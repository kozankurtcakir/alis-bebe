/** Firmada açılan gönderi. */
export type OpenedShipment = { carrierId: string; trackingNo: string };

/** Bütün kargo sağlayıcıları bu arayüzle konuşur. */
export interface ShippingProvider {
  name: string;
  /** Firmaya gönderi açar. Takip bilgisi elle yazılacaksa null. */
  open(shipmentId: string): Promise<OpenedShipment | null>;
}

/** Firmaya bağlanmaz: gönderi firmada elle açılır, takip numarası panele yazılır. */
export const manualProvider: ShippingProvider = {
  name: "manual",
  open: async () => null,
};
