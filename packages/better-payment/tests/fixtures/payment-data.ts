import type {
  PaymentRequest,
  ThreeDSPaymentRequest,
  RefundRequest,
  CancelRequest,
  CheckoutFormRequest,
  CheckoutRequest,
  PaymentCard,
  Buyer,
  Address,
  BasketItem,
} from '../../src/types';
import { BasketItemType, Currency } from '../../src/types';

export const mockPaymentCard: PaymentCard = {
  cardHolderName: 'John Doe',
  cardNumber: '5528790000000008',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '123',
  registerCard: true,
};

export const mockBuyer: Buyer = {
  id: 'BY789',
  name: 'John',
  surname: 'Doe',
  gsmNumber: '+905350000000',
  email: 'john.doe@example.com',
  identityNumber: '74300864791',
  registrationAddress: 'Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1',
  ip: '85.34.78.112',
  city: 'Istanbul',
  country: 'Turkey',
  zipCode: '34732',
};

export const mockShippingAddress: Address = {
  contactName: 'Jane Doe',
  city: 'Istanbul',
  country: 'Turkey',
  address: 'Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1',
  zipCode: '34732',
};

export const mockBillingAddress: Address = {
  contactName: 'John Doe',
  city: 'Istanbul',
  country: 'Turkey',
  address: 'Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1',
  zipCode: '34732',
};

export const mockBasketItems: BasketItem[] = [
  {
    id: 'BI101',
    name: 'Binocular',
    category1: 'Collectibles',
    category2: 'Accessories',
    itemType: BasketItemType.PHYSICAL,
    price: '0.3',
  },
  {
    id: 'BI102',
    name: 'Game code',
    category1: 'Game',
    category2: 'Online Game Items',
    itemType: BasketItemType.VIRTUAL,
    price: '0.5',
  },
  {
    id: 'BI103',
    name: 'Usb',
    category1: 'Electronics',
    category2: 'Usb / Cable',
    itemType: BasketItemType.PHYSICAL,
    price: '0.2',
  },
];

export const mockPaymentRequest: PaymentRequest = {
  price: '1',
  paidPrice: '1.2',
  currency: Currency.TRY,
  basketId: 'B67832',
  paymentCard: mockPaymentCard,
  buyer: mockBuyer,
  shippingAddress: mockShippingAddress,
  billingAddress: mockBillingAddress,
  basketItems: mockBasketItems,
  conversationId: '123456789',
};

export const mockThreeDSPaymentRequest: ThreeDSPaymentRequest = {
  ...mockPaymentRequest,
  callbackUrl: 'https://example.com/callback',
};

export const mockRefundRequest: RefundRequest = {
  paymentId: '12345678',
  price: '0.5',
  currency: Currency.TRY,
  ip: '85.34.78.112',
  conversationId: '123456789',
};

export const mockCancelRequest: CancelRequest = {
  paymentId: '12345678',
  ip: '85.34.78.112',
  conversationId: '123456789',
};

export const mockCheckoutFormRequest: CheckoutFormRequest = {
  price: '1',
  paidPrice: '1.2',
  currency: Currency.TRY,
  basketId: 'B67832',
  callbackUrl: 'https://example.com/callback',
  buyer: mockBuyer,
  shippingAddress: mockShippingAddress,
  billingAddress: mockBillingAddress,
  basketItems: mockBasketItems,
  conversationId: '123456789',
  enabledInstallments: [2, 3, 6, 9],
};

export const mockCheckoutRequest: CheckoutRequest = {
  price: '1',
  paidPrice: '1.2',
  currency: Currency.TRY,
  basketId: 'B67832',
  buyer: mockBuyer,
  shippingAddress: mockShippingAddress,
  billingAddress: mockBillingAddress,
  basketItems: mockBasketItems,
  conversationId: '123456789',
  returnUrl: 'https://shop.example/return',
  failUrl: 'https://shop.example/fail',
  installments: [1, 3, 6],
  locale: 'en',
};
