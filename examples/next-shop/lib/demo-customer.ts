import type { Address, Buyer } from 'better-payment';

/**
 * Demo customer data. Providers require a buyer and addresses, so the example
 * fills them in on the server with obviously fake values. A real shop takes
 * these from the checkout form and its own customer records.
 */
export function demoBuyer(orderId: string): Buyer {
  return {
    id: `DEMO-${orderId}`,
    name: 'Demo',
    surname: 'Buyer',
    email: 'demo.buyer@example.com',
    identityNumber: '00000000000',
    registrationAddress: 'Example Mah. Demo Sok. No 1',
    city: 'Istanbul',
    country: 'Turkey',
    zipCode: '34000',
    ip: '127.0.0.1',
    gsmNumber: '+905000000000',
  };
}

export function demoAddress(name: string): Address {
  return {
    contactName: name,
    city: 'Istanbul',
    country: 'Turkey',
    address: 'Example Mah. Demo Sok. No 1',
    zipCode: '34000',
  };
}
