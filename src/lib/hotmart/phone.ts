export interface HotmartBuyerPhone {
  phone?: string;
  checkout_phone?: string;
  checkout_phone_code?: string;
}

export function extractHotmartPhone(
  buyer: HotmartBuyerPhone | undefined
): string | null {
  if (!buyer) return null;
  const direct = buyer.phone?.replace(/\D/g, '');
  if (direct) return direct;

  const checkout = buyer.checkout_phone?.replace(/\D/g, '');
  if (!checkout) return null;
  if (
    checkout.startsWith('55') &&
    (checkout.length === 12 || checkout.length === 13)
  )
    return checkout;
  if (checkout.length === 10 || checkout.length === 11) return `55${checkout}`;

  const areaCode = buyer.checkout_phone_code?.replace(/\D/g, '');
  if (
    areaCode?.length === 2 &&
    (checkout.length === 8 || checkout.length === 9)
  ) {
    return `55${areaCode}${checkout}`;
  }
  return checkout;
}
