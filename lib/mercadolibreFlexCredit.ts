type OrderItemForFlexCredit = {
  quantity?: number | null;
  unit_price?: number | null;
};

const BUYER_PAID_SHIPPING_UNIT_PRICE_LIMIT = 33000;

// El umbral se evalúa por unidad: dos unidades económicas pueden superar
// $33.000 en total y aun así tener el envío a cargo del comprador.
export function shouldCreditFlexReceiverDiscount(
  orderAmount: number,
  orderItems: OrderItemForFlexCredit[] | undefined,
) {
  if (orderAmount < BUYER_PAID_SHIPPING_UNIT_PRICE_LIMIT) return true;
  if (!orderItems?.length) return false;

  const units = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return units > 1 && orderItems.every((item) =>
    Number(item.quantity || 0) > 0 &&
    Number(item.unit_price || 0) > 0 &&
    Number(item.unit_price) < BUYER_PAID_SHIPPING_UNIT_PRICE_LIMIT
  );
}
